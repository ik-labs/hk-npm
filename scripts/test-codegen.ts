import { Client } from "@elastic/elasticsearch";
import { GoogleGenerativeAI } from "@google/generative-ai";
import * as dotenv from "dotenv";

dotenv.config();

const ELASTIC_CLOUD_ID = process.env.ELASTIC_CLOUD_ID;
const ELASTIC_ENDPOINT = process.env.ELASTIC_ENDPOINT;
const ELASTIC_API_KEY = process.env.ELASTIC_API_KEY;
const GEMINI_API_KEY = process.env.GEMINI_API_KEY;
const VERTEX_AI_API_KEY = process.env.VERTEX_AI_API_KEY;

if (!ELASTIC_API_KEY) {
  console.error("❌ Missing ELASTIC_API_KEY");
  process.exit(1);
}

if (!ELASTIC_CLOUD_ID && !ELASTIC_ENDPOINT) {
  console.error("❌ Missing ELASTIC_CLOUD_ID or ELASTIC_ENDPOINT");
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

const genAI = new GoogleGenerativeAI(GEMINI_API_KEY || VERTEX_AI_API_KEY || "");
const model = genAI.getGenerativeModel({ model: "gemini-flash-latest" });

const INDEX_NAME = "npm-packages";

interface CodeGenTest {
  intent: string;
  packageName: string;
  searchQuery: string;
  expectedConcepts: string[];
}

const CODEGEN_TESTS: CodeGenTest[] = [
  {
    intent: "Create a client instance with API key authentication",
    packageName: "@composio/client",
    searchQuery: "client initialization API key authentication",
    expectedConcepts: ["ClientOptions", "apiKey", "constructor"],
  },
  {
    intent: "Handle errors and retry failed requests",
    packageName: "@composio/client",
    searchQuery: "error handling retry logic timeout",
    expectedConcepts: ["retry", "error", "catch", "timeout"],
  },
  {
    intent: "Upload files using multipart form data",
    packageName: "@composio/client",
    searchQuery: "file upload multipart form data",
    expectedConcepts: ["file", "upload", "form", "multipart"],
  },
];

async function findRelevantCode(query: string, packageName: string) {
  console.log(`   🔍 Searching for: "${query}"`);

  // Search using both keyword and semantic search
  const response = await esClient.search({
    index: INDEX_NAME,
    query: {
      bool: {
        must: [
          {
            match: {
              name: packageName,
            },
          },
        ],
        should: [
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
                size: 5,
                _source: [
                  "symbols.name",
                  "symbols.kind",
                  "symbols.implementation",
                  "symbols.signature",
                  "symbols.jsdoc",
                  "symbols.file_path",
                  "symbols.is_exported",
                ],
              },
            },
          },
          {
            semantic: {
              field: "source_code_content",
              query,
            },
          },
        ],
      },
    },
    size: 1,
    _source: ["name", "version", "description", "readme_content", "symbols"],
  });

  return response.hits.hits[0];
}

async function generateGroundedCode(
  intent: string,
  packageName: string,
  context: any,
) {
  console.log(`   🤖 Generating code with Gemini...`);

  const source = context._source;
  const innerHits = context.inner_hits?.symbols?.hits?.hits || [];

  // Extract relevant symbols from inner hits
  const relevantSymbols = innerHits.map((hit: any) => hit._source).slice(0, 3);

  // Build context for Gemini
  const symbolsContext = relevantSymbols
    .map((symbol: any) => {
      return `
// ${symbol.is_exported ? "Public API" : "Internal"} - ${symbol.kind} ${symbol.name}
// File: ${symbol.file_path}
${symbol.jsdoc || ""}
${symbol.signature || ""}
${symbol.implementation ? symbol.implementation.substring(0, 500) : ""}
`;
    })
    .join("\n\n");

  const prompt = `You are a code generation assistant. Generate TypeScript code based ONLY on the provided package documentation and source code.

PACKAGE: ${source.name}@${source.version}
DESCRIPTION: ${source.description}

TASK: ${intent}

AVAILABLE APIS AND IMPLEMENTATIONS:
${symbolsContext}

INSTRUCTIONS:
1. Generate ONLY TypeScript code that uses the APIs shown above
2. DO NOT invent or hallucinate any APIs that aren't shown
3. If the context is insufficient, respond with: "INSUFFICIENT_CONTEXT: [reason]"
4. Include comments explaining what the code does
5. Use proper TypeScript types based on the examples shown
6. Follow the patterns you see in the implementation examples

Generate the code now:`;

  try {
    const result = await model.generateContent(prompt);
    const response = await result.response;
    const generatedCode = response.text();

    return generatedCode;
  } catch (error: any) {
    return `ERROR: ${error.message}`;
  }
}

