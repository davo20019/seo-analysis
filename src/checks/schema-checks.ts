import type { Issue } from "../types.js";

export type JsonLdObject = Record<string, unknown> & { "@type"?: string | string[] };

export function parseJsonLd(rawScripts: string[]): JsonLdObject[] {
  const objects: JsonLdObject[] = [];

  const visit = (value: unknown): void => {
    if (Array.isArray(value)) {
      value.forEach(visit);
      return;
    }
    if (!value || typeof value !== "object") return;
    const record = value as JsonLdObject;
    if (typeof record["@type"] === "string" || Array.isArray(record["@type"])) {
      objects.push(record);
    }
    if (Array.isArray(record["@graph"])) {
      record["@graph"].forEach(visit);
    }
  };

  for (const script of rawScripts) {
    try {
      visit(JSON.parse(script));
    } catch {
      // Ignore unparseable scripts — the existing analyzer already flags missing/empty schema separately.
    }
  }

  return objects;
}

function getType(obj: JsonLdObject): string[] {
  const t = obj["@type"];
  if (typeof t === "string") return [t];
  if (Array.isArray(t)) return t.filter((x): x is string => typeof x === "string");
  return [];
}

export function hasType(obj: JsonLdObject, type: string): boolean {
  return getType(obj).includes(type);
}
