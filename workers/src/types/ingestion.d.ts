declare module "../../../src/ingestion/indexer.js" {
  export function indexPackages(packages: string[]): Promise<void>;
}
