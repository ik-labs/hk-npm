import * as dotenv from "dotenv";
import assert from "node:assert/strict";

dotenv.config();

const DEFAULT_PORT = Number(process.env.PORT || 3000);
const BASE_URL = process.env.API_BASE_URL || `http://localhost:${DEFAULT_PORT}`;
const TIMEOUT_MS = Number(process.env.API_TEST_TIMEOUT || 25000);

interface SearchTestCase {
  name: string;
  query: string;
  expectPackage: string;
}

interface AnswerTestCase {
  name: string;
  payload: {
    intent: string;
    packageName: string;
    searchQuery?: string;
    maxSnippets?: number;
  };
  preflight?: {
    query?: string;
    requiredKeywords: string[];
  };
}

const SEARCH_TESTS: SearchTestCase[] = [
  {
    name: "Basic discovery",
    query: "composio client library",
    expectPackage: "@composio/client",
  },
  {
    name: "Authentication intent",
    query: "api key authentication composio client",
    expectPackage: "@composio/client",
  },
  {
    name: "File upload semantics",
    query: "uploading files using composio client",
    expectPackage: "@composio/client",
  },
];

const ANSWER_TESTS: AnswerTestCase[] = [
  {
    name: "Initialize client with API key",
    payload: {
      intent: "Create a Composio client instance using an API key.",
      packageName: "@composio/client",
      searchQuery: "client initialization API key authentication Composio class",
      maxSnippets: 5,
    },
    preflight: {
      requiredKeywords: ["composio", "apiKey", "constructor"],
    },
  },
  {
    name: "Handle errors and retries",
    payload: {
      intent: "Show how to handle errors and implement retry logic when calling Composio APIs.",
      packageName: "@composio/client",
      searchQuery: "error handling retry logic timeout",
      maxSnippets: 6,
    },
    preflight: {
      requiredKeywords: ["retry", "timeout", "error"],
    },
  },
  {
    name: "Upload file via multipart",
    payload: {
      intent: "List available tools in the Composio client and execute one.",
      packageName: "@composio/client",
      searchQuery: "tools.execute tools.get input parameters",
      maxSnippets: 6,
    },
    preflight: {
      requiredKeywords: ["tools.execute", "tools.get"],
    },
  },
];

async function withTimeout<T>(promise: Promise<T>, label: string): Promise<T> {
  return Promise.race([
    promise,
    new Promise<never>((_, reject) =>
      setTimeout(() => reject(new Error(`${label} timed out after ${TIMEOUT_MS}ms`)), TIMEOUT_MS),
    ),
  ]);
}

async function testSearchEndpoint(test: SearchTestCase) {
  const url = new URL("/search", BASE_URL);
  url.searchParams.set("q", test.query);
  const response = await withTimeout(fetch(url), `GET ${url.pathname}?q=${test.query}`);

  assert.equal(response.ok, true, `Search request failed with status ${response.status}`);
  const data = (await response.json()) as any;

  assert.equal(data.query, test.query, "Search query echoed incorrectly");
  assert.ok(Array.isArray(data.results), "Results should be an array");
  assert.ok(data.results.length > 0, "No search results returned");

  const match = data.results.find((item: any) => item.name === test.expectPackage);
  assert.ok(match, `Expected package ${test.expectPackage} not found in search results`);

  console.log(`   ✅ ${test.name}: found ${match.name}@${match.version} (score ${match.score?.toFixed?.(3) ?? "n/a"})`);
}

function formatPreview(code: string, maxLines = 10): string {
  const lines = code.split("\n");
  const preview = lines.slice(0, maxLines);
  const remaining = lines.length - preview.length;

  const formatted = preview
    .map((line, idx) => `${String(idx + 1).padStart(2, " ")} │ ${line}`)
    .join("\n");

  return remaining > 0
    ? `${formatted}\n   … (${remaining} more lines)`
    : formatted;
}

