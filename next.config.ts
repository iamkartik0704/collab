import type { NextConfig } from "next";
import "./src/env";
import { HSTS_HEADER, STATIC_SECURITY_HEADERS } from "./src/lib/security/static-headers";

type RemotePattern = NonNullable<NonNullable<NextConfig["images"]>["remotePatterns"]>[number];

/**
 * next/image may only optimise images from our own object storage: the public CDN / bucket URL
 * (S3_PUBLIC_BASE_URL, e.g. https://cdn.example.com or http://localhost:9000/collab-assets) and,
 * for path-style endpoints such as MinIO / Silo, the bucket on S3_ENDPOINT. Host, port and path
 * prefix are all pinned, so the optimiser cannot be used as an open proxy.
 */
function storageRemotePatterns(): RemotePattern[] {
  const patterns: RemotePattern[] = [];
  const add = (raw: string | undefined, pathPrefix?: string) => {
    if (!raw) return;
    let url: URL;
    try {
      url = new URL(raw);
    } catch {
      return;
    }
    const prefix = (pathPrefix ?? url.pathname).replace(/\/+$/, "");
    patterns.push({
      protocol: url.protocol.replace(":", "") as "http" | "https",
      hostname: url.hostname,
      port: url.port,
      pathname: `${prefix}/**`,
    });
  };
  add(process.env.S3_PUBLIC_BASE_URL);
  if (process.env.S3_ENDPOINT && process.env.S3_BUCKET && process.env.S3_FORCE_PATH_STYLE === "true") {
    add(process.env.S3_ENDPOINT, `/${process.env.S3_BUCKET}`);
  }
  return patterns;
}

const nextConfig: NextConfig = {
  output: "standalone",
  // Pin file tracing to this project (a parent folder may contain another lockfile).
  outputFileTracingRoot: __dirname,
  poweredByHeader: false,
  reactStrictMode: true,
  // BullMQ loads its Lua scripts from disk and must not be bundled.
  serverExternalPackages: ["bullmq", "ioredis", "pino", "razorpay", "@react-pdf/renderer"],
  images: {
    formats: ["image/avif", "image/webp"],
    remotePatterns: [...storageRemotePatterns(), { protocol: "https", hostname: "lh3.googleusercontent.com", pathname: "/**" }],
  },
  async headers() {
    const headers = [...STATIC_SECURITY_HEADERS];
    if (process.env.NODE_ENV === "production") headers.push(HSTS_HEADER);
    return [{ source: "/:path*", headers }];
  },
};

export default nextConfig;
