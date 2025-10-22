"use client";

import { useRouter, usePathname } from "next/navigation";
import { useMemo, useState, useEffect } from "react";
import { PackageSearch, Plus, Loader2 } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { PACKAGES, slugifyPackage } from "@/lib/packages";
import { fetchPackageDocument } from "@/lib/fetch-package";

async function fetchAllIndexedPackages() {
  try {
    // Use the API endpoint that queries Elasticsearch directly
    const packagesResponse = await fetch('/api/packages');

    if (!packagesResponse.ok) {
      console.warn('Failed to fetch packages from API');
      return PACKAGES; // Fallback to static list
    }

    const data = await packagesResponse.json();
    const packages = data.packages || [];

    console.log(`📦 Loaded ${packages.length} packages from ${data.source || 'API'}:`, packages);
    return packages;
  } catch (error) {
    console.warn('Error loading packages:', error);
    return PACKAGES; // Fallback to static list
  }
}

export default function PackageDirectoryPage() {
const router = useRouter();
const pathname = usePathname();
const [filter, setFilter] = useState("");
const [packageUrl, setPackageUrl] = useState("");
const [isSubmitting, setIsSubmitting] = useState(false);
const [error, setError] = useState("");
const [allPackages, setAllPackages] = useState<string[]>([...PACKAGES]);
const [isLoadingPackages, setIsLoadingPackages] = useState(true);
const [pendingSlug, setPendingSlug] = useState<string | null>(null);

  // Load all indexed packages on mount
  useEffect(() => {
    fetchAllIndexedPackages().then((packages) => {
      setAllPackages(packages);
      setIsLoadingPackages(false);
    });
  }, []);

  useEffect(() => {
    setPendingSlug(null);
  }, [pathname]);

  const filteredPackages = useMemo(() => {
    const term = filter.trim().toLowerCase();
    if (!term) return allPackages;
    return allPackages.filter((pkg) => pkg.toLowerCase().includes(term));
  }, [filter, allPackages]);

  const extractPackageName = (url: string): string | null => {
    try {
      const urlObj = new URL(url);
      if (urlObj.hostname !== 'www.npmjs.com' && urlObj.hostname !== 'npmjs.com') {
        return null;
      }
      const pathParts = urlObj.pathname.split('/').filter(Boolean);
      if (pathParts.length < 2 || pathParts[0] !== 'package') {
        return null;
      }
      return pathParts.slice(1).join('/');
    } catch {
      return null;
    }
  };

  const handlePackageSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError("");
    setIsSubmitting(true);

    const packageName = extractPackageName(packageUrl.trim());
    if (!packageName) {
      setError("Please enter a valid npm package URL (e.g., https://www.npmjs.com/package/package-name)");
      setIsSubmitting(false);
      return;
    }

    try {
      // Check if package already exists
      console.log(`🔍 Checking if package ${packageName} exists...`);
      const searchResponse = await fetch(`/api/search`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ query: packageName, limit: 1 })
      });

      console.log(`🔍 Search response status: ${searchResponse.status}`);

      if (!searchResponse.ok) {
        console.error(`🔍 Search failed with status: ${searchResponse.status}`);
        throw new Error('Search failed');
      }

      const searchData = await searchResponse.json();
      console.log(`🔍 Search results:`, searchData);
      const existingPackage = searchData.results?.[0];

      if (existingPackage) {
        console.log(`🔍 Found existing package:`, existingPackage.name);
      } else {
        console.log(`🔍 Package ${packageName} not found in search results`);
      }

      if (existingPackage && existingPackage.name === packageName) {
        // Package exists, navigate to it
        const slug = slugifyPackage(packageName as any);
        console.log(`📦 Package ${packageName} exists, navigating to /${slug}`);
        router.push(`/${slug}`);
        return;
      }

      // Package doesn't exist, request indexing
      console.log(`📦 Package ${packageName} not found, requesting indexing...`);
      const indexResponse = await fetch(`/api/index`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ packageName })
      });

      console.log(`📦 Index response status: ${indexResponse.status}`);

      if (!indexResponse.ok) {
        const errorData = await indexResponse.json();
        console.error(`📦 Indexing failed:`, errorData);
        throw new Error(errorData.error || 'Indexing failed');
      }

      const indexData = await indexResponse.json();
      console.log(`📦 Indexing response:`, indexData);

      // Success - package has been indexed, refresh the package list
      setError("");
      setPackageUrl("");

      // Refresh the package list to include the newly indexed package
      const updatedPackages = await fetchAllIndexedPackages();
      setAllPackages(updatedPackages);

      alert(`🎉 ${packageName} has been indexed! It's now available for chatting.`);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Something went wrong');
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <div className="flex min-h-screen flex-col bg-background">
      <header className="border-b border-border/40 bg-card/70 backdrop-blur supports-[backdrop-filter]:bg-card/60">
        <div className="mx-auto flex w-full max-w-6xl flex-col gap-4 px-4 py-8 lg:px-6">
          <div className="flex flex-wrap items-end justify-between gap-4">
            <div>
              <h1 className="text-3xl font-semibold tracking-tight">NPM Intel</h1>
              <p className="mt-1 max-w-2xl text-sm text-muted-foreground">
                Browse grounded chats for popular npm packages. Each page combines Elastic
                hybrid search with live Gemini code generation, so every snippet comes from real source code.
              </p>
            </div>
            <div className="flex flex-wrap gap-2">
            <Badge className="gap-1">
            <PackageSearch className="h-3.5 w-3.5" />
            {isLoadingPackages ? "Loading..." : `${allPackages.length} packages indexed`}
            </Badge>
            </div>
          </div>
          <div className="flex flex-col gap-4 sm:flex-row sm:items-center">
          <Input
            placeholder="Filter packages…"
            value={filter}
            onChange={(event) => setFilter(event.target.value)}
              className="w-full sm:max-w-sm"
            />

            <form onSubmit={handlePackageSubmit} className="flex flex-col gap-2 sm:flex-row sm:items-center sm:gap-2">
              <Input
                placeholder="Paste npm package URL (e.g., https://www.npmjs.com/package/zod)"
                value={packageUrl}
                onChange={(event) => setPackageUrl(event.target.value)}
                className="w-full sm:min-w-[400px]"
                disabled={isSubmitting}
              />
              <Button
                type="submit"
                variant="secondary"
                disabled={isSubmitting || !packageUrl.trim()}
                className="sm:w-auto shadow-secondary/30 hover:shadow-secondary/40 transition-shadow"
              >
                {isSubmitting ? (
                  <>
                    <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                    Processing…
                  </>
                ) : (
                  <>
                    <Plus className="mr-2 h-4 w-4" />
                    Index Package
                  </>
                )}
              </Button>
            </form>
          </div>

          {error && (
            <div className="rounded-lg border border-destructive/40 bg-destructive/5 px-4 py-3">
              <p className="text-sm text-destructive">{error}</p>
            </div>
          )}
        </div>
      </header>

      <main className="mx-auto flex w-full max-w-6xl flex-1 flex-col gap-6 px-4 py-8 lg:px-6">
      {isLoadingPackages ? (
          <div className="flex items-center justify-center py-12">
            <div className="flex items-center gap-3 text-muted-foreground">
              <Loader2 className="h-5 w-5 animate-spin" />
              <span>Loading packages...</span>
            </div>
          </div>
        ) : (
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {filteredPackages.map((pkg) => {
            const slug = slugifyPackage(pkg);
            return (
              <Card key={pkg} className="border-border/50 bg-card/80 shadow-sm transition hover:shadow-md">
                <CardHeader>
                  <CardTitle className="text-lg">{pkg}</CardTitle>
                  <CardDescription className="text-xs text-muted-foreground">
                    Chat with grounded docs, source snippets, and TypeScript generation.
                  </CardDescription>
                </CardHeader>
                <CardContent className="flex items-center justify-between gap-2 pt-0">
                  <Button
                    variant="secondary"
                    className="w-full"
                    disabled={pendingSlug !== null && pendingSlug !== slug}
                    onClick={() => {
                      setPendingSlug(slug);
                      router.push(`/${slug}`);
                    }}
                  >
                    {pendingSlug === slug ? (
                      <span className="flex items-center justify-center gap-2">
                        <Loader2 className="h-4 w-4 animate-spin" />
                        Navigating…
                      </span>
                    ) : (
                      "Open chat"
                    )}
                  </Button>
                </CardContent>
              </Card>
            );
          })}
          {filteredPackages.length === 0 && (
            <Card className="border-dashed bg-card/60">
            <CardHeader>
            <CardTitle className="text-base">No packages found</CardTitle>
            <CardDescription>
            Try a different filter or explore the full list of indexed libraries.
            </CardDescription>
            </CardHeader>
            </Card>
            )}
            </div>
        )}
      </main>
    </div>
  );
}
