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

async function verifyEmbeddings() {
  console.log("╔═══════════════════════════════════════════════════════════╗");
  console.log("║         NPM Intel - Embedding Verification               ║");
  console.log("╚═══════════════════════════════════════════════════════════╝\n");

  try {
    // Get document count
    const countResult = await client.count({ index: INDEX_NAME });
    console.log(`📊 Total documents in index: ${countResult.count}\n`);

    if (countResult.count === 0) {
      console.log("⚠️  No documents found. Run: npm run ingest");
      return;
    }

    // Fetch all documents
    const searchResult = await client.search({
      index: INDEX_NAME,
      size: 100,
      _source: ["name", "version"],
    });

    const hits = searchResult.hits.hits;
    const documents: any[] = [];

    console.log("─".repeat(60));
    console.log("📦 Package Analysis\n");

    for (const hit of hits) {
      const docResponse = await client.get({
        index: INDEX_NAME,
        id: hit._id,
        _source: { exclude_vectors: false },
      } as any);

      const baseSource = (docResponse as any)._source || {};
      const doc = {
        ...baseSource,
      };
      documents.push(doc);

      console.log(`\n📌 ${doc.name}@${doc.version}`);
      console.log("─".repeat(60));

      // Basic stats
      console.log(`Source Strategy: ${doc.source_strategy || "none"}`);
      console.log(`Total Symbols: ${doc.total_symbols || 0}`);
      console.log(`Source Files: ${doc.total_source_files || 0}`);
      console.log(
        `Source Size: ${doc.total_source_size ? Math.round(doc.total_source_size / 1024) : 0}KB`,
      );

      // Check readme_content embedding
      if (doc.readme_content) {
        const readmeType = typeof doc.readme_content;
        const readmeObj =
          readmeType === "object" ? doc.readme_content : null;

        console.log("\n✅ README Content Field:");
        if (readmeObj && readmeObj.inference) {
          console.log("   ✓ Type: semantic_text with embeddings");
          console.log(
            `   ✓ Inference ID: ${readmeObj.inference.inference_id || "unknown"}`,
          );
          console.log(
            `   ✓ Text length: ${readmeObj.text?.length || 0} chars`,
          );
          if (readmeObj.inference.chunks) {
            console.log(
              `   ✓ Chunks: ${readmeObj.inference.chunks.length} chunk(s)`,
            );
            const firstChunk = readmeObj.inference.chunks[0] || {};
            const embeddingArray =
              Array.isArray(firstChunk.embeddings)
                ? firstChunk.embeddings
                : Array.isArray(firstChunk.embeddings?.values)
                  ? firstChunk.embeddings.values
                  : Array.isArray(firstChunk.values)
                    ? firstChunk.values
                    : undefined;

            if (embeddingArray) {
              console.log(
                `   ✓ Embedding dimensions: ${embeddingArray.length}`,
              );
              if (SHOW_EMBEDDINGS) {
                const preview = embeddingArray.slice(0, 8);
                console.log(
                  `     • First values: ${preview.map((n: number) => Number(n).toFixed(4)).join(", ")}${embeddingArray.length > preview.length ? " …" : ""}`,
                );
              }
            } else {
              console.log("   ⚠️  Embedding vector present but format unrecognized");
              if (SHOW_EMBEDDINGS) {
                console.log(
                  `     • Raw chunk sample: ${JSON.stringify(firstChunk).slice(0, 200)}${JSON.stringify(firstChunk).length > 200 ? "…" : ""}`,
                );
              }
            }
          }
        } else if (typeof readmeObj === "string") {
          console.log("   ⚠️  Type: plain text (no embeddings!)");
          console.log(`   ⚠️  Length: ${readmeObj.length} chars`);
          if (SHOW_EMBEDDINGS) {
            console.log(
              `     • Raw content sample: ${readmeObj.slice(0, 120)}${readmeObj.length > 120 ? "…" : ""}`,
            );
          }
        } else {
          console.log("   ✓ Type: semantic_text");
          console.log(`   ✓ Length: ${String(doc.readme_content).length} chars`);
          if (SHOW_EMBEDDINGS) {
            console.log(
              `     • Raw content sample: ${JSON.stringify(doc.readme_content).slice(0, 200)}${JSON.stringify(doc.readme_content).length > 200 ? "…" : ""}`,
            );
          }
        }
      } else {
        console.log("\n❌ README Content: Missing!");
      }

      // Check source_code_content embedding
      if (doc.source_code_content) {
        const sourceType = typeof doc.source_code_content;
        const sourceObj =
          sourceType === "object" ? doc.source_code_content : null;

        console.log("\n✅ Source Code Content Field:");
        if (sourceObj && sourceObj.inference) {
          console.log("   ✓ Type: semantic_text with embeddings");
          console.log(
            `   ✓ Inference ID: ${sourceObj.inference.inference_id || "unknown"}`,
          );
          console.log(
            `   ✓ Text length: ${sourceObj.text?.length || 0} chars`,
          );
          if (sourceObj.inference.chunks) {
            console.log(
              `   ✓ Chunks: ${sourceObj.inference.chunks.length} chunk(s)`,
            );
            const firstChunk = sourceObj.inference.chunks[0] || {};
            const embeddingArray =
              Array.isArray(firstChunk.embeddings)
                ? firstChunk.embeddings
                : Array.isArray(firstChunk.embeddings?.values)
                  ? firstChunk.embeddings.values
                  : Array.isArray(firstChunk.values)
                    ? firstChunk.values
                    : undefined;

            if (embeddingArray) {
              console.log(
                `   ✓ Embedding dimensions: ${embeddingArray.length}`,
              );
              if (SHOW_EMBEDDINGS) {
                const preview = embeddingArray.slice(0, 8);
                console.log(
                  `     • First values: ${preview.map((n: number) => Number(n).toFixed(4)).join(", ")}${embeddingArray.length > preview.length ? " …" : ""}`,
                );
              }
            } else {
              console.log("   ⚠️  Embedding vector present but format unrecognized");
              if (SHOW_EMBEDDINGS) {
                console.log(
                  `     • Raw chunk sample: ${JSON.stringify(firstChunk).slice(0, 200)}${JSON.stringify(firstChunk).length > 200 ? "…" : ""}`,
                );
              }
            }
          }
        } else if (typeof sourceObj === "string") {
          console.log("   ⚠️  Type: plain text (no embeddings!)");
          console.log(`   ⚠️  Length: ${sourceObj.length} chars`);
          if (SHOW_EMBEDDINGS) {
            console.log(
              `     • Raw content sample: ${sourceObj.slice(0, 120)}${sourceObj.length > 120 ? "…" : ""}`,
            );
          }
        } else {
          console.log("   ✓ Type: semantic_text");
          console.log(`   ✓ Length: ${String(doc.source_code_content).length} chars`);
          if (SHOW_EMBEDDINGS) {
            console.log(
              `     • Raw content sample: ${JSON.stringify(doc.source_code_content).slice(0, 200)}${JSON.stringify(doc.source_code_content).length > 200 ? "…" : ""}`,
            );
          }
        }
      } else {
        console.log("\n⚠️  Source Code Content: Missing (no source code found)");
      }

      // Analyze symbols
      if (doc.symbols && Array.isArray(doc.symbols)) {
        console.log(`\n✅ Symbols: ${doc.symbols.length} symbols indexed`);

        const exportedSymbols = doc.symbols.filter(
          (s: any) => s.is_exported,
        ).length;
        const internalSymbols = doc.symbols.length - exportedSymbols;

        console.log(`   ✓ Exported: ${exportedSymbols}`);
        console.log(`   ✓ Internal: ${internalSymbols}`);

        // Show top symbols by relevance
        const topSymbols = [...doc.symbols]
          .sort((a: any, b: any) => (b.relevance_score || 0) - (a.relevance_score || 0))
          .slice(0, 5);

        console.log("\n   Top 5 symbols by relevance:");
        topSymbols.forEach((s: any, i: number) => {
          const exportBadge = s.is_exported ? "📤" : "🔒";
          console.log(
            `   ${i + 1}. ${exportBadge} ${s.kind} ${s.name} (score: ${s.relevance_score || 0})`,
          );
          console.log(`      File: ${s.file_path}`);
          console.log(
            `      Size: ${s.implementation?.length || 0} chars`,
          );
        });
      } else {
        console.log("\n⚠️  Symbols: None found");
      }
    }

    console.log("\n" + "─".repeat(60));
    console.log("\n✅ Verification Summary\n");

    // Summary stats
    const totalSymbols = documents.reduce(
      (sum, doc: any) => sum + (doc?.total_symbols || 0),
      0,
    );
    const totalFiles = documents.reduce(
      (sum, doc: any) => sum + (doc?.total_source_files || 0),
      0,
    );
    const totalSize = documents.reduce(
      (sum, doc: any) => sum + (doc?.total_source_size || 0),
      0,
    );

    console.log(`📦 Packages: ${documents.length}`);
    console.log(`🔧 Total Symbols: ${totalSymbols}`);
    console.log(`📄 Total Files: ${totalFiles}`);
    console.log(`💾 Total Source: ${Math.round(totalSize / 1024)}KB`);

    // Check embedding status
    const packagesWithEmbeddings = documents.filter((doc: any) => {
      const readme = doc?.readme_content;
      const source = doc?.source_code_content;
      const hasReadmeEmbedding =
        (readme && typeof readme === "object" && readme?.inference) ||
        typeof readme === "string";
      const hasSourceEmbedding =
        (source && typeof source === "object" && source?.inference) ||
        typeof source === "string";
      return hasReadmeEmbedding && hasSourceEmbedding;
    }).length;

    console.log(`\n✅ Packages with embeddings: ${packagesWithEmbeddings}/${documents.length}`);

    if (packagesWithEmbeddings === documents.length) {
      console.log("\n🎉 All packages have embeddings generated!");
    } else {
      console.log(
        "\n⚠️  Some packages missing embeddings. Check logs above.",
      );
      if (!SHOW_EMBEDDINGS) {
        console.log(
          "   (Run with --show-embeddings for raw field samples)",
        );
      }
    }

    console.log("\n" + "─".repeat(60));
    console.log("\n📋 Next Steps:");
    console.log("   1. Test semantic search: npm run test:search-simple");
    console.log("   2. Query actual implementations");
    console.log("   3. Verify search quality\n");
  } catch (error: any) {
    console.error("\n❌ Verification failed:", error.message);

    if (error.meta?.body?.error) {
      console.error("\nElasticsearch error:");
      console.error(JSON.stringify(error.meta.body.error, null, 2));
    }

    process.exit(1);
  } finally {
    await client.close();
  }
}

verifyEmbeddings();
const SHOW_EMBEDDINGS = process.argv.includes("--show-embeddings");
