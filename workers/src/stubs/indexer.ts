export async function getIndexer() {
  const moduleUrl = new URL("../../../src/ingestion/indexer.js", import.meta.url);
  const module: any = await import(moduleUrl.href);
  const indexPackages: ((packages: string[]) => Promise<void>) = module.indexPackages ?? module.default;

  if (typeof indexPackages !== "function") {
    throw new Error("indexPackages export missing");
  }

  return { indexPackages };
}
