import http from "http";
import { URL } from "url";
import * as dotenv from "dotenv";
import { Client } from "@elastic/elasticsearch";
import { GoogleGenerativeAI, type GenerativeModel } from "@google/generative-ai";
import { indexPackages } from "./ingestion/indexer.js";
import {
  createAnswerService,
  fetchSymbolContext as fetchAnswerSymbolContext,
  type SymbolMatch,
} from "@npm-intel/shared/answer";
import type { AnswerRequest, AnswerResponse } from "@npm-intel/shared/answer";

dotenv.config();

const PORT = Number(process.env.PORT || 3000);
const INDEX_NAME = "npm-packages";

const ELASTIC_CLOUD_ID = process.env.ELASTIC_CLOUD_ID;
const ELASTIC_ENDPOINT = process.env.ELASTIC_ENDPOINT;
const ELASTIC_API_KEY = process.env.ELASTIC_API_KEY;
const GEMINI_API_KEY = process.env.GEMINI_API_KEY || process.env.VERTEX_AI_API_KEY;
const GEMINI_MODEL = process.env.GEMINI_MODEL || "gemini-flash-latest";

if (!ELASTIC_API_KEY) {
  console.error("❌ Missing ELASTIC_API_KEY");
  process.exit(1);
}

if (!ELASTIC_CLOUD_ID && !ELASTIC_ENDPOINT) {
  console.error("❌ Provide either ELASTIC_CLOUD_ID or ELASTIC_ENDPOINT");
  process.exit(1);
}

const esClient = ELASTIC_CLOUD_ID
  ? new Client({
      cloud: { id: ELASTIC_CLOUD_ID },
      auth: { apiKey: ELASTIC_API_KEY },
    })
  : new Client({
      node: ELASTIC_ENDPOINT!,
      auth: { apiKey: ELASTIC_API_KEY },
    });

const genAI = GEMINI_API_KEY ? new GoogleGenerativeAI(GEMINI_API_KEY) : null;
const FALLBACK_MODEL = "gemini-flash-lite-latest";
const generativeModels = (() => {
  if (!genAI) return [] as GenerativeModel[];
  const models: GenerativeModel[] = [];

  try {
    models.push(genAI.getGenerativeModel({ model: GEMINI_MODEL }));
  } catch (error) {
    console.warn(`Failed to initialize Gemini model ${GEMINI_MODEL}:`, error);
  }

  if (GEMINI_MODEL !== FALLBACK_MODEL) {
    try {
      models.push(genAI.getGenerativeModel({ model: FALLBACK_MODEL }));
    } catch (error) {
      console.warn(`Failed to initialize fallback Gemini model ${FALLBACK_MODEL}:`, error);
    }
  }

  return models;
})();
const answerService = createAnswerService({
  esClient,
  indexName: INDEX_NAME,
  generativeModels,
  maxRetries: 2,
  allowUngroundedFallback: true,
});

interface SearchResult {
  id: string;
  score: number;
  name: string;
  version: string;
  description?: string;
  keywords?: string[];
  total_symbols?: number;
  context?: Array<{
    name: string;
    kind: string;
    file_path: string;
    snippet: string;
    is_exported: boolean;
    relevance_score?: number;
  }>;
}

function sendJSON(res: http.ServerResponse, status: number, payload: unknown): void {
  res.statusCode = status;
  res.setHeader("Content-Type", "application/json");
  res.end(JSON.stringify(payload, null, 2));
}

async function performSearch(query: string, limit: number): Promise<SearchResult[]> {
  async function runHybridSearch() {
    return esClient.search({
      index: INDEX_NAME,
      size: limit,
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
      _source: ["name", "version", "description", "keywords", "total_symbols"],
    } as any);
  }

  async function runBm25Fallback() {
    return esClient.search({
      index: INDEX_NAME,
      size: limit,
      query: {
        multi_match: {
          query,
          fields: ["name^5", "description^3", "keywords^2", "code_examples"],
        },
      },
      _source: ["name", "version", "description", "keywords", "total_symbols"],
    });
  }

  let response;
  try {
    response = await runHybridSearch();
  } catch (error: any) {
    const reason = error?.meta?.body?.error?.root_cause?.[0]?.reason || "";
    if (reason.includes("unknown field [semantic]")) {
      console.warn("Semantic retriever unavailable; falling back to BM25 search.");
      response = await runBm25Fallback();
    } else {
      throw error;
    }
  }

  const hits = (response as any).hits.hits as Array<{
    _id: string;
    _score: number;
    _source: any;
  }>;

  const results = await Promise.all(
    hits.map(async (hit) => {
      const symbolContext = await fetchAnswerSymbolContext({
        esClient,
        indexName: INDEX_NAME,
        docId: hit._id,
        query,
        maxSnippets: 3,
      });

      const context = symbolContext.map((symbol: SymbolMatch) => ({
        name: symbol.name,
        kind: symbol.kind,
        file_path: symbol.file_path,
        snippet: symbol.snippet,
        is_exported: symbol.is_exported,
        relevance_score: symbol.relevance_score,
      }));

      return {
        id: hit._id,
        score: hit._score,
        name: hit._source.name,
        version: hit._source.version,
        description: hit._source.description,
        keywords: hit._source.keywords,
        total_symbols: hit._source.total_symbols,
        context,
      };
    }),
  );

  return results;
}

