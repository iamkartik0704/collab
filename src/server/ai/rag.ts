import type { KnowledgeSourceType, Prisma } from "@prisma/client";
import { sha256Hex } from "@/lib/crypto";
import { db } from "@/lib/db";
import { childLogger } from "@/lib/logger";
import { embed, EmbeddingsUnavailableError, toVectorLiteral } from "./embeddings";
import { POLICY_DOCUMENTS } from "./knowledge/policies";

/**
 * Retrieval-augmented generation index over KnowledgeChunk (pgvector HNSW, cosine distance).
 * Chunks are upserted by (sourceType, sourceId, chunkIndex) and only re-embedded when their
 * sha256 changes. Search is semantic when embeddings exist, with a PostgreSQL full-text
 * fallback so the agent still answers policy questions if the embedding API is down.
 * Live facts (price, stock, order status) are never indexed: the agent reads them via tools.
 */

const log = childLogger({ service: "rag" });
const MAX_CHUNK_CHARS = 1_600;

interface ChunkInput {
  sourceType: KnowledgeSourceType;
  sourceId: string;
  productId: string | null;
  title: string;
  content: string;
  metadata: Prisma.InputJsonObject;
}

/** Splits on paragraph / line boundaries into chunks of at most MAX_CHUNK_CHARS. */
export function chunkText(text: string): string[] {
  const parts = text.split(/\n{2,}|\n(?=- )/).map((part) => part.trim()).filter(Boolean);
  const chunks: string[] = [];
  let current = "";
  for (const part of parts) {
    if (current && current.length + part.length + 1 > MAX_CHUNK_CHARS) {
      chunks.push(current);
      current = "";
    }
    if (part.length > MAX_CHUNK_CHARS) {
      for (let i = 0; i < part.length; i += MAX_CHUNK_CHARS) chunks.push(part.slice(i, i + MAX_CHUNK_CHARS));
      continue;
    }
    current = current ? `${current}\n${part}` : part;
  }
  if (current) chunks.push(current);
  return chunks;
}

async function upsertSource(sourceType: KnowledgeSourceType, sourceId: string, chunks: ChunkInput[]): Promise<{ written: number; embedded: number }> {
  const existing = await db.knowledgeChunk.findMany({ where: { sourceType, sourceId }, select: { id: true, chunkIndex: true, contentHash: true } });
  const byIndex = new Map(existing.map((row) => [row.chunkIndex, row]));
  const toEmbed: Array<{ id: string; text: string }> = [];
  let written = 0;

  for (const [chunkIndex, chunk] of chunks.entries()) {
    const contentHash = sha256Hex(`${chunk.title}\n${chunk.content}`);
    const previous = byIndex.get(chunkIndex);
    if (previous?.contentHash === contentHash) continue;
    const row = await db.knowledgeChunk.upsert({
      where: { sourceType_sourceId_chunkIndex: { sourceType, sourceId, chunkIndex } },
      create: { sourceType, sourceId, chunkIndex, productId: chunk.productId, title: chunk.title, content: chunk.content, contentHash, metadata: chunk.metadata, tokenCount: Math.ceil(chunk.content.length / 4) },
      update: { productId: chunk.productId, title: chunk.title, content: chunk.content, contentHash, metadata: chunk.metadata, tokenCount: Math.ceil(chunk.content.length / 4) },
      select: { id: true },
    });
    // Content changed: the old vector no longer describes it.
    await db.$executeRaw`UPDATE "KnowledgeChunk" SET embedding = NULL WHERE id = ${row.id}`;
    toEmbed.push({ id: row.id, text: `${chunk.title}\n${chunk.content}` });
    written++;
  }
  await db.knowledgeChunk.deleteMany({ where: { sourceType, sourceId, chunkIndex: { gte: chunks.length } } });

  // Also pick up chunks whose earlier embedding attempt failed.
  const missing = await db.$queryRaw<Array<{ id: string; title: string; content: string }>>`
    SELECT id, title, content FROM "KnowledgeChunk"
     WHERE "sourceType"::text = ${sourceType} AND "sourceId" = ${sourceId} AND embedding IS NULL`;
  for (const row of missing) if (!toEmbed.some((item) => item.id === row.id)) toEmbed.push({ id: row.id, text: `${row.title}\n${row.content}` });

  let embedded = 0;
  if (toEmbed.length > 0) {
    try {
      const vectors = await embed(toEmbed.map((item) => item.text), "document");
      for (const [index, item] of toEmbed.entries()) {
        await db.$executeRaw`UPDATE "KnowledgeChunk" SET embedding = ${toVectorLiteral(vectors[index]!)}::vector WHERE id = ${item.id}`;
        embedded++;
      }
    } catch (error) {
      if (!(error instanceof EmbeddingsUnavailableError)) throw error;
      log.warn({ sourceType, sourceId, pending: toEmbed.length }, "stored chunks without embeddings (full-text search only)");
    }
  }
  return { written, embedded };
}

