import { Injectable } from '@nestjs/common';
import { parseApiEnvironment } from '@omniroute/config/api';
import { createClient, type SupabaseClient } from '@supabase/supabase-js';

export interface StoredObject {
  body: Buffer;
  contentType: string;
}
export interface ObjectStorage {
  delete(key: string): Promise<void>;
  exists(key: string): Promise<boolean>;
  get(key: string): Promise<StoredObject>;
  put(input: { body: Buffer; contentType: string; key: string }): Promise<void>;
}
export const OBJECT_STORAGE = Symbol('OBJECT_STORAGE');

/** CI/local-only storage. It is intentionally process-local and private. */
@Injectable()
export class InMemoryObjectStorage implements ObjectStorage {
  private readonly objects = new Map<string, StoredObject>();
  public async put(input: {
    body: Buffer;
    contentType: string;
    key: string;
  }): Promise<void> {
    this.objects.set(input.key, {
      body: Buffer.from(input.body),
      contentType: input.contentType,
    });
  }
  public async get(key: string): Promise<StoredObject> {
    const object = this.objects.get(key);
    if (!object) throw new Error('OBJECT_NOT_FOUND');
    return { body: Buffer.from(object.body), contentType: object.contentType };
  }
  public async exists(key: string): Promise<boolean> {
    return this.objects.has(key);
  }
  public async delete(key: string): Promise<void> {
    this.objects.delete(key);
  }
}

/**
 * Server-only native Supabase Storage adapter. It intentionally exposes no
 * signed or public URL: PostgreSQL remains the authority for object ownership.
 */
export class SupabaseObjectStorage implements ObjectStorage {
  private readonly client: SupabaseClient;
  public constructor(
    private readonly input: {
      bucket: string;
      serviceRoleKey: string;
      url: string;
    },
    client?: SupabaseClient,
  ) {
    this.client =
      client ??
      createClient(input.url, input.serviceRoleKey, {
        auth: { autoRefreshToken: false, persistSession: false },
      });
  }
  public async put(input: {
    body: Buffer;
    contentType: string;
    key: string;
  }): Promise<void> {
    const { error } = await this.client.storage
      .from(this.input.bucket)
      .upload(input.key, input.body, {
        contentType: input.contentType,
        upsert: false,
      });
    this.throwStorageError(error);
  }
  public async get(key: string): Promise<StoredObject> {
    const { data, error } = await this.client.storage
      .from(this.input.bucket)
      .download(key);
    this.throwStorageError(error);
    if (!data) throw new Error('OBJECT_NOT_FOUND');
    return {
      body: Buffer.from(await data.arrayBuffer()),
      contentType: data.type || 'application/octet-stream',
    };
  }
  public async exists(key: string): Promise<boolean> {
    try {
      await this.get(key);
      return true;
    } catch (error) {
      if (error instanceof Error && error.message === 'OBJECT_NOT_FOUND')
        return false;
      throw error;
    }
  }
  public async delete(key: string): Promise<void> {
    const { error } = await this.client.storage
      .from(this.input.bucket)
      .remove([key]);
    this.throwStorageError(error);
  }
  private throwStorageError(error: unknown): void {
    if (!error) return;
    const status =
      typeof error === 'object' && error !== null && 'statusCode' in error
        ? (error as { statusCode?: unknown }).statusCode
        : undefined;
    if (status === 404) throw new Error('OBJECT_NOT_FOUND');
    // Do not leak a URL, service-role credential, or upstream detail into an
    // application response or structured log.
    throw new Error('SUPABASE_STORAGE_ERROR');
  }
}

export function objectStorageFromEnvironment(): ObjectStorage {
  const environment = parseApiEnvironment(process.env);
  if (environment.FILES_STORAGE_DRIVER === 'memory')
    return new InMemoryObjectStorage();
  return new SupabaseObjectStorage({
    bucket: environment.SUPABASE_STORAGE_BUCKET!,
    serviceRoleKey: environment.SUPABASE_SERVICE_ROLE_KEY!,
    url: environment.SUPABASE_URL!,
  });
}
