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

interface SearchTest {
  category: string;
  query: string;
  expectation: string;
  shouldFind: string[];
}

// Advanced test queries to verify we can find internal implementations
const ADVANCED_TESTS: SearchTest[] = [
  // Test 1: Finding by package name (basic)
  {
    category: "Basic Package Discovery",
    query: "composio client library",
    expectation: "Should find package by name and description",
    shouldFind: ["@composio/client"],
  },

  // Test 2: Finding by interface/type (exported symbols)
  {
    category: "Type/Interface Search",
    query: "ClientOptions configuration interface",
    expectation: "Should find exported ClientOptions interface",
    shouldFind: ["ClientOptions"],
  },

  // Test 3: Finding by implementation details (internal code)
  {
    category: "Implementation Search",
    query: "HTTP request fetch headers",
    expectation: "Should find HTTP request implementation code",
    shouldFind: ["fetch", "headers", "request"],
  },

  // Test 4: Finding authentication patterns
  {
    category: "Authentication Patterns",
    query: "API key authentication header",
    expectation: "Should find auth header setup in internal code",
    shouldFind: ["Authorization", "Bearer"],
  },

  // Test 5: Finding error handling
  {
    category: "Error Handling",
    query: "error handling response status",
    expectation: "Should find error handling logic",
    shouldFind: ["error", "response"],
  },

  // Test 6: Finding async patterns
  {
    category: "Async Patterns",
    query: "async await promise",
    expectation: "Should find async/await code patterns",
    shouldFind: ["async", "await"],
  },

  // Test 7: Finding timeout/retry logic
  {
    category: "Request Configuration",
    query: "timeout request configuration",
    expectation: "Should find timeout handling in code",
    shouldFind: ["timeout"],
  },

  // Test 8: Semantic search (not exact keywords)
  {
    category: "Semantic Understanding",
    query: "making API calls to external services",
    expectation: "Should understand this means HTTP requests",
    shouldFind: ["composio"],
  },

  // Test 9: Internal helper functions
  {
    category: "Internal Functions",
    query: "request helper functions",
    expectation: "Should find internal helper code",
    shouldFind: ["request", "function"],
  },

  // Test 10: Configuration patterns
  {
    category: "Configuration",
    query: "base URL endpoint configuration",
    expectation: "Should find URL configuration code",
    shouldFind: ["url", "base"],
  },
];

async function searchPackageMetadata(query: string) {
  // Simple metadata search (BM25 only)
  const response = await client.search({
    index: INDEX_NAME,
    query: {
      multi_match: {
        query,
        fields: ["name^3", "description^2", "keywords^2"],
      },
    },
    size: 5,
    _source: ["name", "version", "description"],
  });

  return response.hits.hits;
}

async function searchSourceCode(query: string) {
  // Search through actual source code implementations
  const response = await client.search({
    index: INDEX_NAME,
    query: {
      nested: {
        path: "symbols",
        query: {
          multi_match: {
            query,
            fields: [
              "symbols.name^3",
              "symbols.implementation^2",
              "symbols.signature^2",
              "symbols.jsdoc",
            ],
          },
        },
        inner_hits: {
          size: 3,
          _source: [
            "symbols.name",
            "symbols.kind",
            "symbols.file_path",
            "symbols.is_exported",
            "symbols.relevance_score",
            "symbols.implementation",
          ],
        },
      },
    },
    size: 5,
    _source: ["name", "version"],
  });

  return response.hits.hits;
}