function specsText(specs: Prisma.JsonValue): string {
  if (!specs || typeof specs !== "object" || Array.isArray(specs)) return "";
  return Object.entries(specs)
    .map(([group, fields]) =>
      fields && typeof fields === "object" && !Array.isArray(fields)
        ? `${group}: ${Object.entries(fields).map(([key, value]) => `${key} ${String(value)}`).join("; ")}`
        : "",
    )
    .filter(Boolean)
    .join("\n");
}

/** Indexes one product (or removes it when it is no longer sellable). */
export async function indexProduct(productId: string): Promise<{ written: number; embedded: number }> {
  const product = await db.product.findUnique({
    where: { id: productId },
    include: { brand: { select: { name: true } }, category: { select: { name: true } }, variants: { where: { deletedAt: null, isActive: true }, select: { title: true } } },
  });
  if (!product || product.deletedAt || product.status !== "ACTIVE") {
    await db.knowledgeChunk.deleteMany({ where: { sourceType: "PRODUCT", sourceId: productId } });
    return { written: 0, embedded: 0 };
  }
  const header = `${product.name} by ${product.brand.name} (${product.category.name}). Warranty: ${product.warrantyMonths} months. Options: ${product.variants.map((variant) => variant.title).join(", ") || "standard"}. Product page: /products/${product.slug}`;
  const body = [product.summary, product.description, specsText(product.specs)].filter(Boolean).join("\n\n");
  const metadata = { slug: product.slug, brand: product.brand.name, category: product.category.name };
  const chunks = chunkText(body).map((content) => ({ sourceType: "PRODUCT" as const, sourceId: product.id, productId: product.id, title: product.name, content: `${header}\n${content}`, metadata }));
  const result = await upsertSource("PRODUCT", product.id, chunks);
  await embedProductVector(product.id, `${header}\n${product.summary ?? ""}\n${product.description.slice(0, 2_000)}`, result.written > 0);
  return result;
}

/** Product-level vector (Product.embedding) for semantic product search; refreshed when its text changed or is missing. */
async function embedProductVector(productId: string, text: string, changed: boolean): Promise<void> {
  if (!changed) {
    const [row] = await db.$queryRaw<Array<{ missing: boolean }>>`SELECT embedding IS NULL AS missing FROM "Product" WHERE id = ${productId}`;
    if (!row?.missing) return;
  }
  try {
    const [vector] = await embed([text], "document");
    if (vector) await db.$executeRaw`UPDATE "Product" SET embedding = ${toVectorLiteral(vector)}::vector, "embeddingUpdatedAt" = now() WHERE id = ${productId}`;
  } catch (error) {
    if (!(error instanceof EmbeddingsUnavailableError)) throw error;
  }
}

export interface IndexStatus {
  chunks: number;
  embeddedChunks: number;
  products: number;
  embeddedProducts: number;
  lastUpdatedAt: string | null;
}

export async function knowledgeIndexStatus(): Promise<IndexStatus> {
  const [row] = await db.$queryRaw<Array<{ chunks: bigint; embedded: bigint; last: Date | null; products: bigint; embedded_products: bigint }>>`
    SELECT (SELECT count(*) FROM "KnowledgeChunk")                                    AS chunks,
           (SELECT count(*) FROM "KnowledgeChunk" WHERE embedding IS NOT NULL)        AS embedded,
           (SELECT max("updatedAt") FROM "KnowledgeChunk")                            AS last,
           (SELECT count(*) FROM "Product" WHERE status = 'ACTIVE' AND "deletedAt" IS NULL) AS products,
           (SELECT count(*) FROM "Product" WHERE status = 'ACTIVE' AND "deletedAt" IS NULL AND embedding IS NOT NULL) AS embedded_products`;
  return {
    chunks: Number(row?.chunks ?? 0),
    embeddedChunks: Number(row?.embedded ?? 0),
    products: Number(row?.products ?? 0),
    embeddedProducts: Number(row?.embedded_products ?? 0),
    lastUpdatedAt: row?.last?.toISOString() ?? null,
  };
}

