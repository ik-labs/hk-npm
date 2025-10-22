import { Client } from "@elastic/elasticsearch";
import * as dotenv from "dotenv";
import {
  fetchPackage,
  extractExportsSimple,
  extractCodeBlocks,
  prepareReadmeContent,
  type ExportInfo,
} from "./fetcher.js";
import { fetchSourceCode, type SourceCodeResult } from "./source-fetcher.js";
import {
  parseSourceFiles,
  filterRelevantSymbols,
  calculateRelevanceScore,
  createSymbolSearchText,
  type ParsedSymbol,
} from "./code-parser.js";

dotenv.config();

const ELASTIC_CLOUD_ID = process.env.ELASTIC_CLOUD_ID;
const ELASTIC_ENDPOINT = process.env.ELASTIC_ENDPOINT;
const ELASTIC_API_KEY = process.env.ELASTIC_API_KEY;

if (!ELASTIC_API_KEY) {
  throw new Error("Missing ELASTIC_API_KEY environment variable");
}

if (!ELASTIC_CLOUD_ID && !ELASTIC_ENDPOINT) {
  throw new Error(
    "Missing ELASTIC_CLOUD_ID or ELASTIC_ENDPOINT environment variable",
  );
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

export interface PackageDocument {
  name: string;
  version: string;
  description: string;
  keywords: string[];
  readme_content: string;
  repository_url?: string;
  source_strategy?: string;
  exports: ExportInfo[];
  symbols: Array<{
    kind: string;
    name: string;
    signature: string;
    implementation: string;
    jsdoc?: string;
    file_path: string;
    start_line: number;
    end_line: number;
    is_exported: boolean;
    parameters?: string[];
    return_type?: string;
    relevance_score?: number;
  }>;
  source_code_content: string; // Concatenated implementations for embedding
  code_examples: string;
  total_symbols: number;
  total_source_files: number;
  total_source_size: number;
}

/**
 * Index a single package with ACTUAL SOURCE CODE
 */
export async function indexPackage(
  packageName: string,
  version: string = "latest",
): Promise<void> {
  try {
    console.log(`\n📥 Indexing ${packageName}@${version}...`);

    // Step 1: Fetch package metadata (README, package.json)
    const { pkgJson, readme, dts } = await fetchPackage(packageName, version);

    // Step 2: Extract legacy exports from .d.ts (if available)
    const exports = extractExportsSimple(dts);
    const codeBlocks = extractCodeBlocks(readme);
    const readmeContent = prepareReadmeContent(readme, codeBlocks);

    console.log(`     ✓ Extracted ${exports.length} type exports`);
    console.log(`     ✓ Extracted ${codeBlocks.length} README code examples`);

    // Step 3: 🆕 FETCH ACTUAL SOURCE CODE!
    const repoUrl =
      typeof pkgJson.repository === "string"
        ? pkgJson.repository
        : pkgJson.repository?.url;

    console.log(`     🔍 Fetching source code...`);
    const sourceCode = await fetchSourceCode(
      packageName,
      pkgJson.version,
      repoUrl,
    );

    let symbols: ParsedSymbol[] = [];
    let sourceStrategy = "none";
    let totalSourceFiles = 0;
    let totalSourceSize = 0;

    if (sourceCode && sourceCode.files.length > 0) {
      // Step 4: Parse source files to extract functions, classes, etc.
      console.log(`     🔬 Parsing ${sourceCode.files.length} source files...`);

      const allSymbols = parseSourceFiles(sourceCode.files);
      symbols = filterRelevantSymbols(allSymbols);

      sourceStrategy = sourceCode.strategy;
      totalSourceFiles = sourceCode.files.length;
      totalSourceSize = sourceCode.totalSize;

      // Calculate stats
      const exportedCount = symbols.filter((s) => s.isExported).length;
      const internalCount = symbols.length - exportedCount;

      console.log(`     ✓ Parsed ${allSymbols.length} total symbols`);
      console.log(
        `     ✓ Filtered to ${symbols.length} relevant symbols (${exportedCount} exported, ${internalCount} internal)`,
      );
      console.log(`     ✓ Source strategy: ${sourceStrategy}`);
    } else {
      console.log(`     ⚠️  No source code found, using README only`);
    }

    // Step 5: Create concatenated source code content for embedding
    const sourceCodeContent = symbols
      .map((symbol) => createSymbolSearchText(symbol))
      .join("\n\n---\n\n");

    // Step 6: Prepare document for Elasticsearch
    const doc: PackageDocument = {
      name: pkgJson.name,
      version: pkgJson.version,
      description: pkgJson.description || "",
      keywords: pkgJson.keywords || [],
      readme_content: readmeContent,
      repository_url: repoUrl,
      source_strategy: sourceStrategy,

      // Legacy exports from .d.ts
      exports,

      // 🆕 NEW: Actual source code symbols with implementations!
      symbols: symbols.map((symbol) => ({
        kind: symbol.kind,
        name: symbol.name,
        signature: symbol.signature,
        implementation: symbol.implementation, // ← ACTUAL CODE!
        jsdoc: symbol.jsdoc,
        file_path: symbol.filePath,
        start_line: symbol.startLine,
        end_line: symbol.endLine,
        is_exported: symbol.isExported,
        parameters: symbol.parameters,
        return_type: symbol.returnType,
        relevance_score: calculateRelevanceScore(symbol),
      })),

      // Concatenated source code for semantic search
      source_code_content: sourceCodeContent,

      code_examples: codeBlocks.join("\n\n"),
      total_symbols: symbols.length,
      total_source_files: totalSourceFiles,
      total_source_size: totalSourceSize,
    };

    // Step 7: Index to Elasticsearch
    // Elasticsearch will automatically generate embeddings for:
    // - readme_content (semantic_text) - README + usage docs
    // - source_code_content (semantic_text) - ALL FUNCTION/CLASS IMPLEMENTATIONS!
    const docId = `${doc.name}@${doc.version}`;
    await client.index({
      index: INDEX_NAME,
      id: docId,
      document: doc,
    });

    const exportedCount = symbols.filter((s) => s.isExported).length;
    const avgRelevance =
      symbols.length > 0
        ? (
            symbols.reduce((sum, s) => sum + calculateRelevanceScore(s), 0) /
            symbols.length
          ).toFixed(1)
        : 0;

    console.log(`     ✅ Successfully indexed ${docId}`);
    console.log(
      `        📊 Stats: ${symbols.length} symbols (${exportedCount} public, ${symbols.length - exportedCount} internal)`,
    );
    console.log(
      `        📈 Quality: Avg relevance ${avgRelevance}, ${totalSourceFiles} files, ${Math.round(totalSourceSize / 1024)}KB`,
    );
  } catch (error: any) {
    console.error(`     ❌ Failed to index ${packageName}:`, error.message);
    throw error;
  }
}

/**
 * Index multiple packages
 */
export async function indexPackages(packages: string[]): Promise<void> {
  console.log(`\n🚀 Starting ingestion for ${packages.length} packages...\n`);
  console.log(`🆕 NOW WITH ACTUAL SOURCE CODE INDEXING!\n`);

  let successful = 0;
  let failed = 0;
  let totalSymbols = 0;

  for (const pkg of packages) {
    try {
      await indexPackage(pkg);
      successful++;

      // Track total symbols (rough estimate from console output)
      // In production, we'd return this from indexPackage
    } catch (error) {
      failed++;
      console.error(`Skipping ${pkg} due to errors`);
    }
  }

  console.log("\n" + "=".repeat(60));
  console.log(`\n📊 Ingestion Summary:`);
  console.log(`   ✅ Successful: ${successful}/${packages.length}`);
  console.log(`   ❌ Failed: ${failed}/${packages.length}`);
  console.log(`\n💡 What's Indexed:`);
  console.log(`   - Package metadata (name, version, description)`);
  console.log(`   - README documentation`);
  console.log(
    `   - 🆕 ACTUAL SOURCE CODE (functions, classes, implementations)`,
  );
  console.log(`   - TypeScript/JavaScript implementations`);
  console.log(`   - Embeddings for both README AND code!`);
  console.log("\n" + "=".repeat(60) + "\n");
}

/**
 * Close the Elasticsearch client
 */
export async function closeClient(): Promise<void> {
  await client.close();
}

/**
 * Export client for use in other modules
 */
export { client };
