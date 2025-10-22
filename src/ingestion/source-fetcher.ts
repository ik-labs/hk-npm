import * as dotenv from "dotenv";
import * as tar from "tar";
import { Readable } from "stream";
import { Octokit } from "@octokit/rest";
import * as fs from "fs";
import * as os from "os";
import * as path from "path";

dotenv.config();

export interface SourceFile {
  path: string;
  content: string;
  size: number;
}

export interface SourceCodeResult {
  files: SourceFile[];
  strategy: "github" | "tarball" | "unpkg";
  totalSize: number;
}

/**
 * Extract GitHub repo info from package.json repository field
 */
function parseGitHubRepo(
  repoUrl: string,
): { owner: string; repo: string } | null {
  if (!repoUrl) return null;

  // Handle various formats:
  // - "github:user/repo"
  // - "git+https://github.com/user/repo.git"
  // - "https://github.com/user/repo"
  // - { type: "git", url: "..." }

  const match =
    repoUrl.match(/github\.com[/:]([\w.-]+)\/([\w.-]+)/i) ||
    repoUrl.match(/^github:([\w.-]+)\/([\w.-]+)/i);

  if (match) {
    return { owner: match[1], repo: match[2].replace(/\.git$/, "") };
  }

  return null;
}

/**
 * Fetch source code from GitHub repository
 */
export async function fetchFromGitHub(
  repoUrl: string,
  ref: string = "main",
): Promise<SourceCodeResult | null> {
  const repoInfo = parseGitHubRepo(repoUrl);
  if (!repoInfo) return null;

  console.log(
    `     📂 Fetching from GitHub: ${repoInfo.owner}/${repoInfo.repo}`,
  );

  try {
    const octokit = new Octokit({
      auth: process.env.GITHUB_TOKEN, // Optional - higher rate limits if provided
    });

    // Try main branch, fallback to master
    let tree;
    try {
      const { data: mainBranch } = await octokit.repos.getBranch({
        owner: repoInfo.owner,
        repo: repoInfo.repo,
        branch: ref,
      });
      tree = mainBranch.commit.commit.tree.sha;
    } catch {
      // Try master branch
      const { data: masterBranch } = await octokit.repos.getBranch({
        owner: repoInfo.owner,
        repo: repoInfo.repo,
        branch: "master",
      });
      tree = masterBranch.commit.commit.tree.sha;
    }

    // Get recursive tree of all files
    const { data: treeData } = await octokit.git.getTree({
      owner: repoInfo.owner,
      repo: repoInfo.repo,
      tree_sha: tree,
      recursive: "true",
    });

    // Filter for source files in src/ or lib/ directories
    const sourceFilePatterns = /\.(ts|js|tsx|jsx)$/;
    const sourceDirectories = /(^|\/)(src|lib|dist)\//;
    const additionalDirectories = /(^|\/)(types?|definitions?|esm|cjs)\//;
    const topLevelFile = /^[^/]+\.(ts|js|tsx|jsx)$/;
    const excludePatterns = /\.(test|spec|stories)\.(ts|js)$/; // Exclude tests and story files

    const relevantFiles = (treeData.tree || []).filter(
      (item) =>
        item.type === "blob" &&
        item.path &&
        sourceFilePatterns.test(item.path) &&
        (sourceDirectories.test(item.path) ||
          additionalDirectories.test(item.path) ||
          topLevelFile.test(item.path)) &&
        !excludePatterns.test(item.path) &&
        (item.size || 0) < 100000, // Skip files > 100KB
    );

    console.log(`     ✓ Found ${relevantFiles.length} source files`);

    // Fetch content for each file (limit to first 20 files for MVP)
    const files: SourceFile[] = [];
    let totalSize = 0;

    for (const file of relevantFiles.slice(0, 20)) {
      try {
        const { data: blob } = await octokit.git.getBlob({
          owner: repoInfo.owner,
          repo: repoInfo.repo,
          file_sha: file.sha!,
        });

        const content = Buffer.from(blob.content, "base64").toString("utf-8");
        files.push({
          path: file.path!,
          content,
          size: content.length,
        });
        totalSize += content.length;
      } catch (error) {
        console.log(`     ⚠️  Failed to fetch ${file.path}`);
      }
    }

    console.log(
      `     ✓ Downloaded ${files.length} files (${Math.round(totalSize / 1024)}KB)`,
    );

    return {
      files,
      strategy: "github",
      totalSize,
    };
  } catch (error: any) {
    console.log(`     ⚠️  GitHub fetch failed: ${error.message}`);
    return null;
  }
}

/**
 * Fetch source code from npm tarball
 */