export async function indexPolicies(): Promise<{ written: number; embedded: number }> {
  const totals = { written: 0, embedded: 0 };
  for (const document of POLICY_DOCUMENTS) {
    const chunks = chunkText(document.content).map((content) => ({ sourceType: document.sourceType, sourceId: document.sourceId, productId: null, title: document.title, content, metadata: {} }));
    const result = await upsertSource(document.sourceType, document.sourceId, chunks);
    totals.written += result.written;
    totals.embedded += result.embedded;
  }
  // Documents removed from POLICY_DOCUMENTS disappear from the index.
  await db.knowledgeChunk.deleteMany({ where: { sourceType: { not: "PRODUCT" }, sourceId: { notIn: POLICY_DOCUMENTS.map((document) => document.sourceId) } } });
  return totals;
}

export async function reindexAll(): Promise<{ products: number; written: number; embedded: number }> {
  const totals = await indexPolicies();
  const products = await db.product.findMany({ where: { deletedAt: null, status: "ACTIVE" }, select: { id: true } });
  for (const product of products) {
    const result = await indexProduct(product.id);
    totals.written += result.written;
    totals.embedded += result.embedded;
  }
  await db.knowledgeChunk.deleteMany({ where: { sourceType: "PRODUCT", productId: { notIn: products.map((product) => product.id) } } });
  return { products: products.length, ...totals };
}

export interface KnowledgeHit {
  title: string;
  content: string;
  sourceType: KnowledgeSourceType;
  productSlug: string | null;
  score: number;
}

/** Top-k chunks for a customer question: semantic first, full-text fallback. */
export async function searchKnowledge(query: string, k = 5, options: { sourceTypes?: KnowledgeSourceType[] } = {}): Promise<KnowledgeHit[]> {
  const types = options.sourceTypes?.length ? options.sourceTypes : null;
  const typeList = types ?? ["PRODUCT", "FAQ", "WARRANTY_POLICY", "SHIPPING_POLICY", "RETURN_POLICY"];
  try {
    const [vector] = await embed([query.slice(0, 2000)], "query");
    if (vector) {
      const rows = await db.$queryRaw<Array<{ title: string; content: string; sourceType: KnowledgeSourceType; metadata: Prisma.JsonValue; score: number }>>`
        SELECT title, content, "sourceType", metadata, 1 - (embedding <=> ${toVectorLiteral(vector)}::vector) AS score
          FROM "KnowledgeChunk"
         WHERE embedding IS NOT NULL AND "sourceType"::text = ANY(${typeList})
         ORDER BY embedding <=> ${toVectorLiteral(vector)}::vector
         LIMIT ${k}`;
      const hits = rows.filter((row) => row.score >= 0.25);
      if (hits.length > 0) return hits.map(toHit);
    }
  } catch (error) {
    if (!(error instanceof EmbeddingsUnavailableError)) log.warn({ err: error }, "semantic search failed; using full-text");
  }

  const terms = query.toLowerCase().match(/[a-z0-9]{2,}/g)?.slice(0, 12) ?? [];
  if (terms.length === 0) return [];
  const tsQuery = terms.join(" | ");
  const rows = await db.$queryRaw<Array<{ title: string; content: string; sourceType: KnowledgeSourceType; metadata: Prisma.JsonValue; score: number }>>`
    SELECT title, content, "sourceType", metadata,
           ts_rank(to_tsvector('english', title || ' ' || content), to_tsquery('english', ${tsQuery}))::float8 AS score
      FROM "KnowledgeChunk"
     WHERE to_tsvector('english', title || ' ' || content) @@ to_tsquery('english', ${tsQuery})
       AND "sourceType"::text = ANY(${typeList})
     ORDER BY score DESC
     LIMIT ${k}`;
  return rows.map(toHit);
}

function toHit(row: { title: string; content: string; sourceType: KnowledgeSourceType; metadata: Prisma.JsonValue; score: number }): KnowledgeHit {
  const metadata = row.metadata && typeof row.metadata === "object" && !Array.isArray(row.metadata) ? (row.metadata as Record<string, unknown>) : {};
  return { title: row.title, content: row.content, sourceType: row.sourceType, productSlug: typeof metadata.slug === "string" ? metadata.slug : null, score: Math.round(Number(row.score) * 1000) / 1000 };
}
