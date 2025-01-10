import { minimatch } from "minimatch";

export function matchesPatterns(path: string, patterns: string[]): boolean {
  return patterns.some((pattern) => minimatch(path, pattern, { dot: true }));
}

export function isExcluded(path: string, excludePatterns: string[]): boolean {
  return matchesPatterns(path, excludePatterns);
}
