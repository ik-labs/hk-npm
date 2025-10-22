import { indexPackages, closeClient } from "../src/ingestion/indexer.js";

/**
 * MVP Package List (12-15 packages)
 *
 * Categories:
 * - AI/Agent: @composio/core, @composio/client, @trigger.dev/sdk, inngest
 * - Edge/Serverless: @upstash/ratelimit, @upstash/redis, @planetscale/database
 * - Framework/Utils: hono, elysia, @t3-oss/env-nextjs, zod, oslo
 * - Optional fillers: @vercel/kv, @effect/schema
 */
const MVP_PACKAGES = [
  "@composio/client",
  "@composio/core",
  "@trigger.dev/sdk",
  "inngest",
  "@upstash/ratelimit",
  "@upstash/redis",
  "@planetscale/database",
  "hono",
  "elysia",
  "@t3-oss/env-nextjs",
  "zod",
  "oslo",
  "@vercel/kv",
  "@effect/schema",
];

async function main() {
  console.log("╔═══════════════════════════════════════════════════════════╗");
  console.log("║         NPM Intel - Package Ingestion Script             ║");
  console.log("║                                                           ║");
  console.log("║         🧪 Ingesting full MVP package corpus             ║");
  console.log("╚═══════════════════════════════════════════════════════════╝");

  try {
    await indexPackages(MVP_PACKAGES);

    console.log("🎉 Test ingestion complete!\n");
    console.log("Next steps:");
    console.log(
      "  1. Verify embeddings: Check Elasticsearch for source_code_content",
    );
    console.log("  2. Test search: npm run test:search-simple");
    console.log("  3. Iterate on quality");
    console.log("  4. Once perfect, enable all 15 packages\n");
  } catch (error: any) {
    console.error("\n❌ Ingestion failed:", error.message);
    process.exit(1);
  } finally {
    await closeClient();
  }
}

main();
