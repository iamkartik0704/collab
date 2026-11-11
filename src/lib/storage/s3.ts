import { randomUUID } from "node:crypto";
import { DeleteObjectCommand, GetObjectCommand, HeadObjectCommand, PutObjectCommand, S3Client, S3ServiceException } from "@aws-sdk/client-s3";
import { createPresignedPost } from "@aws-sdk/s3-presigned-post";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";
import { env } from "@/env";

if (typeof window !== "undefined") {
  throw new Error("@/lib/storage/s3 is server-only.");
}

/**
 * Object storage (AWS S3, Cloudflare R2 or MinIO). Product images are uploaded by the browser
 * straight to the bucket with short-lived presigned POST policies: the policy pins the exact
 * key, the content type and a byte range, so the server never proxies file bytes and a client
 * cannot upload anything other than what was authorised.
 */

const globalForS3 = globalThis as unknown as { __collabS3?: S3Client };

function client(): S3Client {
  globalForS3.__collabS3 ??= new S3Client({
    region: env.S3_REGION === "auto" && !env.S3_ENDPOINT ? "us-east-1" : env.S3_REGION,
    endpoint: env.S3_ENDPOINT,
    forcePathStyle: env.S3_FORCE_PATH_STYLE,
    credentials: { accessKeyId: env.S3_ACCESS_KEY_ID, secretAccessKey: env.S3_SECRET_ACCESS_KEY },
    maxAttempts: 3,
  });
  return globalForS3.__collabS3;
}

export const IMAGE_CONTENT_TYPES = {
  "image/jpeg": "jpg",
  "image/png": "png",
  "image/webp": "webp",
  "image/avif": "avif",
} as const;
export type ImageContentType = keyof typeof IMAGE_CONTENT_TYPES;

export const MAX_IMAGE_BYTES = 8 * 1024 * 1024;

export interface PresignedUpload {
  url: string;
  fields: Record<string, string>;
  key: string;
  publicUrl: string;
  expiresAt: string;
}

/** Presigned POST for one image under `prefix/` (e.g. products/<productId>). */
export async function presignImageUpload(input: { prefix: string; contentType: ImageContentType; sizeBytes: number }): Promise<PresignedUpload> {
  const key = `${input.prefix.replace(/\/+$/, "")}/${randomUUID()}.${IMAGE_CONTENT_TYPES[input.contentType]}`;
  const expiresIn = env.S3_PRESIGN_TTL_SECONDS;
  const { url, fields } = await createPresignedPost(client(), {
    Bucket: env.S3_BUCKET,
    Key: key,
    Expires: expiresIn,
    Fields: { "Content-Type": input.contentType, "Cache-Control": "public, max-age=31536000, immutable" },
    Conditions: [
      ["content-length-range", 1, Math.min(input.sizeBytes, MAX_IMAGE_BYTES)],
      ["eq", "$Content-Type", input.contentType],
      ["eq", "$key", key],
    ],
  });
  return {
    url,
    fields,
    key,
    publicUrl: `${env.S3_PUBLIC_BASE_URL.replace(/\/+$/, "")}/${key}`,
    expiresAt: new Date(Date.now() + expiresIn * 1000).toISOString(),
  };
}

export interface StoredObject {
  contentType: string | undefined;
  sizeBytes: number;
}

/** Metadata of an uploaded object, or null when it does not exist. */
export async function headObject(key: string): Promise<StoredObject | null> {
  try {
    const head = await client().send(new HeadObjectCommand({ Bucket: env.S3_BUCKET, Key: key }));
    return { contentType: head.ContentType, sizeBytes: head.ContentLength ?? 0 };
  } catch (error) {
    if (error instanceof S3ServiceException && (error.$metadata.httpStatusCode === 404 || error.name === "NotFound")) {
      return null;
    }
    throw error;
  }
}

export async function deleteObject(key: string): Promise<void> {
  await client().send(new DeleteObjectCommand({ Bucket: env.S3_BUCKET, Key: key }));
}

/** Server-side upload (generated invoices). Private objects: no public cache headers. */
export async function putObject(input: { key: string; body: Buffer | Uint8Array; contentType: string; cacheControl?: string }): Promise<void> {
  await client().send(
    new PutObjectCommand({
      Bucket: env.S3_BUCKET,
      Key: input.key,
      Body: input.body,
      ContentType: input.contentType,
      CacheControl: input.cacheControl ?? "private, no-store",
    }),
  );
}

/** Short-lived download link for a private object (e.g. a tax invoice). */
export async function presignDownload(key: string, input: { filename: string; expiresInSeconds?: number }): Promise<string> {
  return getSignedUrl(
    client(),
    new GetObjectCommand({
      Bucket: env.S3_BUCKET,
      Key: key,
      ResponseContentDisposition: `attachment; filename="${input.filename.replace(/[^\w.-]/g, "_")}"`,
    }),
    { expiresIn: input.expiresInSeconds ?? env.S3_PRESIGN_TTL_SECONDS },
  );
}

export async function getObjectBytes(key: string): Promise<Uint8Array | null> {
  try {
    const result = await client().send(new GetObjectCommand({ Bucket: env.S3_BUCKET, Key: key }));
    return result.Body ? await result.Body.transformToByteArray() : null;
  } catch (error) {
    if (error instanceof S3ServiceException && (error.$metadata.httpStatusCode === 404 || error.name === "NoSuchKey")) return null;
    throw error;
  }
}
