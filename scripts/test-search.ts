import { Client } from "@elastic/elasticsearch";
import * as dotenv from "dotenv";

dotenv.config();

const ELASTIC_CLOUD_ID = process.env.ELASTIC_CLOUD_ID;
const ELASTIC_ENDPOINT = process.env.ELASTIC_ENDPOINT;
const ELASTIC_API_KEY = process.env.ELASTIC_API_KEY;

if (!ELASTIC_API_KEY) {
  console.error("❌ Missing required environment variables");
  console.error("   - ELASTIC_API_KEY");
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

/**
 * Test queries matching the preset queries from MVP doc
 */
const TEST_QUERIES = [
  "edge rate limiting for cloudflare workers",
  "durable background jobs with retries",
  "create composio agent and register tool",
  "type-safe env for next.js",
  "serverless mysql client from node",
  "event driven workflows without cron",
  "input validation with schema library",
];

async function testSearch(query: string) {
  console.log(`\n🔍 Query: "${query}"`);
  console.log("─".repeat(60));

  try {
    // RRF hybrid search (BM25 + semantic)
    const response = await client.search({
      index: INDEX_NAME,
      retriever: {
        rrf: {
          retrievers: [
            {
              standard: {
                query: {
                  multi_match: {
                    query,
                    fields: ["description^3", "readme_content", "keywords^2"],
                  },
                },
              },
            },
            {
              semantic: {
                field: "readme_content",
                query,
              },
            },
          ],
          rank_window_size: 50,
          rank_constant: 60,
        },
      },
      size: 5,
      _source: ["name", "version", "description", "keywords"],
    } as any);

    const hits = (response as any).hits.hits;

    if (hits.length === 0) {
      console.log("   No results found");
      return;
    }

    hits.forEach((hit: any, index: number) => {
      const source = hit._source;
      const keywords = source.keywords?.slice(0, 3).join(", ") || "none";
      console.log(`\n${index + 1}. ${source.name}@${source.version}`);
      console.log(`   Score: ${hit._score?.toFixed(4) || "N/A"}`);
      console.log(`   Description: ${source.description || "No description"}`);
      console.log(`   Keywords: ${keywords}`);
    });
  } catch (error: any) {
    const reason =
      error?.meta?.body?.error?.root_cause?.[0]?.reason ||
      error?.meta?.body?.error?.reason ||
      "";
    if (reason.includes("unknown field [semantic]")) {
      console.warn("   ⚠️  Semantic retriever unavailable; falling back to BM25.");
      try {
        const fallback = await client.search({
          index: INDEX_NAME,
          query: {
            multi_match: {
              query,
              fields: ["name^5", "description^3", "keywords^2", "code_examples"],
            },
          },
          size: 5,
          _source: ["name", "version", "description", "keywords"],
        });

        const hits = fallback.hits.hits;

        if (hits.length === 0) {
          console.log("   No results found");
          return;
        }

        hits.forEach((hit: any, index: number) => {
          const source = hit._source;
          const keywords = source.keywords?.slice(0, 3).join(", ") || "none";
          console.log(`\n${index + 1}. ${source.name}@${source.version}`);
          console.log(`   Score: ${hit._score?.toFixed(4) || "N/A"}`);
          console.log(`   Description: ${source.description || "No description"}`);
          console.log(`   Keywords: ${keywords}`);
        });
      } catch (fallbackError: any) {
        console.error(`   ❌ Fallback error:`, fallbackError.message);
      }
    } else {
      console.error(`   ❌ Error:`, error.message);
    }
  }
}

async function main() {
  console.log("╔═══════════════════════════════════════════════════════════╗");
  console.log("║         NPM Intel - Search Testing Script                ║");
  console.log("╚═══════════════════════════════════════════════════════════╝");

  try {
    // Check if index exists and has documents
    const count = await client.count({ index: INDEX_NAME });
    console.log(
      `\n📊 Index '${INDEX_NAME}' contains ${count.count} documents\n`,
    );

    if (count.count === 0) {
      console.log("⚠️  No documents in index. Run: npm run ingest");
      process.exit(0);
    }

    // Run test queries
    for (const query of TEST_QUERIES) {
      await testSearch(query);
      await new Promise((resolve) => setTimeout(resolve, 500)); // Rate limit
    }

    console.log("\n" + "─".repeat(60));
    console.log("\n✅ Search testing complete!\n");
  } catch (error: any) {
    console.error("\n❌ Testing failed:", error.message);

    if (error.meta?.body?.error) {
      console.error("\nElasticsearch error details:");
      console.error(JSON.stringify(error.meta.body.error, null, 2));
    }

    process.exit(1);
  } finally {
    await client.close();
  }
}

main();