export async function fetchFromNpmTarball(
  packageName: string,
  version: string,
): Promise<SourceCodeResult | null> {
  console.log(`     📦 Fetching tarball from npm registry`);

  const tempDir = path.join(os.tmpdir(), `npm-intel-${Date.now()}`);

  try {
    // Get package metadata to find tarball URL
    const semver =
      typeof version === "string" ? version.replace(/^v/, "") : version;
    const registryUrl = `https://registry.npmjs.org/${packageName}/${semver}`;
    const metadataRes = await fetch(registryUrl);

    if (!metadataRes.ok) {
      throw new Error(`Failed to fetch metadata: ${metadataRes.status}`);
    }

    const metadata = (await metadataRes.json()) as {
      dist?: { tarball?: string };
    };
    const tarballUrl = metadata.dist?.tarball;

    if (!tarballUrl) {
      throw new Error("No tarball URL found");
    }

    // Download tarball
    const tarballRes = await fetch(tarballUrl);
    if (!tarballRes.ok) {
      throw new Error(`Failed to download tarball: ${tarballRes.status}`);
    }

    const buffer = Buffer.from(await tarballRes.arrayBuffer());

    // Create temp directory
    fs.mkdirSync(tempDir, { recursive: true });

    // Write tarball to temp file
    const tarballPath = path.join(tempDir, "package.tgz");
    fs.writeFileSync(tarballPath, buffer);

    // Extract tarball to temp directory
    await tar.x({
      file: tarballPath,
      cwd: tempDir,
    });

    // Read extracted files
    const files: SourceFile[] = [];
    let totalSize = 0;

    const sourceFilePatterns = /\.(ts|js|tsx|jsx)$/;
    const excludePatterns = /\.(test|spec|stories)\.(ts|js)$/;
    const sourceDirectories = /(^|\/)(src|lib|dist)\//;
    const additionalDirectories = /(^|\/)(types?|definitions?|esm|cjs)\//;
    const topLevelFile = /^[^/]+\.(ts|js|tsx|jsx)$/;

    const packageDir = path.join(tempDir, "package");

    // Recursively read source files
    function readSourceFiles(dir: string, basePath: string = "") {
      try {
        const entries = fs.readdirSync(dir, { withFileTypes: true });

        for (const entry of entries) {
          const fullPath = path.join(dir, entry.name);
          const relativePath = path.join(basePath, entry.name);

          if (entry.isDirectory()) {
            // Skip obvious non-source folders
            if (
              entry.name === "node_modules" ||
              entry.name === "coverage" ||
              entry.name === ".git"
            ) {
              continue;
            }
            readSourceFiles(fullPath, relativePath);
          } else if (entry.isFile()) {
            const normalizedPath = relativePath.replace(/\\/g, "/");
            // Check if it's a source file
            if (
              sourceFilePatterns.test(entry.name) &&
              !excludePatterns.test(entry.name) &&
              (sourceDirectories.test(normalizedPath) ||
                additionalDirectories.test(normalizedPath) ||
                topLevelFile.test(normalizedPath))
            ) {
              try {
                const content = fs.readFileSync(fullPath, "utf-8");
                const size = Buffer.byteLength(content);

                // Skip very large files
                if (size < 100000) {
                  files.push({
                    path: normalizedPath,
                    content,
                    size,
                  });
                  totalSize += size;
                }
              } catch (readError) {
                // Skip files that can't be read
              }
            }
          }
        }
      } catch (dirError) {
        // Skip directories that can't be read
      }
    }

    if (fs.existsSync(packageDir)) {
      readSourceFiles(packageDir);
    }

    console.log(
      `     ✓ Extracted ${files.length} source files (${Math.round(totalSize / 1024)}KB)`,
    );

    return {
      files,
      strategy: "tarball",
      totalSize,
    };
  } catch (error: any) {
    console.log(`     ⚠️  Tarball fetch failed: ${error.message}`);
    return null;
  } finally {
    // Cleanup temp directory
    try {
      if (fs.existsSync(tempDir)) {
        fs.rmSync(tempDir, { recursive: true, force: true });
      }
    } catch (cleanupError) {
      // Ignore cleanup errors
    }
  }
}

/**
 * Fallback: Fetch individual files from unpkg
 */
export async function fetchFromUnpkg(
  packageName: string,
  version: string,
): Promise<SourceCodeResult | null> {
  console.log(`     🌐 Fetching from unpkg CDN`);

  const commonPaths = [
    "/src/index.ts",
    "/src/index.js",
    "/src/client.ts",
    "/src/main.ts",
    "/lib/index.js",
    "/lib/main.js",
  ];

  const files: SourceFile[] = [];
  let totalSize = 0;

  for (const path of commonPaths) {
    try {
      const url = `https://unpkg.com/${packageName}@${version}${path}`;
      const res = await fetch(url);

      if (res.ok) {
        const content = await res.text();
        files.push({
          path,
          content,
          size: content.length,
        });
        totalSize += content.length;
      }
    } catch {
      // Silently skip missing files
    }
  }

  if (files.length === 0) return null;

  console.log(`     ✓ Found ${files.length} files on unpkg`);

  return {
    files,
    strategy: "unpkg",
    totalSize,
  };
}

/**
 * Main function: Try multiple strategies to fetch source code
 */
export async function fetchSourceCode(
  packageName: string,
  version: string,
  repoUrl?: string,
): Promise<SourceCodeResult | null> {
  // Strategy 1: Try GitHub if repo URL is available
  if (repoUrl) {
    const githubResult = await fetchFromGitHub(repoUrl);
    if (githubResult && githubResult.files.length > 0) {
      return githubResult;
    }
  }

  // Strategy 2: Try npm tarball
  const tarballResult = await fetchFromNpmTarball(packageName, version);
  if (tarballResult && tarballResult.files.length > 0) {
    return tarballResult;
  }

  // Strategy 3: Fallback to unpkg
  const unpkgResult = await fetchFromUnpkg(packageName, version);
  if (unpkgResult && unpkgResult.files.length > 0) {
    return unpkgResult;
  }

  console.log(`     ❌ Could not fetch source code from any source`);
  return null;
}
