import { Client } from "@elastic/elasticsearch";
import * as dotenv from "dotenv";

dotenv.config();

const ELASTIC_CLOUD_ID = process.env.ELASTIC_CLOUD_ID;
const ELASTIC_ENDPOINT = process.env.ELASTIC_ENDPOINT;
const ELASTIC_API_KEY = process.env.ELASTIC_API_KEY;

if (!ELASTIC_API_KEY) {
  console.error("❌ Missing required environment variables:");
  console.error("   - ELASTIC_API_KEY");
  console.error(
    "\nPlease copy .env.example to .env and fill in your credentials.",
  );
  process.exit(1);
}

if (!ELASTIC_CLOUD_ID && !ELASTIC_ENDPOINT) {
  console.error(
    "❌ You must provide either ELASTIC_CLOUD_ID or ELASTIC_ENDPOINT",
  );
  console.error(
    "   - ELASTIC_CLOUD_ID (preferred): Find in Elastic Cloud Console",
  );
  console.error("   - ELASTIC_ENDPOINT: Your Elasticsearch endpoint URL");
  process.exit(1);
}

// Support both Cloud ID and direct endpoint URL
const client = ELASTIC_CLOUD_ID
  ? new Client({
      cloud: { id: ELASTIC_CLOUD_ID },
      auth: { apiKey: ELASTIC_API_KEY },
    })
  : new Client({
      node: ELASTIC_ENDPOINT!,
      auth: { apiKey: ELASTIC_API_KEY },
    });

const INDEX_NAME = "npm-packages";
const INFERENCE_ID = "gemini-embeddings";

async function cleanup() {
  try {
    console.log("╔═══════════════════════════════════════════════════════════╗");
    console.log("║         NPM Intel - Cleanup Script                       ║");
    console.log("╚═══════════════════════════════════════════════════════════╝");
    console.log("\n⚠️  This will delete:");
    console.log(`   - Index: ${INDEX_NAME}`);
    console.log(`   - Inference endpoint: ${INFERENCE_ID}`);
    console.log("\n🔄 Starting cleanup...\n");

    // Step 1: Delete index if exists
    try {
      const indexExists = await client.indices.exists({ index: INDEX_NAME });

      if (indexExists) {
        console.log(`📦 Deleting index '${INDEX_NAME}'...`);
        await client.indices.delete({ index: INDEX_NAME });
        console.log(`   ✅ Index deleted successfully\n`);
      } else {
        console.log(`   ℹ️  Index '${INDEX_NAME}' does not exist\n`);
      }
    } catch (error: any) {
      console.log(`   ⚠️  Could not delete index: ${error.message}\n`);
    }

    // Step 2: Delete inference endpoint if exists
    try {
      console.log(`🔧 Deleting inference endpoint '${INFERENCE_ID}'...`);

      await client.inference.delete({
        inference_id: INFERENCE_ID,
        force: true, // Force delete even if in use
      });

      console.log(`   ✅ Inference endpoint deleted successfully\n`);
    } catch (error: any) {
      if (error.meta?.statusCode === 404) {
        console.log(`   ℹ️  Inference endpoint '${INFERENCE_ID}' does not exist\n`);
      } else {
        console.log(`   ⚠️  Could not delete inference endpoint: ${error.message}\n`);
      }
    }

    console.log("─".repeat(60));
    console.log("\n✅ Cleanup complete!");
    console.log("\n📋 Next steps:");
    console.log("   1. npm run setup:inference");
    console.log("   2. npm run setup:index");
    console.log("   3. npm run ingest\n");

  } catch (error: any) {
    console.error("\n❌ Cleanup failed:");
    console.error(error.message);

    if (error.meta?.body?.error) {
      console.error("\nElasticsearch error details:");
      console.error(JSON.stringify(error.meta.body.error, null, 2));
    }

    process.exit(1);
  } finally {
    await client.close();
  }
}

cleanup();
