import { notFound } from "next/navigation";
import Link from "next/link";

import { headers } from "next/headers";
import { packageMap, PACKAGES, slugifyPackage } from "@/lib/packages";
import { fetchPackageDocument } from "@/lib/fetch-package";
import { buildPresets } from "@/lib/presets";
import { PackageChat } from "@/components/package/chat";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { ReindexButton } from "@/components/package/reindex-button";

// Function to get all indexed packages from API
async function getAllPackages() {
  try {
    const headerList = headers();
    const host =
      headerList.get("x-forwarded-host") ??
      headerList.get("host") ??
      "localhost:3001";
    const protocol = headerList.get("x-forwarded-proto") ?? "http";

    const packagesResponse = await fetch(`${protocol}://${host}/api/packages`, {
      cache: "no-store",
    });
    if (packagesResponse.ok) {
      const data = await packagesResponse.json();
      return data.packages || [];
    }
  } catch (error) {
    console.warn('Error fetching packages:', error);
  }
  return PACKAGES; // Fallback
}

export function generateStaticParams() {
  return PACKAGES.map((pkg) => ({ slug: slugifyPackage(pkg) }));
}

export default async function PackagePage({
  params,
}: {
  params: { slug: string };
}) {
  const initialPackage = packageMap[params.slug as keyof typeof packageMap];
  let pkgName: string | undefined = initialPackage;

  // If not found in static package map, try to find it dynamically
  if (!pkgName) {
    console.log(`Package slug "${params.slug}" not found in static map, searching dynamically...`);

    // First try to find it by checking if any package slugifies to this slug
    const allStaticPackages = Object.values(packageMap);
    pkgName = allStaticPackages.find((pkg) => slugifyPackage(pkg) === params.slug);

    // If still not found, try to find dynamically indexed packages by checking all packages
    if (!pkgName) {
      try {
        // Get all packages and find one that matches this slug
        const allPackages = await getAllPackages();

        // Find a package whose slugified name matches the URL slug
        pkgName = allPackages.find((pkg: string) => slugifyPackage(pkg) === params.slug);

        if (pkgName) {
          console.log(`Found dynamically indexed package: ${pkgName} for slug: ${params.slug}`);
        }
      } catch (error) {
        console.warn("Error searching for package by slug:", error);
      }
    }
  }

  if (!pkgName) {
    console.log(`Package not found for slug: ${params.slug}`);
    notFound();
  }

  console.log(`Rendering package page for ${pkgName} (slug: ${params.slug})`);

  const doc = await fetchPackageDocument(pkgName);
  if (!doc) {
    console.log(`Package document not found for: ${pkgName}`);
    notFound();
  }

  const stats: string[] = [];
  if (typeof doc.total_symbols === "number") {
    stats.push(`${doc.total_symbols} symbols indexed`);
  }
  if (doc.source_strategy) {
    stats.push(`source: ${doc.source_strategy}`);
  }
  // Handle keywords as either array or string (split by comma/space if string)
  const keywordsArray = Array.isArray(doc.keywords)
    ? doc.keywords
    : typeof doc.keywords === 'string'
    ? doc.keywords.split(/[, ]+/).filter(Boolean)
    : [];
  const keywords = keywordsArray.slice(0, 6);
  const presets = buildPresets(doc);

  return (
    <div className="mx-auto flex min-h-screen w-full max-w-6xl flex-col gap-6 px-4 py-6 lg:px-6">
      <Link
        href="/"
        className="text-sm text-muted-foreground transition hover:text-foreground"
      >
        ← Back to package directory
      </Link>

      <div className="grid flex-1 gap-6 lg:grid-cols-[320px_1fr]">
        <aside className="flex flex-col gap-4">
          <Card className="border-border/50 bg-card/80 shadow-sm">
            <CardHeader>
              <CardTitle className="text-xl">{doc.name}</CardTitle>
              <CardDescription>
                Version {doc.version}
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-3 text-sm text-muted-foreground">
              {doc.description && <p>{doc.description}</p>}
              {stats.length > 0 && (
                <div className="flex flex-wrap gap-2">
                  {stats.map((stat) => (
                    <Badge key={stat} variant="outline">
                      {stat}
                    </Badge>
                  ))}
                </div>
              )}
              {keywords.length > 0 && (
                <div className="flex flex-wrap gap-1.5">
                  {keywords.map((keyword) => (
                    <Badge key={keyword}>
                      {keyword}
                    </Badge>
                  ))}
                </div>
              )}
              <div className="pt-2">
                <ReindexButton packageName={doc.name} />
              </div>
            </CardContent>
          </Card>

          <Card className="border-border/50 bg-card/80 shadow-sm">
            <CardHeader>
              <CardTitle className="text-base">Grounded context</CardTitle>
              <CardDescription>
                How NPM Intel answers your questions.
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-2 text-sm text-muted-foreground">
              <p>
                Every response is grounded in the live {doc.name} source code indexed by Elastic. We fetch the
                package from npm, parse README snippets and TypeScript/JavaScript implementations, and use Gemini to
                generate TypeScript strictly limited to APIs present in that context.
              </p>
            </CardContent>
          </Card>
        </aside>

        <div className="flex h-full flex-col">
          <PackageChat
            packageName={doc.name}
            version={doc.version}
            description={doc.description}
            presets={presets}
          />
        </div>
      </div>
    </div>
  );
}
