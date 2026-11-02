// Each classroom keeps one color wherever it shows (its initial on a tinted square). The tint is
// derived from the id, so it needs no storage and is the same on every screen and device.
const ROOM_COLORS = ["#3f9d73", "#4a7fd6", "#d39a2e", "#d9607a", "#7d62e6", "#2aa3aa", "#d0784c", "#8aa83a"];

export function roomColor(id: string): string {
  let h = 0;
  for (const ch of id) h = (h * 31 + ch.charCodeAt(0)) >>> 0;
  return ROOM_COLORS[h % ROOM_COLORS.length]!;
}

/** Two letters for the square: "2.º A · Historia" → "2A", "Biología" → "BI". */
export function roomInitials(name: string): string {
  const compact = name.replace(/[.º°·]/g, " ").trim();
  const grade = /^(\d+)\s*([A-Za-zÁÉÍÓÚÑ])?\b/.exec(compact);
  if (grade) return `${grade[1]}${grade[2] ?? ""}`.toUpperCase().slice(0, 3);
  const words = compact.split(/\s+/).filter(Boolean);
  return ((words[0]?.[0] ?? "") + (words[1]?.[0] ?? words[0]?.[1] ?? "")).toUpperCase();
}
