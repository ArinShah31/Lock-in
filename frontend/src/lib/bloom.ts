export type BloomLevel = "REMEMBER" | "UNDERSTAND" | "APPLY" | "ANALYZE" | "EVALUATE" | "CREATE";

export const BLOOM_LEVELS: BloomLevel[] = [
  "REMEMBER",
  "UNDERSTAND",
  "APPLY",
  "ANALYZE",
  "EVALUATE",
  "CREATE",
];

const BLOOM_LABELS: Record<BloomLevel, string> = {
  REMEMBER: "Remember",
  UNDERSTAND: "Understand",
  APPLY: "Apply",
  ANALYZE: "Analyze",
  EVALUATE: "Evaluate",
  CREATE: "Create",
};

const BLOOM_DIFFICULTY: Record<BloomLevel, string> = {
  REMEMBER: "easier",
  UNDERSTAND: "easier",
  APPLY: "medium",
  ANALYZE: "medium",
  EVALUATE: "harder",
  CREATE: "harder",
};

export function normalizeBloomLevel(level?: string | BloomLevel | null): BloomLevel {
  const value = String(level || "APPLY").toUpperCase() as BloomLevel;
  return BLOOM_LEVELS.includes(value) ? value : "APPLY";
}

export function bloomLabel(level?: string | BloomLevel | null): string {
  return BLOOM_LABELS[normalizeBloomLevel(level)];
}

export function bloomDifficulty(level?: string | BloomLevel | null): string {
  return BLOOM_DIFFICULTY[normalizeBloomLevel(level)];
}

export function bloomBadgeClass(level?: string | BloomLevel | null): string {
  const difficulty = bloomDifficulty(level);
  if (difficulty === "easier") {
    return "border-emerald-200 bg-emerald-50 text-emerald-800";
  }
  if (difficulty === "harder") {
    return "border-rose-200 bg-rose-50 text-rose-800";
  }
  return "border-amber-200 bg-amber-50 text-amber-800";
}
