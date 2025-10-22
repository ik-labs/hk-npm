import { Client } from "@elastic/elasticsearch";
import * as dotenv from "dotenv";

dotenv.config();

const ELASTIC_CLOUD_ID = process.env.ELASTIC_CLOUD_ID;
const ELASTIC_ENDPOINT = process.env.ELASTIC_ENDPOINT;
const ELASTIC_API_KEY = process.env.ELASTIC_API_KEY;

// Vertex AI configuration (RECOMMENDED - supports gemini-embedding-001)
const USE_VERTEX_AI = process.env.USE_VERTEX_AI === "true";
const GCP_PROJECT_ID = process.env.GCP_PROJECT_ID;
const GCP_REGION = process.env.GCP_REGION || "us-central1";
const VERTEX_AI_API_KEY = process.env.VERTEX_AI_API_KEY;

// AI Studio configuration (fallback - supports text-embedding-004)
const GEMINI_API_KEY = process.env.GEMINI_API_KEY;

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

async function setupInferenceEndpoint() {
  try {
    console.log("🔧 Setting up Gemini inference endpoint...\n");

    // Determine which service to use
    let service: string;
    let modelId: string;
    let serviceSettings: any;

    if (USE_VERTEX_AI) {
      // Vertex AI - supports gemini-embedding-001 (RECOMMENDED)
      if (!GCP_PROJECT_ID || !VERTEX_AI_API_KEY) {
        console.error("❌ Missing Vertex AI configuration:");
        console.error("   - GCP_PROJECT_ID");
        console.error("   - VERTEX_AI_API_KEY");
        console.error("\nPlease set these in your .env file.");
        process.exit(1);
      }

      service = "googlevertexai";
      modelId = "gemini-embedding-001";
      serviceSettings = {
        service_account_json: VERTEX_AI_API_KEY,
        project_id: GCP_PROJECT_ID,
        location: GCP_REGION,
        model_id: modelId,
      };

      console.log("✨ Using Google Vertex AI");
      console.log(`   Project: ${GCP_PROJECT_ID}`);
      console.log(`   Region: ${GCP_REGION}`);
      console.log(`   Model: ${modelId}\n`);
    } else {
      // AI Studio - supports text-embedding-004 (fallback)
      if (!GEMINI_API_KEY) {
        console.error("❌ Missing AI Studio configuration:");
        console.error("   - GEMINI_API_KEY");
        console.error("\nPlease set this in your .env file.");
        console.error("\nOr switch to Vertex AI by setting USE_VERTEX_AI=true");
        process.exit(1);
      }

      service = "googleaistudio";
      modelId = "text-embedding-004";
      serviceSettings = {
        api_key: GEMINI_API_KEY,
        model_id: modelId,
      };

      console.log("⚠️  Using Google AI Studio (fallback)");
      console.log(`   Model: ${modelId}`);
      console.log(
        "   Note: Consider using Vertex AI for gemini-embedding-001\n",
      );
    }

    // Check if endpoint already exists
    try {
      const exists = await client.inference.get({
        inference_id: "gemini-embeddings",
      });

      if (exists) {
        console.log(
          "⚠️  Inference endpoint 'gemini-embeddings' already exists.",
        );
        console.log("   Deleting and recreating...\n");

        await client.inference.delete({
          inference_id: "gemini-embeddings",
        });

        console.log("✅ Deleted existing endpoint.\n");
      }
    } catch (error: any) {
      // Endpoint doesn't exist, which is fine
      if (error.meta?.statusCode !== 404) {
        throw error;
      }
    }

    // Create the inference endpoint
    await client.inference.put({
      inference_id: "gemini-embeddings",
      task_type: "text_embedding",
      inference_config: {
        service: service,
        service_settings: serviceSettings,
      },
    });

    console.log("✅ Successfully created Gemini inference endpoint!");
    console.log("   Inference ID: gemini-embeddings");
    console.log(`   Service: ${service}`);
    console.log(`   Model: ${modelId}\n`);

    // Test the endpoint
    console.log("🧪 Testing inference endpoint...\n");

    const testResult = await client.inference.inference({
      inference_id: "gemini-embeddings",
      input: "This is a test embedding for NPM Intel",
    });

    const dimensions =
      (testResult as any).text_embedding?.[0]?.length ||
      (testResult as any).embeddings?.[0]?.values?.length ||
      "unknown";

    console.log("✅ Inference endpoint is working!");
    console.log(`   Generated embedding with ${dimensions} dimensions\n`);

    if (USE_VERTEX_AI) {
      console.log("📊 Model Info:");
      console.log("   - gemini-embedding-001 (latest Google model)");
      console.log("   - Default dimensions: 768 (Matryoshka: 128-3072)");
      console.log("   - Best quality for semantic search");
    } else {
      console.log("📊 Model Info:");
      console.log("   - text-embedding-004 (older model)");
      console.log("   - Works with AI Studio");
      console.log(
        "   - Consider upgrading to Vertex AI + gemini-embedding-001",
      );
    }

    console.log("\n🎉 Setup complete! You can now run: npm run setup:index\n");
  } catch (error: any) {
    console.error("❌ Error setting up inference endpoint:");
    console.error(error.message);

    if (error.meta?.body?.error) {
      console.error("\nElasticsearch error details:");
      console.error(JSON.stringify(error.meta.body.error, null, 2));
    }

    console.error("\n💡 Troubleshooting:");
    if (USE_VERTEX_AI) {
      console.error("   1. Ensure Vertex AI API is enabled in GCP");
      console.error("   2. Check your service account has Vertex AI User role");
      console.error("   3. Verify GCP_PROJECT_ID and GCP_REGION are correct");
      console.error(
        "   4. Ensure VERTEX_AI_API_KEY contains valid service account JSON",
      );
    } else {
      console.error("   1. Verify your GEMINI_API_KEY is valid");
      console.error("   2. Check API key has proper permissions");
      console.error(
        "   3. Consider switching to Vertex AI (USE_VERTEX_AI=true)",
      );
    }

    process.exit(1);
  } finally {
    await client.close();
  }
}

setupInferenceEndpoint();