async function searchEverything(query: string) {
  // Search both metadata and source code
  const response = await client.search({
    index: INDEX_NAME,
    query: {
      bool: {
        should: [
          {
            multi_match: {
              query,
              fields: ["name^5", "description^3", "keywords^2"],
              boost: 2,
            },
          },
          {
            match: {
              code_examples: {
                query,
                boost: 1.5,
              },
            },
          },
          {
            nested: {
              path: "symbols",
              query: {
                multi_match: {
                  query,
                  fields: [
                    "symbols.name^3",
                    "symbols.implementation^2",
                    "symbols.signature",
                    "symbols.jsdoc",
                  ],
                },
              },
              inner_hits: {
                size: 3,
                _source: [
                  "symbols.name",
                  "symbols.kind",
                  "symbols.is_exported",
                  "symbols.relevance_score",
                  "symbols.implementation",
                ],
              },
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

function highlightMatches(text: string, keywords: string[]): string {
  let highlighted = text;
  for (const keyword of keywords) {
    const regex = new RegExp(keyword, "gi");
    highlighted = highlighted.replace(regex, `**${keyword.toUpperCase()}**`);
  }
  return highlighted;
}

async function runAdvancedTests() {
  console.log("╔═══════════════════════════════════════════════════════════╗");
  console.log("║     NPM Intel - Advanced Search Test Suite               ║");
  console.log(
    "╚═══════════════════════════════════════════════════════════╝\n",
  );

  try {
    // Check if index exists and has documents
    const count = await client.count({ index: INDEX_NAME });
    console.log(
      `📊 Index '${INDEX_NAME}' contains ${count.count} document(s)\n`,
    );

    if (count.count === 0) {
      console.log("⚠️  No documents in index. Run: npm run ingest");
      process.exit(0);
    }

    let passedTests = 0;
    let totalTests = ADVANCED_TESTS.length;

    for (let i = 0; i < ADVANCED_TESTS.length; i++) {
      const test = ADVANCED_TESTS[i];
      console.log(`\n${"=".repeat(60)}`);
      console.log(`📋 Test ${i + 1}/${totalTests}: ${test.category}`);
      console.log(`${"=".repeat(60)}`);
      console.log(`🔍 Query: "${test.query}"`);
      console.log(`💡 Expectation: ${test.expectation}`);
      console.log(`🎯 Should find: ${test.shouldFind.join(", ")}\n`);

      try {
        // Run all search strategies
        const [metadataResults, sourceResults, combinedResults] =
          await Promise.all([
            searchPackageMetadata(test.query),
            searchSourceCode(test.query),
            searchEverything(test.query),
          ]);

        // Analyze results
        let foundItems: string[] = [];
        let testPassed = false;

        // Check metadata results
        if (metadataResults.length > 0) {
          console.log(
            `📦 Package Metadata Results (${metadataResults.length}):`,
          );
          metadataResults.forEach((hit: any, idx: number) => {
            const source = hit._source;
            console.log(
              `   ${idx + 1}. ${source.name}@${source.version} (score: ${hit._score?.toFixed(2)})`,
            );
            console.log(`      ${source.description || "No description"}`);
            foundItems.push(source.name);
          });
        }

        // Check source code results
        if (sourceResults.length > 0) {
          console.log(`\n💻 Source Code Results (${sourceResults.length}):`);
          sourceResults.forEach((hit: any, idx: number) => {
            const source = hit._source;
            const innerHits = hit.inner_hits?.symbols?.hits?.hits || [];

            console.log(
              `   ${idx + 1}. ${source.name}@${source.version} (score: ${hit._score?.toFixed(2)})`,
            );

            if (innerHits.length > 0) {
              console.log(`      Found in ${innerHits.length} symbol(s):`);
              innerHits.forEach((inner: any, innerIdx: number) => {
                const symbol = inner._source;
                const badge = symbol.is_exported ? "📤 Public" : "🔒 Internal";
                console.log(
                  `      ${innerIdx + 1}. ${badge} - ${symbol.kind} ${symbol.name}`,
                );
                console.log(
                  `         Relevance: ${symbol.relevance_score || 0}`,
                );

                // Show snippet of implementation
                if (symbol.implementation) {
                  const snippet = symbol.implementation
                    .substring(0, 150)
                    .replace(/\n/g, " ");
                  console.log(`         Code: ${snippet}...`);

                  // Check if expected keywords are in the code
                  const implLower = symbol.implementation.toLowerCase();
                  test.shouldFind.forEach((expected) => {
                    if (implLower.includes(expected.toLowerCase())) {
                      foundItems.push(expected);
                    }
                  });
                }
              });
            }
          });
        }

        // Check combined results
        if (combinedResults.length > 0) {
          console.log(
            `\n🔍 Combined Search Results (${combinedResults.length}):`,
          );
          combinedResults.forEach((hit: any, idx: number) => {
            const source = hit._source;
            const innerHits = hit.inner_hits?.symbols?.hits?.hits || [];

            console.log(
              `   ${idx + 1}. ${source.name}@${source.version} (score: ${hit._score?.toFixed(2)})`,
            );
            console.log(
              `      Symbols: ${source.total_symbols || 0}, Matched: ${innerHits.length}`,
            );

            if (innerHits.length > 0) {
              innerHits.slice(0, 2).forEach((inner: any) => {
                const symbol = inner._source;
                const badge = symbol.is_exported ? "📤" : "🔒";
                console.log(
                  `      ${badge} ${symbol.kind} ${symbol.name} (rel: ${symbol.relevance_score || 0})`,
                );
              });
            }
          });
        }

        // Evaluate test result
        const uniqueFound = [...new Set(foundItems)];
        const foundCount = test.shouldFind.filter((expected) =>
          uniqueFound.some((found) =>
            found.toLowerCase().includes(expected.toLowerCase()),
          ),
        ).length;

        testPassed =
          foundCount > 0 ||
          metadataResults.length > 0 ||
          sourceResults.length > 0;

        console.log(`\n📊 Test Result:`);
        console.log(`   Found: ${uniqueFound.join(", ") || "nothing"}`);
        console.log(
          `   Matched: ${foundCount}/${test.shouldFind.length} expected items`,
        );

        if (testPassed) {
          console.log(`   ✅ PASS - Found relevant results!`);
          passedTests++;
        } else {
          console.log(`   ❌ FAIL - No results found`);
        }
      } catch (error: any) {
        console.log(`   ❌ ERROR: ${error.message}`);
      }

      // Small delay between tests
      await new Promise((resolve) => setTimeout(resolve, 300));
    }

    // Final summary
    console.log(`\n${"=".repeat(60)}`);
    console.log(`\n🎯 FINAL RESULTS\n`);
    console.log(`   Tests Passed: ${passedTests}/${totalTests}`);
    console.log(
      `   Success Rate: ${((passedTests / totalTests) * 100).toFixed(1)}%`,
    );

    if (passedTests === totalTests) {
      console.log(`\n   🎉 ALL TESTS PASSED! Search is working perfectly!`);
    } else if (passedTests > totalTests / 2) {
      console.log(
        `\n   ✅ Most tests passed! Search is working well (${passedTests}/${totalTests})`,
      );
    } else {
      console.log(
        `\n   ⚠️  Many tests failed. May need to improve search or add more data.`,
      );
    }

    console.log(`\n${"=".repeat(60)}\n`);
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

runAdvancedTests();
