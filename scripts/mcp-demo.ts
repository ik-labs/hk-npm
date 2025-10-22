#!/usr/bin/env tsx
import "dotenv/config";

interface McpResponse<T> {
  data: T;
}

interface AnswerResponse {
  intent: string;
  packageName: string;
  searchQuery: string;
  code: string;
  context: Array<{
    name: string;
    kind: string;
    file_path: string;
    jsdoc?: string;
    signature?: string;
    is_exported: boolean;
  }>;
}

const API_BASE_URL = process.env.MCP_API_URL ?? "http://localhost:4000";
const API_TOKEN = process.env.MCP_API_TOKEN;

async function callEndpoint<T>(path: string, body: unknown): Promise<T> {
  const url = new URL(path, API_BASE_URL);
  const response = await fetch(url, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      ...(API_TOKEN ? { Authorization: `Bearer ${API_TOKEN}` } : {}),
    },
    body: JSON.stringify(body ?? {}),
  });

  if (!response.ok) {
    const text = await response.text();
    throw new Error(`Request failed (${response.status}): ${text}`);
  }

  return response.json() as Promise<T>;
}

function formatResourceId(name: string) {
  if (name.startsWith("npm-package://")) return name;
  return `npm-package://${name}`;
}

async function listResources() {
  const result = await callEndpoint<{ resources: Array<{ id: string; metadata: { name: string; totalSymbols: number; version: string } }> }>(
    "/mcp/resources.list",
    {},
  );
  return result.resources;
}

async function searchResource(resourceId: string, query: string, limit: number) {
  return callEndpoint<{ results: Array<{ id: string; score: number; snippet?: string }> }>("/mcp/tools.search", {
    resourceId,
    query,
    limit,
  });
}

async function triggerReindex(resourceId: string) {
  return callEndpoint<{ jobId: string; status: string }>("/mcp/tools.reindex", {
    resourceId,
  });
}

async function getJobStatus(jobId: string) {
  return callEndpoint<{ jobId: string; status: string; result: unknown; error: string | null }>("/mcp/jobs.status", {
    jobId,
  });
}

async function answerResource(resourceId: string, intent: string, searchQuery?: string, maxSnippets?: number) {
  return callEndpoint<AnswerResponse | { error: string }>("/mcp/tools.answer", {
    resourceId,
    intent,
    searchQuery,
    maxSnippets,
  });
}

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function main() {
  try {
    const args = process.argv.slice(2);
    let packageArg: string | undefined;
    const queryParts: string[] = [];
    let answerIntent: string | undefined;
    let maxSnippets: number | undefined;

    for (let index = 0; index < args.length; index += 1) {
      const arg = args[index];

      if (arg === "--answer") {
        answerIntent = args[index + 1] ?? "";
        index += 1;
        continue;
      }

      if (arg.startsWith("--answer=")) {
        answerIntent = arg.slice("--answer=".length);
        continue;
      }

      if (arg.startsWith("--snippets=")) {
        const value = Number(arg.slice("--snippets=".length));
        if (!Number.isNaN(value) && value > 0) {
          maxSnippets = value;
        }
        continue;
      }

      if (!packageArg) {
        packageArg = arg;
      } else {
        queryParts.push(arg);
      }
    }

    const queryArg = queryParts.length > 0 ? queryParts.join(" ") : "readme";

    console.log(`🔗 MCP API: ${API_BASE_URL}`);
    if (!API_TOKEN) {
      console.warn("⚠️  MCP_API_TOKEN not set. Requests may fail if the server requires authentication.");
    }

    console.log("\n📦 Fetching package resources...");
    const resources = await listResources();
    if (resources.length === 0) {
      console.error("No packages available.");
      return;
    }

    for (const resource of resources.slice(0, 5)) {
      console.log(` • ${resource.metadata.name} (${resource.metadata.version}) – ${resource.metadata.totalSymbols} symbols`);
    }

    let target = packageArg
      ? resources.find((res) => res.metadata.name === packageArg || res.id === packageArg)
      : undefined;

    if (!target && answerIntent !== undefined) {
      const haystack = `${answerIntent} ${queryArg}`.toLowerCase();
      target = resources.find((res) => {
        const normalized = res.metadata.name.toLowerCase();
        const variants = [normalized];
        if (normalized.startsWith("@")) {
          variants.push(normalized.slice(1));
        }
        variants.push(normalized.replace(/[@/]/g, " "));
        return variants.some((variant) => variant && haystack.includes(variant));
      }) ?? undefined;
    }

    if (!target) {
      target = resources[0];
    }

    if (!target) {
      console.error(`Package '${packageArg}' not found in resources list.`);
      return;
    }

    const resourceId = formatResourceId(target.metadata.name);
    console.log(`\n🎯 Using resource: ${resourceId}`);

    console.log(`\n🔍 Running search for query: "${queryArg}"`);
    const search = await searchResource(resourceId, queryArg, 3);
    if (search.results.length === 0) {
      console.log("No search results found.");
    } else {
      for (const hit of search.results) {
        console.log(` - ${hit.id} (score: ${hit.score.toFixed(2)})`);
        if (hit.snippet) {
          console.log(`   ${hit.snippet.slice(0, 140).replace(/\s+/g, " ")}...`);
        }
      }
    }

    if (answerIntent !== undefined) {
      const intent = answerIntent.trim() || queryArg;
      console.log(`\n🤖 Requesting grounded answer for intent: "${intent}"`);
      const answer = await answerResource(resourceId, intent, queryArg, maxSnippets);

      if (!answer) {
        console.error("   Failed to generate answer: Unknown error");
      } else if ("error" in answer && answer.error) {
        console.error(`   Failed to generate answer: ${answer.error}`);
      } else {
        const resolved = answer as AnswerResponse;
        console.log(`\n💡 Grounded answer:\n${resolved.code}\n`);
        if (resolved.context.length > 0) {
          console.log("Referenced symbols:");
          for (const ctx of resolved.context) {
            console.log(` • ${ctx.name} (${ctx.kind}) – ${ctx.file_path}`);
          }
        }
      }
    }

    console.log("\n♻️  Triggering reindex...");
    const job = await triggerReindex(resourceId);
    console.log(`Queued job ${job.jobId} (status: ${job.status})`);

    console.log("\n⏱️  Polling job status...");
    for (let attempt = 1; attempt <= 10; attempt += 1) {
      const status = await getJobStatus(job.jobId);
      console.log(`   Attempt ${attempt}: ${status.status}`);
      if (status.status === "completed" || status.status === "failed") {
        if (status.error) {
          console.error(`   Error: ${status.error}`);
        }
        break;
      }
      await sleep(5000);
    }

    console.log("\n✅ Demo complete.");
  } catch (error) {
    console.error("❌ Demo failed:", error instanceof Error ? error.message : error);
    process.exit(1);
  }
}

main();
