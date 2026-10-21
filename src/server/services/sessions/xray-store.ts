// Storage rules for the "Radiografía del pensamiento". Items the teacher discarded stay
// stored (as discarded) so that a new analysis never brings them back; items the teacher
// validated or edited are kept across re-analyses (mergeReanalysis).
import { MAX_XRAY_ITEMS, mergeReanalysis, normalizeForMatch, sanitizeXrayItems, type XrayItem } from "@shared/domain/thinking-xray";

/** How many discarded items are remembered (oldest are forgotten first). */
export const MAX_REMEMBERED_DISCARDED = 60;

/** Reads stored items one by one (sanitizeXrayItems caps lists at 18, discarded ones included). */
export function readXrayItems(raw: unknown): XrayItem[] {
  if (!Array.isArray(raw)) return [];
  const out: XrayItem[] = [];
  const ids = new Set<string>();
  for (const r of raw) {
    const [item] = sanitizeXrayItems([r]);
    if (!item || ids.has(item.id)) continue;
    ids.add(item.id);
    out.push(item);
  }
  return out;
}

/** Same moment + category + quote = the same interpretation. */
export function xrayKey(i: Pick<XrayItem, "moment" | "category" | "evidence">): string {
  return `${i.moment}|${i.category}|${normalizeForMatch(i.evidence)}`;
}

/**
 * Merges a fresh AI analysis into what is stored:
 * - validated or edited items are kept (mergeReanalysis);
 * - unreviewed suggestions are replaced by the fresh ones;
 * - discarded items are kept as discarded and fresh items equal to them are dropped.
 */
export function mergeXray(previous: XrayItem[], fresh: XrayItem[]): { items: XrayItem[]; added: number; duplicates: number } {
  const discarded = previous.filter((i) => i.status === "discarded");
  const visible = previous.filter((i) => i.status !== "discarded");
  const kept = visible.filter((i) => i.status === "validated" || i.edited);
  const blocked = new Set([...discarded, ...kept].map(xrayKey));
  const seen = new Set<string>();
  const unique: XrayItem[] = [];
  let duplicates = 0;
  for (const f of fresh) {
    const k = xrayKey(f);
    if (blocked.has(k) || seen.has(k)) {
      duplicates++;
      continue;
    }
    seen.add(k);
    unique.push({ ...f, status: "suggested", edited: false });
  }
  const merged = mergeReanalysis(visible, unique);
  const added = merged.filter((i) => unique.includes(i)).length;
  return { items: [...merged, ...discarded.slice(-MAX_REMEMBERED_DISCARDED)], added, duplicates };
}

export function visibleXray(items: XrayItem[]): XrayItem[] {
  return items.filter((i) => i.status !== "discarded").slice(0, MAX_XRAY_ITEMS);
}

export function xrayCounts(raw: unknown): { validated: number; suggested: number; discarded: number } {
  const items = readXrayItems(raw);
  return {
    validated: items.filter((i) => i.status === "validated").length,
    suggested: items.filter((i) => i.status === "suggested").length,
    discarded: items.filter((i) => i.status === "discarded").length,
  };
}
