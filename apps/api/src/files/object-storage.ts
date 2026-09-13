import {
  DeleteObjectCommand,
  GetObjectCommand,
  HeadObjectCommand,
  PutObjectCommand,
  S3Client,
} from '@aws-sdk/client-s3';
import { Injectable } from '@nestjs/common';
import { parseApiEnvironment } from '@omniroute/config/api';

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

/** Private buckets only: this adapter never creates or returns public URLs. */
export class S3ObjectStorage implements ObjectStorage {
  private readonly client: S3Client;
  public constructor(
    private readonly input: {
      bucket: string;
      endpoint?: string | undefined;
      region: string;
    },
  ) {
    this.client = new S3Client({
      ...(input.endpoint ? { endpoint: input.endpoint } : {}),
      region: input.region,
    });
  }
  public async put(input: {
    body: Buffer;
    contentType: string;
    key: string;
  }): Promise<void> {
    await this.client.send(
      new PutObjectCommand({
        Bucket: this.input.bucket,
        Key: input.key,
        Body: input.body,
        ContentType: input.contentType,
      }),
    );
  }
  public async get(key: string): Promise<StoredObject> {
    const result = await this.client.send(
      new GetObjectCommand({ Bucket: this.input.bucket, Key: key }),
    );
    if (!result.Body) throw new Error('OBJECT_NOT_FOUND');
    return {
      body: Buffer.from(await result.Body.transformToByteArray()),
      contentType: result.ContentType ?? 'application/octet-stream',
    };
  }
  public async exists(key: string): Promise<boolean> {
    try {
      await this.client.send(
        new HeadObjectCommand({ Bucket: this.input.bucket, Key: key }),
      );
      return true;
    } catch (error) {
      if (error instanceof Error && error.name === 'NotFound') return false;
      throw error;
    }
  }
  public async delete(key: string): Promise<void> {
    await this.client.send(
      new DeleteObjectCommand({ Bucket: this.input.bucket, Key: key }),
    );
  }
}

export function objectStorageFromEnvironment(): ObjectStorage {
  const environment = parseApiEnvironment(process.env);
  if (environment.FILES_STORAGE_DRIVER === 'memory')
    return new InMemoryObjectStorage();
  return new S3ObjectStorage({
    bucket: environment.FILES_S3_BUCKET!,
    endpoint: process.env.FILES_S3_ENDPOINT,
    region: environment.FILES_S3_REGION!,
  });
}
