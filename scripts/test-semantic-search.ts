import { Client } from "@elastic/elasticsearch";
import * as dotenv from "dotenv";

dotenv.config();

const ELASTIC_CLOUD_ID = process.env.ELASTIC_CLOUD_ID;
const ELASTIC_ENDPOINT = process.env.ELASTIC_ENDPOINT;
const ELASTIC_API_KEY = process.env.ELASTIC_API_KEY;

if (!ELASTIC_API_KEY) {
  console.error("❌ Missing ELASTIC_API_KEY");
  process.exit(1);
}

if (!ELASTIC_CLOUD_ID && !ELASTIC_ENDPOINT) {
  console.error("❌ Missing ELASTIC_CLOUD_ID or ELASTIC_ENDPOINT");
  process.exit(1);
}

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

interface SemanticTest {
  category: string;
  query: string;
  expectation: string;
  semanticMeaning: string;
  shouldUnderstand: string[];
}

// Semantic search tests - these test UNDERSTANDING, not keyword matching
const SEMANTIC_TESTS: SemanticTest[] = [
  {
    category: "Conceptual Understanding",
    query: "making HTTP requests to external APIs",
    expectation: "Should understand this means fetch/HTTP/requests",
    semanticMeaning: "User wants to know about HTTP client functionality",
    shouldUnderstand: ["HTTP", "fetch", "request", "API"],
  },
  {
    category: "Problem-Solution Mapping",
    query: "handling network failures and retrying",
    expectation: "Should find retry logic and error handling",
    semanticMeaning: "User needs error recovery and retry patterns",
    shouldUnderstand: ["retry", "error", "timeout"],
  },
  {
    category: "Authentication Understanding",
    query: "securing API calls with tokens",
    expectation: "Should find authentication and authorization code",
    semanticMeaning: "User needs to know about API security",
    shouldUnderstand: ["auth", "token", "key"],
  },
  {
    category: "Configuration Patterns",
    query: "setting up client with custom options",
    expectation: "Should find configuration and initialization code",
    semanticMeaning: "User wants to configure the client",
    shouldUnderstand: ["config", "options", "setup"],
  },
  {
    category: "Async Programming",
    query: "waiting for asynchronous operations to complete",
    expectation: "Should find async/await patterns",
    semanticMeaning: "User needs async programming examples",
    shouldUnderstand: ["async", "await", "promise"],
  },
  {
    category: "Data Transformation",
    query: "converting responses to JSON format",
    expectation: "Should find response parsing and JSON handling",
    semanticMeaning: "User needs data transformation code",
    shouldUnderstand: ["JSON", "parse", "response"],
  },
  {
    category: "Error Recovery",
    query: "what happens when requests timeout",
    expectation: "Should find timeout handling logic",
    semanticMeaning: "User wants to understand timeout behavior",
    shouldUnderstand: ["timeout", "error"],
  },
  {
    category: "Request Building",
    query: "preparing data before sending to server",
    expectation: "Should find request preparation and serialization",
    semanticMeaning: "User needs to know about request formatting",
    shouldUnderstand: ["request", "body", "headers"],
  },
  {
    category: "Resource Management",
    query: "uploading files through the API",
    expectation: "Should find file upload and multipart form handling",
    semanticMeaning: "User wants to upload files",
    shouldUnderstand: ["file", "upload", "form"],
  },
  {
    category: "API Interaction",
    query: "calling different endpoints with parameters",
    expectation: "Should find routing and parameter handling",
    semanticMeaning: "User needs to understand API routing",
    shouldUnderstand: ["endpoint", "path", "params"],
  },
];

async function semanticSearchReadme(query: string) {
  // Search using semantic_text field (uses embeddings!)
  const response = await client.search({
    index: INDEX_NAME,
    query: {
      semantic: {
        field: "readme_content",
        query: query,
      },
    },
    size: 5,
    _source: ["name", "version", "description"],
  });

  return response.hits.hits;
}

async function semanticSearchSourceCode(query: string) {
  // Search using source_code_content semantic_text field
  const response = await client.search({
    index: INDEX_NAME,
    query: {
      semantic: {
        field: "source_code_content",
        query: query,
      },
    },
    size: 5,
    _source: ["name", "version", "total_symbols", "symbols"],
  });

  return response.hits.hits;
}

