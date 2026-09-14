import { randomUUID } from 'node:crypto';
import {
  Inject,
  Injectable,
  OnApplicationShutdown,
  Optional,
} from '@nestjs/common';
import { parseApiEnvironment } from '@omniroute/config/api';
import { createClient, type RedisClientType } from 'redis';

export class CoordinationUnavailableError extends Error {
  public constructor() {
    super('Shared coordination is unavailable');
  }
}

export const COORDINATION_BACKEND = Symbol('COORDINATION_BACKEND');

export interface CoordinationBackend {
  del(key: string): Promise<number>;
  get(key: string): Promise<string | null>;
  incr(key: string): Promise<number>;
  pexpire(key: string, milliseconds: number): Promise<void>;
  pttl(key: string): Promise<number>;
  ping(): Promise<void>;
  set(
    key: string,
    value: string,
    options: { onlyIfAbsent?: boolean; ttlMs: number },
  ): Promise<boolean>;
  close(): Promise<void>;
}

/** Bounded deterministic backend. It is never used in production. */
export class MemoryCoordinationBackend implements CoordinationBackend {
  private readonly values = new Map<
    string,
    { expiresAt: number; value: string }
  >();

  public async close(): Promise<void> {}
  /** Explicit test-harness reset for an injected non-production backend. */
  public clear(): void {
    this.values.clear();
  }
  public async del(key: string): Promise<number> {
    return this.values.delete(key) ? 1 : 0;
  }
  public async get(key: string): Promise<string | null> {
    const value = this.read(key);
    return value?.value ?? null;
  }
  public async incr(key: string): Promise<number> {
    const current = this.read(key);
    const next = Number(current?.value ?? '0') + 1;
    this.values.set(key, {
      expiresAt: current?.expiresAt ?? Date.now() + 60_000,
      value: String(next),
    });
    return next;
  }
  public async pexpire(key: string, milliseconds: number): Promise<void> {
    const value = this.read(key);
    if (value)
      this.values.set(key, { ...value, expiresAt: Date.now() + milliseconds });
  }
  public async pttl(key: string): Promise<number> {
    const value = this.read(key);
    return value ? Math.max(0, value.expiresAt - Date.now()) : -2;
  }
  public async ping(): Promise<void> {}
  public async set(
    key: string,
    value: string,
    options: { onlyIfAbsent?: boolean; ttlMs: number },
  ): Promise<boolean> {
    if (options.onlyIfAbsent && this.read(key)) return false;
    this.values.set(key, { expiresAt: Date.now() + options.ttlMs, value });
    return true;
  }
  private read(key: string) {
    const value = this.values.get(key);
    if (value && value.expiresAt <= Date.now()) this.values.delete(key);
    return this.values.get(key);
  }
}

/**
 * Minimal RESP client for the bounded commands used by coordination. Keeping
 * this adapter narrow prevents Redis payloads becoming an application store.
 */
export class RedisCoordinationBackend implements CoordinationBackend {
  private connecting: Promise<void> | undefined;
  private readonly client: RedisClientType;

  public constructor(url: string) {
    this.client = createClient({
      url,
      socket: {
        connectTimeout: 1_000,
        reconnectStrategy: (retries) =>
          retries >= 3
            ? new Error('Redis reconnect limit reached')
            : 250 * (retries + 1),
      },
    });
    // Command callers receive a bounded normalized failure. The event handler
    // prevents an EventEmitter "error" from becoming an unhandled exception.
    this.client.on('error', () => undefined);
  }