async function testAnswerEndpoint(test: AnswerTestCase): Promise<{ skipped?: true } | void> {
  // if (test.preflight) {
  //   const preflightQuery = test.preflight.query || test.payload.searchQuery || test.payload.intent;
  //   const url = new URL("/search", BASE_URL);
  //   url.searchParams.set("q", preflightQuery);
  //   const response = await withTimeout(fetch(url), `GET /search (preflight ${test.name})`);
  //
  //   if (!response.ok) {
  //     console.warn(
  //       `   ⚠️  ${test.name}: preflight search failed (${response.status}). Skipping grounded test.`,
  //     );
  //     return { skipped: true };
  //   }
  //
  //    const data = (await response.json()) as any;
  //   const match = data.results.find((item: any) => item.name === test.payload.packageName);
  //
  //   if (!match) {
  //     console.warn(
  //       `   ⚠️  ${test.name}: package ${test.payload.packageName} not present in search results. Skipping.`,
  //     );
  //     return { skipped: true };
  //   }
  //
  //   const haystacks: string[] = [];
  //   if (Array.isArray(match.context)) {
  //     for (const ctx of match.context) {
  //       if (typeof ctx.snippet === "string") haystacks.push(ctx.snippet.toLowerCase());
  //     }
  //   }
  //   if (typeof match.description === "string") haystacks.push(match.description.toLowerCase());
  //
  //   const missing = test.preflight.requiredKeywords.filter((keyword) =>
  //     haystacks.every((snippet) => !snippet.includes(keyword.toLowerCase())),
  //   );
  //
  //   if (missing.length > 0) {
  //     console.warn(
  //       `   ⚠️  ${test.name}: missing keywords ${missing.join(", ")} in indexed context. Skipping.`,
  //     );
  //     return { skipped: true };
  //   }
  // }

  const url = new URL("/answer", BASE_URL);
  const response = await withTimeout(
    fetch(url, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify(test.payload),
    }),
    `POST ${url.pathname} (${test.name})`,
  );

  assert.equal(response.ok, true, `Answer request failed with status ${response.status}`);
  const data = (await response.json()) as any;

  assert.equal(data.packageName, test.payload.packageName, "Package mismatch in answer response");
  assert.equal(data.intent, test.payload.intent, "Intent mismatch in answer response");
  assert.ok(typeof data.code === "string" && data.code.length > 0, "Generated code is empty");
  assert.ok(
    !data.code.includes("INSUFFICIENT_CONTEXT"),
    "Answer reported insufficient context",
  );

  assert.ok(Array.isArray(data.context) && data.context.length > 0, "Answer missing context symbols");

  const lineCount = data.code.split("\n").length;
  console.log(`   ✅ ${test.name}: generated ${lineCount} lines of code`);

  const preview = formatPreview(data.code);
  console.log("      Code preview:\n" + preview.split("\n").map((line) => `      ${line}`).join("\n"));
}

async function main() {
  console.log("╔═══════════════════════════════════════════════════════════╗");
  console.log("║        NPM Intel API Endpoint Test Suite                 ║");
  console.log("╚═══════════════════════════════════════════════════════════╝\n");
  console.log(`Target base URL: ${BASE_URL}`);

  // Health check
  const healthUrl = new URL("/health", BASE_URL);
  try {
    const healthResponse = await withTimeout(fetch(healthUrl), "GET /health");
    if (!healthResponse.ok) {
      throw new Error(`Health check failed with status ${healthResponse.status}`);
    }
    console.log("✅ Health check passed");
  } catch (error: any) {
    console.error("❌ Unable to reach API server:", error.message);
    process.exit(1);
  }

  // Search tests
  console.log("\n🔍 Testing /search endpoint...\n");
  for (const test of SEARCH_TESTS) {
    try {
      await testSearchEndpoint(test);
    } catch (error: any) {
      console.error(`   ❌ ${test.name}: ${error.message}`);
      process.exitCode = 1;
    }
  }

  // Answer tests
  console.log("\n🤖 Testing /answer endpoint...\n");
  let skipped = 0;

  for (const test of ANSWER_TESTS) {
    try {
      const result = await testAnswerEndpoint(test);
      if ((result as any)?.skipped) {
        skipped++;
      } else {
        // Tiny delay to avoid hammering the model
        await new Promise((resolve) => setTimeout(resolve, 500));
      }
    } catch (error: any) {
      console.error(`   ❌ ${test.name}: ${error.message}`);
      process.exitCode = 1;
    }
  }

  console.log("\n─────────────────────────────────────────────────────────────");
  if (skipped > 0) {
    console.log(`⚠️  Skipped ${skipped} grounded test(s) due to missing indexed context.`);
  }

  if (process.exitCode && process.exitCode !== 0) {
    console.log("❌ API tests completed with failures.");
  } else {
    console.log("✅ All API endpoint tests passed!");
  }
}

main().catch((error) => {
  console.error("❌ Test runner crashed:", error);
  process.exit(1);
});
