import type { Model } from "../types";

export async function importModelFromJson(file: File): Promise<Model> {
  const text = await file.text();
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    throw new Error("File is not valid JSON.");
  }

  if (
    typeof parsed !== "object" ||
    parsed === null ||
    !("name" in parsed) ||
    !("nodes" in parsed) ||
    !("edges" in parsed) ||
    !Array.isArray((parsed as Record<string, unknown>).nodes) ||
    !Array.isArray((parsed as Record<string, unknown>).edges)
  ) {
    throw new Error(
      "Invalid model file: must contain name, nodes (array), and edges (array)."
    );
  }

  const m = parsed as Model;
  const now = new Date().toISOString();
  return {
    ...m,
    id: crypto.randomUUID().replace(/-/g, ""),
    createdAt: now,
    updatedAt: now,
  };
}