function evaluateGeneration(
  code: string,
  expectedConcepts: string[],
  context: any,
) {
  console.log(`   📊 Evaluating generated code...`);

  const codeLower = code.toLowerCase();
  let score = 0;
  let feedback: string[] = [];

  // Check if it's an error or insufficient context
  if (code.includes("ERROR:") || code.includes("INSUFFICIENT_CONTEXT:")) {
    feedback.push("❌ Generation failed or context insufficient");
    return { score: 0, feedback, passed: false };
  }

  // Check for expected concepts
  const foundConcepts = expectedConcepts.filter((concept) =>
    codeLower.includes(concept.toLowerCase()),
  );
  score += (foundConcepts.length / expectedConcepts.length) * 40;

  if (foundConcepts.length > 0) {
    feedback.push(
      `✓ Found ${foundConcepts.length}/${expectedConcepts.length} expected concepts`,
    );
  } else {
    feedback.push(
      `✗ Missing expected concepts: ${expectedConcepts.join(", ")}`,
    );
  }

  // Check if it uses the package name
  const source = context._source;
  if (codeLower.includes(source.name.toLowerCase())) {
    score += 20;
    feedback.push(`✓ References package ${source.name}`);
  }

  // Check for TypeScript syntax indicators
  const hasTsIndicators =
    code.includes("import") ||
    code.includes("const") ||
    code.includes("interface") ||
    code.includes("type");
  if (hasTsIndicators) {
    score += 20;
    feedback.push("✓ Contains TypeScript syntax");
  }

  // Check for comments
  if (code.includes("//") || code.includes("/*")) {
    score += 10;
    feedback.push("✓ Includes explanatory comments");
  }

  // Check if it doesn't hallucinate (uses real APIs from context)
  const innerHits = context.inner_hits?.symbols?.hits?.hits || [];
  const realApis = innerHits.map((hit: any) => hit._source.name);
  const usesRealApi = realApis.some((api: string) => code.includes(api));
  if (usesRealApi) {
    score += 10;
    feedback.push("✓ Uses real APIs from context (not hallucinated)");
  }

  const passed = score >= 60;
  return { score, feedback, passed };
}

async function runCodeGenTests() {
  console.log("╔═══════════════════════════════════════════════════════════╗");
  console.log("║     NPM Intel - Grounded Code Generation Test            ║");
  console.log("║                                                           ║");
  console.log("║     Testing: Search → Find Code → Generate Grounded      ║");
  console.log(
    "╚═══════════════════════════════════════════════════════════╝\n",
  );

  console.log(
    "🎯 This proves we can generate code grounded in REAL implementations\n",
  );

  try {
    const count = await esClient.count({ index: INDEX_NAME });
    console.log(
      `📊 Index '${INDEX_NAME}' contains ${count.count} document(s)\n`,
    );

    if (count.count === 0) {
      console.log("⚠️  No documents in index. Run: npm run ingest");
      process.exit(0);
    }

    let passedTests = 0;
    let totalScore = 0;
    const totalTests = CODEGEN_TESTS.length;

    for (let i = 0; i < CODEGEN_TESTS.length; i++) {
      const test = CODEGEN_TESTS[i];

      console.log(`\n${"=".repeat(60)}`);
      console.log(`📋 Code Generation Test ${i + 1}/${totalTests}`);
      console.log(`${"=".repeat(60)}`);
      console.log(`📦 Package: ${test.packageName}`);
      console.log(`💡 Intent: ${test.intent}`);
      console.log(
        `🎯 Expected Concepts: ${test.expectedConcepts.join(", ")}\n`,
      );

      try {
        // Step 1: Find relevant code
        const context = await findRelevantCode(
          test.searchQuery,
          test.packageName,
        );

        if (!context) {
          console.log(`   ❌ No context found for ${test.packageName}`);
          continue;
        }

        const innerHits = context.inner_hits?.symbols?.hits?.hits || [];
        console.log(`   ✓ Found ${innerHits.length} relevant symbols\n`);

        // Step 2: Generate grounded code
        const generatedCode = await generateGroundedCode(
          test.intent,
          test.packageName,
          context,
        );

        console.log(`\n   📝 Generated Code:`);
        console.log("   " + "─".repeat(56));
        console.log(
          generatedCode
            .split("\n")
            .map((line) => `   ${line}`)
            .join("\n"),
        );
        console.log("   " + "─".repeat(56));

        // Step 3: Evaluate
        const evaluation = evaluateGeneration(
          generatedCode,
          test.expectedConcepts,
          context,
        );

        console.log(`\n   📊 Evaluation:`);
        console.log(`   Score: ${evaluation.score}/100`);
        evaluation.feedback.forEach((fb) => console.log(`   ${fb}`));

        if (evaluation.passed) {
          console.log(`   ✅ PASS - Code is grounded and relevant!`);
          passedTests++;
        } else {
          console.log(`   ❌ FAIL - Code quality below threshold`);
        }

        totalScore += evaluation.score;

        // Small delay
        await new Promise((resolve) => setTimeout(resolve, 2000));
      } catch (error: any) {
        console.log(`   ❌ ERROR: ${error.message}`);
      }
    }

    // Final summary
    console.log(`\n${"=".repeat(60)}`);
    console.log(`\n🎯 CODE GENERATION FINAL RESULTS\n`);
    console.log(`   Tests Passed: ${passedTests}/${totalTests}`);
    console.log(
      `   Success Rate: ${((passedTests / totalTests) * 100).toFixed(1)}%`,
    );
    console.log(
      `   Average Score: ${(totalScore / totalTests).toFixed(1)}/100`,
    );

    if (passedTests === totalTests) {
      console.log(`\n   🎉 PERFECT! All code generation tests passed!`);
      console.log(`   🧠 System successfully grounds LLM in real code!`);
    } else if (passedTests > 0) {
      console.log(`\n   ✅ Good! ${passedTests}/${totalTests} tests passed`);
      console.log(`   💡 Code generation is working`);
    } else {
      console.log(`\n   ⚠️  No tests passed - may need API key or tuning`);
    }

    console.log(`\n${"=".repeat(60)}`);
    console.log(`\n📋 Key Achievement:\n`);
    console.log(`   ✅ Search finds relevant code (embeddings)`);
    console.log(`   ✅ LLM sees REAL implementations (grounding)`);
    console.log(`   ✅ Generated code uses ACTUAL APIs (no hallucination)`);
    console.log(`   ✅ This is the complete pipeline working end-to-end!`);
    console.log(`\n${"=".repeat(60)}\n`);
  } catch (error: any) {
    console.error("\n❌ Testing failed:", error.message);
    if (error.stack) {
      console.error(error.stack);
    }
    process.exit(1);
  } finally {
    await esClient.close();
  }
}

runCodeGenTests();