  public async close(): Promise<void> {
    if (this.client.isOpen) await this.client.quit();
  }
  public async del(key: string): Promise<number> {
    return await this.command(() => this.client.del(key));
  }
  public async get(key: string): Promise<string | null> {
    return await this.command(() => this.client.get(key));
  }
  public async incr(key: string): Promise<number> {
    return await this.command(() => this.client.incr(key));
  }
  public async pexpire(key: string, milliseconds: number): Promise<void> {
    await this.command(() => this.client.pExpire(key, milliseconds));
  }
  public async pttl(key: string): Promise<number> {
    return await this.command(() => this.client.pTTL(key));
  }
  public async ping(): Promise<void> {
    await this.command(() => this.client.ping());
  }
  public async set(
    key: string,
    value: string,
    options: { onlyIfAbsent?: boolean; ttlMs: number },
  ): Promise<boolean> {
    const response = await this.command(() =>
      this.client.set(key, value, {
        expiration: { type: 'PX', value: options.ttlMs },
        ...(options.onlyIfAbsent ? { condition: 'NX' } : {}),
      }),
    );
    return response === 'OK';
  }

  private async command<T>(operation: () => Promise<T>): Promise<T> {
    await this.ensureConnected();
    return await this.withTimeout(operation());
  }
  private async ensureConnected(): Promise<void> {
    if (this.client.isReady) return;
    if (this.connecting) return this.connecting;
    this.connecting = this.withTimeout(this.client.connect())
      .then(() => undefined)
      .finally(() => {
        this.connecting = undefined;
      });
    return this.connecting;
  }
  private async withTimeout<T>(promise: Promise<T>): Promise<T> {
    let timer: NodeJS.Timeout | undefined;
    try {
      return await Promise.race([
        promise,
        new Promise<T>((_resolve, reject) => {
          timer = setTimeout(
            () => reject(new Error('Redis command timeout')),
            1_000,
          );
        }),
      ]);
    } finally {
      if (timer) clearTimeout(timer);
    }
  }
}

@Injectable()
export class CoordinationService implements OnApplicationShutdown {
  private readonly backend: CoordinationBackend;

  public constructor(
    @Optional()
    @Inject(COORDINATION_BACKEND)
    backend?: CoordinationBackend,
  ) {
    const environment = parseApiEnvironment(process.env);
    this.backend =
      backend ??
      (environment.NODE_ENV === 'production'
        ? new RedisCoordinationBackend(environment.REDIS_URL)
        : new MemoryCoordinationBackend());
  }

  public async limit(input: {
    key: string;
    limit: number;
    windowMs: number;
  }): Promise<{ allowed: boolean; retryAfterSeconds: number }> {
    try {
      const count = await this.backend.incr(input.key);
      if (count === 1) await this.backend.pexpire(input.key, input.windowMs);
      const remaining = await this.backend.pttl(input.key);
      return {
        allowed: count <= input.limit,
        retryAfterSeconds: Math.max(1, Math.ceil(remaining / 1_000)),
      };
    } catch {
      throw new CoordinationUnavailableError();
    }
  }

  public async acquireLease(
    runId: string,
    ttlMs = 120_000,
  ): Promise<{ key: string; token: string } | null> {
    const key = `omniroute:v1:run-lease:${runId}`;
    const token = randomUUID();
    try {
      return (await this.backend.set(key, token, { onlyIfAbsent: true, ttlMs }))
        ? { key, token }
        : null;
    } catch {
      throw new CoordinationUnavailableError();
    }
  }

  public async releaseLease(lease: {
    key: string;
    token: string;
  }): Promise<void> {
    try {
      // Do not delete a lease acquired by a later owner after expiry.
      if ((await this.backend.get(lease.key)) === lease.token)
        await this.backend.del(lease.key);
    } catch {
      // TTL bounds this advisory lock. Durable ModelRun state remains authoritative.
    }
  }

  public async get(key: string): Promise<string | null> {
    try {
      return await this.backend.get(key);
    } catch {
      throw new CoordinationUnavailableError();
    }
  }
  public async available(): Promise<boolean> {
    try {
      await this.backend.ping();
      return true;
    } catch {
      return false;
    }
  }
  public async set(key: string, value: string, ttlMs: number): Promise<void> {
    try {
      await this.backend.set(key, value, { ttlMs });
    } catch {
      throw new CoordinationUnavailableError();
    }
  }
  public async onApplicationShutdown(): Promise<void> {
    await this.backend.close();
  }
}
