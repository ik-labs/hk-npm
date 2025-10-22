import * as dotenv from "dotenv";

dotenv.config();

const UNPKG_BASE = "https://unpkg.com";

export interface PackageJson {
  name: string;
  version: string;
  description?: string;
  keywords?: string[];
  [key: string]: any;
}

export interface PackageData {
  pkgJson: PackageJson;
  readme: string;
  dts: string;
}

export interface ExportInfo {
  kind: string;
  name: string;
  signature: string;
  jsdoc?: string;
}

/**
 * Fetch package data from unpkg CDN
 */
export async function fetchPackage(
  pkg: string,
  version: string = "latest"
): Promise<PackageData> {
  const base = `${UNPKG_BASE}/${pkg}@${version}`;

  console.log(`  📦 Fetching ${pkg}@${version}...`);

  try {
    const [pkgJsonRes, readmeRes, dtsRes] = await Promise.allSettled([
      fetch(`${base}/package.json`).then((r) => {
        if (!r.ok) throw new Error(`Failed to fetch package.json: ${r.status}`);
        return r.json();
      }),
      fetch(`${base}/README.md`).then((r) => {
        if (!r.ok) return "";
        return r.text();
      }),
      fetch(`${base}/dist/index.d.ts`).then((r) => {
        if (!r.ok) return "";
        return r.text();
      }),
    ]);

    const pkgJson =
      pkgJsonRes.status === "fulfilled"
        ? (pkgJsonRes.value as PackageJson)
        : { name: pkg, version: "unknown" };
    const readme = readmeRes.status === "fulfilled" ? readmeRes.value : "";
    const dts = dtsRes.status === "fulfilled" ? dtsRes.value : "";

    console.log(`     ✓ package.json: ${pkgJsonRes.status}`);
    console.log(`     ✓ README.md: ${readme ? `${readme.length} chars` : "not found"}`);
    console.log(`     ✓ index.d.ts: ${dts ? `${dts.length} chars` : "not found"}`);

    return { pkgJson, readme, dts };
  } catch (error: any) {
    console.error(`     ✗ Error fetching ${pkg}:`, error.message);
    throw error;
  }
}

/**
 * Extract exports (functions, classes, interfaces, types, consts) from .d.ts file
 * Uses simple regex - good enough for MVP
 */
export function extractExportsSimple(dts?: string): ExportInfo[] {
  if (!dts) return [];

  const exports: ExportInfo[] = [];

  // Match: export function/class/interface/type/const name
  const exportRegex =
    /export\s+(function|class|interface|type|const|enum)\s+([A-Za-z0-9_$]+)/g;

  let match;
  while ((match = exportRegex.exec(dts)) !== null) {
    const kind = match[1];
    const name = match[2];
    const startIndex = match.index;

    // Extract a reasonable signature snippet (up to 400 chars or 6 lines)
    const snippet = dts.slice(startIndex, startIndex + 400);
    const lines = snippet.split("\n").slice(0, 6);
    const signature = lines.join("\n").trim();

    // Try to find JSDoc comment before the export
    const beforeExport = dts.slice(Math.max(0, startIndex - 500), startIndex);
    const jsdocMatch = beforeExport.match(/\/\*\*([\s\S]*?)\*\//g);
    const jsdoc = jsdocMatch ? jsdocMatch[jsdocMatch.length - 1] : undefined;

    exports.push({
      kind,
      name,
      signature,
      jsdoc,
    });
  }

  return exports;
}

/**
 * Extract code blocks from markdown (ts/js/typescript/javascript fenced blocks)
 */
export function extractCodeBlocks(markdown: string): string[] {
  if (!markdown) return [];

  const codeBlocks: string[] = [];

  // Match fenced code blocks with optional language
  const fenceRegex = /```(?:ts|js|typescript|javascript)?\n([\s\S]*?)```/g;

  let match;
  while ((match = fenceRegex.exec(markdown)) !== null) {
    const code = match[1].trim();
    if (code) {
      codeBlocks.push(code);
    }
  }

  return codeBlocks;
}

/**
 * Prepare the readme_content field for semantic_text indexing
 * Combines README + code examples
 */
export function prepareReadmeContent(
  readme: string,
  codeBlocks: string[]
): string {
  const codeSection =
    codeBlocks.length > 0
      ? `\n\n## Code Examples\n\n${codeBlocks.join("\n\n")}`
      : "";

  return `${readme}${codeSection}`;
}
