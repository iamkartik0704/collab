/**
 * Rebuilds the support agent's RAG index and backfills pgvector embeddings for every active
 * product and help-centre document. Run it once after adding the production VOYAGE_API_KEY:
 *
 *   npm run ai:reindex                                  (local, reads .env)
 *   docker compose -f docker-compose.prod.yml exec worker node_modules/.bin/tsx \
 *     --tsconfig tsconfig.worker.json scripts/ai-reindex.ts            (production)
 *
 * Unchanged chunks that already have embeddings are skipped, so re-running is cheap.
 * Exits with code 1 when embeddings could not be created (e.g. the key is still missing).
 */
import { disconnectDatabase } from "@/lib/db";
import { disconnectRedis } from "@/lib/redis";
import { knowledgeIndexStatus, reindexAll } from "@/server/ai/rag";

async function main(): Promise<void> {
  const started = Date.now();
  const result = await reindexAll();
  const status = await knowledgeIndexStatus();
  console.log(`Indexed ${result.products} products: ${result.written} chunk(s) written, ${result.embedded} embedded in ${((Date.now() - started) / 1000).toFixed(1)} s.`);
  console.log(`Coverage: ${status.embeddedChunks}/${status.chunks} chunks and ${status.embeddedProducts}/${status.products} products have embeddings.`);
  if (status.chunks > 0 && status.embeddedChunks < status.chunks) {
    console.error("Some chunks have no embedding: check VOYAGE_API_KEY (search falls back to full-text until then).");
    process.exitCode = 1;
  }
}

main()
  .catch((error: unknown) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await disconnectDatabase();
    await disconnectRedis();
    // CLI: exit even if a library left a socket or timer open.
    process.exit();
  });
