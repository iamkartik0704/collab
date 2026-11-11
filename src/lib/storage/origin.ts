/**
 * Origin the browser uploads to with presigned POSTs (needed for the CSP `connect-src`).
 * Pure function of configuration so the middleware can use it without loading the AWS SDK.
 */
export function s3UploadOrigin(config: { endpoint?: string | undefined; bucket: string; region: string; forcePathStyle: boolean }): string {
  if (config.endpoint) {
    const url = new URL(config.endpoint);
    return config.forcePathStyle ? url.origin : `${url.protocol}//${config.bucket}.${url.host}`;
  }
  const region = config.region === "auto" ? "us-east-1" : config.region;
  return `https://${config.bucket}.s3.${region}.amazonaws.com`;
}