async function handleSearchRequest(url: URL, res: http.ServerResponse) {
  const query = url.searchParams.get("q") || url.searchParams.get("query");
  if (!query) {
    sendJSON(res, 400, { error: "Missing query parameter 'q'" });
    return;
  }

  const limitParam = url.searchParams.get("limit");
  const limit = limitParam ? Math.min(Math.max(Number(limitParam), 1), 25) : 5;

  try {
    const results = await performSearch(query, limit);
    sendJSON(res, 200, { query, count: results.length, results });
  } catch (error: any) {
    console.error("Search error:", error);
    sendJSON(res, 500, { error: error.message || "Search failed" });
  }
}

async function handleAnswerRequest(req: http.IncomingMessage, res: http.ServerResponse) {
  let body = "";
  for await (const chunk of req) {
    body += chunk;
  }

  if (!body) {
    sendJSON(res, 400, { error: "Missing JSON body" });
    return;
  }

  let payload: AnswerRequest;
  try {
    payload = JSON.parse(body);
  } catch {
    sendJSON(res, 400, { error: "Invalid JSON payload" });
    return;
  }

  if (!payload.intent || !payload.packageName) {
    sendJSON(res, 400, { error: "Fields 'intent' and 'packageName' are required" });
    return;
  }

  try {
    const response = await answerService.generateAnswer(payload);
    if ("error" in response) {
      sendJSON(res, 422, response);
      return;
    }
    sendJSON(res, 200, response);
  } catch (error: any) {
    console.error("Answer error:", error);
    sendJSON(res, 500, { error: error.message || "Failed to generate answer" });
  }
}

async function handleIndexRequest(req: http.IncomingMessage, res: http.ServerResponse) {
  let body = "";
  for await (const chunk of req) {
    body += chunk;
  }

  if (!body) {
    sendJSON(res, 400, { error: "Missing JSON body" });
    return;
  }

  let payload: { packageName: string };
  try {
    payload = JSON.parse(body);
  } catch {
    sendJSON(res, 400, { error: "Invalid JSON payload" });
    return;
  }

  if (!payload.packageName) {
    sendJSON(res, 400, { error: "Field 'packageName' is required" });
    return;
  }

  // Validate package name format (basic check for npm packages)
  if (!/^(@[a-zA-Z0-9._-]+\/)?[a-zA-Z0-9][a-zA-Z0-9._-]*$/.test(payload.packageName)) {
    console.log(`📦 Backend: Invalid package name format: ${payload.packageName}`);
    sendJSON(res, 400, { error: "Invalid package name format" });
  return;
  }

  try {
  console.log(`📦 Backend: Starting actual indexing for package: ${payload.packageName}`);

  // Actually index the package (this will take some time)
  await indexPackages([payload.packageName]);

    console.log(`📦 Backend: Successfully indexed package: ${payload.packageName}`);

    // Return success response
  sendJSON(res, 200, {
    success: true,
  message: `${payload.packageName} successfully indexed`,
  packageName: payload.packageName,
  note: "Package is now available for chatting"
  });
  } catch (error: any) {
    console.error(`📦 Backend: Indexing failed for ${payload.packageName}:`, error);
  sendJSON(res, 500, { error: error.message || "Failed to index package" });
  }
}

async function handleRequest(req: http.IncomingMessage, res: http.ServerResponse) {
  if (!req.url) {
    sendJSON(res, 400, { error: "Invalid request" });
    return;
  }

  const url = new URL(req.url, `http://${req.headers.host}`);

  if (req.method === "GET" && url.pathname === "/health") {
    sendJSON(res, 200, { status: "ok" });
    return;
  }

  if (req.method === "GET" && url.pathname === "/search") {
    await handleSearchRequest(url, res);
    return;
  }

  if (req.method === "POST" && url.pathname === "/answer") {
  await handleAnswerRequest(req, res);
  return;
  }

  if (req.method === "POST" && url.pathname === "/index") {
    await handleIndexRequest(req, res);
    return;
  }

  res.statusCode = 404;
  res.end("Not Found");
}

const server = http.createServer((req, res) => {
  handleRequest(req, res).catch((error) => {
    console.error("Unhandled server error:", error);
    sendJSON(res, 500, { error: "Internal server error" });
  });
});

server.listen(PORT, () => {
console.log(`🚀 NPM Intel API ready on http://localhost:${PORT}`);
console.log("   • GET  /health");
console.log("   • GET  /search?q=your+query");
console.log("   • POST /answer { intent, packageName, searchQuery? }");
  console.log("   • POST /index { packageName }");
});

async function shutdown() {
  console.log("\nShutting down...");
  server.close();
  await esClient.close();
  process.exit(0);
}

process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);
