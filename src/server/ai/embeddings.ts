import { env, EMBEDDING_DIMENSIONS } from "@/env";
import { childLogger } from "@/lib/logger";

/**
 * Voyage AI embeddings (Anthropic's recommended embedding provider) for the RAG index.
 * Documents and queries use different `input_type`s, as Voyage recommends for retrieval.
 * Without a working key the index still stores text and search falls back to full-text.
 */

const log = childLogger({ service: "embeddings" });
const ENDPOINT = "https://api.voyageai.com/v1/embeddings";
const BATCH = 64;

export class EmbeddingsUnavailableError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "EmbeddingsUnavailableError";
  }
}

let disabledUntil = 0;

/** Returns one vector per input, or throws EmbeddingsUnavailableError (auth / config problems). */
export async function embed(texts: string[], inputType: "document" | "query"): Promise<number[][]> {
  if (texts.length === 0) return [];
  if (Date.now() < disabledUntil) throw new EmbeddingsUnavailableError("embeddings temporarily disabled after an auth failure");
  const vectors: number[][] = [];
  for (let start = 0; start < texts.length; start += BATCH) {
    const response = await fetch(ENDPOINT, {
      method: "POST",
      headers: { Authorization: `Bearer ${env.VOYAGE_API_KEY}`, "Content-Type": "application/json" },
      body: JSON.stringify({ input: texts.slice(start, start + BATCH), model: env.AI_EMBEDDING_MODEL, input_type: inputType, output_dimension: EMBEDDING_DIMENSIONS }),
      signal: AbortSignal.timeout(inputType === "query" ? 5_000 : 30_000),
    });
    if (response.status === 401 || response.status === 403) {
      // Misconfigured key: stop hammering the API for 10 minutes; callers degrade to full-text.
      disabledUntil = Date.now() + 10 * 60_000;
      log.warn({ status: response.status }, "Voyage rejected the API key; semantic search disabled");
      throw new EmbeddingsUnavailableError(`Voyage ${response.status}`);
    }
    if (!response.ok) throw new Error(`Voyage ${response.status}: ${(await response.text()).slice(0, 300)}`);
    const payload = (await response.json()) as { data: Array<{ embedding: number[]; index: number }> };
    for (const item of [...payload.data].sort((a, b) => a.index - b.index)) {
      if (item.embedding.length !== EMBEDDING_DIMENSIONS) throw new EmbeddingsUnavailableError(`expected ${EMBEDDING_DIMENSIONS} dimensions, got ${item.embedding.length}`);
      vectors.push(item.embedding);
    }
  }
  return vectors;
}

/** pgvector literal: '[0.1,0.2,...]'. */
export function toVectorLiteral(vector: number[]): string {
  return `[${vector.map((value) => (Number.isFinite(value) ? value.toFixed(7) : "0")).join(",")}]`;
}