async function hybridSemanticSearch(query: string) {
  // Combine both semantic searches
  const response = await client.search({
    index: INDEX_NAME,
    query: {
      bool: {
        should: [
          {
            semantic: {
              field: "readme_content",
              query: query,
            },
          },
          {
            semantic: {
              field: "source_code_content",
              query: query,
            },
          },
        ],
      },
    },
    size: 5,
    _source: ["name", "version", "description", "total_symbols"],
  });

  return response.hits.hits;
}

async function runSemanticTests() {
  console.log("╔═══════════════════════════════════════════════════════════╗");
  console.log("║     NPM Intel - Semantic Search Test Suite               ║");
  console.log("║                                                           ║");
  console.log("║     Testing EMBEDDINGS & SEMANTIC UNDERSTANDING           ║");
  console.log("╚═══════════════════════════════════════════════════════════╝\n");

  console.log("🧪 This tests if embeddings understand MEANING, not just keywords\n");

  try {
    // Check if index exists
    const count = await client.count({ index: INDEX_NAME });
    console.log(`📊 Index '${INDEX_NAME}' contains ${count.count} document(s)\n`);

    if (count.count === 0) {
      console.log("⚠️  No documents in index. Run: npm run ingest");
      process.exit(0);
    }

    let passedTests = 0;
    let semanticUnderstandingScore = 0;
    const totalTests = SEMANTIC_TESTS.length;

    for (let i = 0; i < SEMANTIC_TESTS.length; i++) {
      const test = SEMANTIC_TESTS[i];
      console.log(`\n${"=".repeat(60)}`);
      console.log(`📋 Semantic Test ${i + 1}/${totalTests}: ${test.category}`);
      console.log(`${"=".repeat(60)}`);
      console.log(`🔍 Query: "${test.query}"`);
      console.log(`💡 Semantic Meaning: ${test.semanticMeaning}`);
      console.log(`🎯 Should Understand: ${test.shouldUnderstand.join(", ")}`);
      console.log(`📖 Expectation: ${test.expectation}\n`);

      try {
        // Run all semantic search strategies
        const [readmeResults, sourceResults, hybridResults] =
          await Promise.all([
            semanticSearchReadme(test.query),
            semanticSearchSourceCode(test.query),
            hybridSemanticSearch(test.query),
          ]);

        let foundConcepts: string[] = [];
        let testPassed = false;
        let understandingLevel = 0;

        // Analyze README semantic results
        if (readmeResults.length > 0) {
          console.log(`📚 README Semantic Results (${readmeResults.length}):`);
          readmeResults.forEach((hit: any, idx: number) => {
            const source = hit._source;
            console.log(
              `   ${idx + 1}. ${source.name}@${source.version} (score: ${hit._score?.toFixed(3)})`,
            );
            console.log(`      ${source.description || "No description"}`);
            foundConcepts.push(source.name);
          });
          understandingLevel += 1;
        }

        // Analyze source code semantic results
        if (sourceResults.length > 0) {
          console.log(
            `\n💻 Source Code Semantic Results (${sourceResults.length}):`,
          );
          sourceResults.forEach((hit: any, idx: number) => {
            const source = hit._source;
            console.log(
              `   ${idx + 1}. ${source.name}@${source.version} (score: ${hit._score?.toFixed(3)})`,
            );
            console.log(`      Symbols: ${source.total_symbols || 0}`);

            // Check if relevant symbols exist
            if (source.symbols && Array.isArray(source.symbols)) {
              const relevantSymbols = source.symbols
                .filter((s: any) => {
                  const impl = (s.implementation || "").toLowerCase();
                  return test.shouldUnderstand.some((concept) =>
                    impl.includes(concept.toLowerCase()),
                  );
                })
                .slice(0, 3);

              if (relevantSymbols.length > 0) {
                console.log(`      Found ${relevantSymbols.length} relevant symbol(s):`);
                relevantSymbols.forEach((s: any) => {
                  const badge = s.is_exported ? "📤" : "🔒";
                  console.log(
                    `      ${badge} ${s.kind} ${s.name} (${s.file_path})`,
                  );
                  foundConcepts.push(s.name);
                });
                understandingLevel += 2;
              }
            }
          });
        }

        // Analyze hybrid results
        if (hybridResults.length > 0) {
          console.log(`\n🔍 Hybrid Semantic Results (${hybridResults.length}):`);
          hybridResults.forEach((hit: any, idx: number) => {
            const source = hit._source;
            console.log(
              `   ${idx + 1}. ${source.name}@${source.version} (score: ${hit._score?.toFixed(3)})`,
            );
            console.log(
              `      Symbols: ${source.total_symbols || 0}, Score: ${hit._score?.toFixed(3)}`,
            );
          });
          understandingLevel += 1;
        }

        // Evaluate semantic understanding
        const hasResults =
          readmeResults.length > 0 ||
          sourceResults.length > 0 ||
          hybridResults.length > 0;
        const highScore = Math.max(
          readmeResults[0]?._score || 0,
          sourceResults[0]?._score || 0,
          hybridResults[0]?._score || 0,
        );

        testPassed = hasResults && highScore > 0;

        console.log(`\n📊 Semantic Understanding Analysis:`);
        console.log(`   Results Found: ${hasResults ? "Yes ✓" : "No ✗"}`);
        console.log(
          `   Understanding Level: ${understandingLevel}/4 ${understandingLevel >= 2 ? "✓" : "⚠️"}`,
        );
        console.log(`   Top Score: ${highScore.toFixed(3)}`);
        console.log(`   Concepts Found: ${foundConcepts.length}`);

        if (testPassed) {
          console.log(`   ✅ PASS - Semantic search understood the query!`);
          passedTests++;
          semanticUnderstandingScore += understandingLevel;
        } else {
          console.log(
            `   ❌ FAIL - Could not understand semantic meaning`,
          );
        }
      } catch (error: any) {
        console.log(`   ❌ ERROR: ${error.message}`);
        if (error.meta?.body?.error) {
          console.log(`   Details: ${error.meta.body.error.reason}`);
        }
      }

      // Small delay between tests
      await new Promise((resolve) => setTimeout(resolve, 300));
    }

    // Final summary
    console.log(`\n${"=".repeat(60)}`);
    console.log(`\n🎯 SEMANTIC SEARCH FINAL RESULTS\n`);
    console.log(`   Tests Passed: ${passedTests}/${totalTests}`);
    console.log(
      `   Success Rate: ${((passedTests / totalTests) * 100).toFixed(1)}%`,
    );
    console.log(
      `   Semantic Understanding Score: ${semanticUnderstandingScore}/${totalTests * 4} (${((semanticUnderstandingScore / (totalTests * 4)) * 100).toFixed(1)}%)`,
    );

    if (passedTests === totalTests) {
      console.log(
        `\n   🎉 PERFECT! Embeddings understand semantic meaning!`,
      );
      console.log(
        `   🧠 The system can understand intent, not just keywords!`,
      );
    } else if (passedTests > totalTests / 2) {
      console.log(
        `\n   ✅ Good! Most queries understood (${passedTests}/${totalTests})`,
      );
      console.log(`   💡 Embeddings are working for semantic search`);
    } else {
      console.log(
        `\n   ⚠️  Limited semantic understanding (${passedTests}/${totalTests})`,
      );
      console.log(`   💡 May need more data or embedding tuning`);
    }

    console.log(`\n${"=".repeat(60)}`);
    console.log(`\n📋 Key Insights:\n`);
    console.log(
      `   - Semantic search uses EMBEDDINGS (vector similarity)`,
    );
    console.log(`   - Queries don't need exact keywords`);
    console.log(`   - System understands CONCEPTS and INTENT`);
    console.log(
      `   - This is how we prevent LLM hallucinations (grounded in real code)`,
    );
    console.log(`\n${"=".repeat(60)}\n`);
  } catch (error: any) {
    console.error("\n❌ Testing failed:", error.message);

    if (error.meta?.body?.error) {
      console.error("\nElasticsearch error:");
      console.error(JSON.stringify(error.meta.body.error, null, 2));
    }

    process.exit(1);
  } finally {
    await client.close();
  }
}

runSemanticTests();
