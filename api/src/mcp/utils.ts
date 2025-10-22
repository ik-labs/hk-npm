import { packageResourceId } from "@npm-intel/shared/mcp";

export function parseResourceId(resourceId: string): string {
  const parsed = packageResourceId.parse(resourceId);
  return parsed.replace(/^npm-package:\/\//, "");
}

export function buildResourceId(packageName: string): string {
  return `npm-package://${packageName}`;
}
