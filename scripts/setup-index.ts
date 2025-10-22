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
      node: ELASTIC_ENDPOINT,
      auth: { apiKey: ELASTIC_API_KEY },
    });

const INDEX_NAME = "npm-packages";

async function setupIndex() {
  try {
    console.log(`🔧 Setting up Elasticsearch index: ${INDEX_NAME}\n`);

    // Check if index already exists
    const indexExists = await client.indices.exists({ index: INDEX_NAME });

    if (indexExists) {
      console.log(`⚠️  Index '${INDEX_NAME}' already exists.`);
      console.log("   Deleting and recreating...\n");

      await client.indices.delete({ index: INDEX_NAME });
      console.log("✅ Deleted existing index.\n");
    }

    // Create the index with mappings
    await client.indices.create({
      index: INDEX_NAME,
      mappings: {
        properties: {
          name: {
            type: "keyword",
          },
          version: {
            type: "keyword",
          },
          description: {
            type: "text",
          },
          readme_content: {
            type: "semantic_text",
            inference_id: "gemini-embeddings",
          },
          keywords: {
            type: "keyword",
          },

          // Repository metadata
          repository_url: {
            type: "keyword",
          },
          source_strategy: {
            type: "keyword",
          },

          // Legacy exports (from .d.ts)
          exports: {
            type: "nested",
            properties: {
              kind: {
                type: "keyword",
              },
              name: {
                type: "keyword",
              },
              signature: {
                type: "text",
              },
              jsdoc: {
                type: "text",
              },
            },
          },

          // NEW: Actual source code symbols with implementations!
          symbols: {
            type: "nested",
            properties: {
              kind: {
                type: "keyword",
              },
              name: {
                type: "keyword",
              },
              signature: {
                type: "text",
              },
              implementation: {
                type: "text",
              },
              jsdoc: {
                type: "text",
              },
              file_path: {
                type: "keyword",
              },
              start_line: {
                type: "integer",
              },
              end_line: {
                type: "integer",
              },
              is_exported: {
                type: "boolean",
              },
              parameters: {
                type: "text",
              },
              return_type: {
                type: "text",
              },
              relevance_score: {
                type: "integer",
              },
            },
          },

          // Concatenated source code for semantic search
          source_code_content: {
            type: "semantic_text",
            inference_id: "gemini-embeddings",
          },

          code_examples: {
            type: "text",
          },

          // Statistics
          total_symbols: {
            type: "integer",
          },
          total_source_files: {
            type: "integer",
          },
          total_source_size: {
            type: "integer",
          },
        },
      },
    });

    console.log(`✅ Successfully created index '${INDEX_NAME}'!`);
    console.log("\n📋 Index mapping:");
    console.log("   - name (keyword)");
    console.log("   - version (keyword)");
    console.log("   - description (text)");
    console.log("   - readme_content (semantic_text) → Gemini embeddings");
    console.log("   - keywords (keyword[])");
    console.log("   - repository_url, source_strategy (keyword)");
    console.log("   - exports (nested) - legacy from .d.ts");
    console.log("   - symbols (nested) - 🆕 ACTUAL SOURCE CODE!");
    console.log("     - implementation (text), signature, jsdoc, file_path");
    console.log(
      "   - source_code_content (semantic_text) → ALL implementations embedded!",
    );
    console.log("   - code_examples (text)");
    console.log("   - total_symbols, total_source_files, total_source_size\n");

    // Verify the index
    const indexInfo = await client.indices.get({ index: INDEX_NAME });
    console.log("✅ Index verified and ready for ingestion!\n");

    console.log("🎉 Setup complete! You can now run: npm run ingest\n");
  } catch (error: any) {
    console.error("❌ Error setting up index:");
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

setupIndex();
