// The app's accent color (focus, the current menu item, the tutor's "?", tours). One for the whole
// app, chosen by a teacher with the "elegir apariencia" permission (today, the same teachers the
// admin enabled for "Pedidos de cambios"). The colors themselves live in styles.css
// (:root[data-accent="…"]); green and amber stay out because they already mean "en vivo / logrado"
// and "aviso".

export const ACCENTS = ["azul", "cielo", "turquesa", "coral", "frambuesa", "lila", "grafito"] as const;
export type Accent = (typeof ACCENTS)[number];

export const DEFAULT_ACCENT: Accent = "azul";

/** Name and a sample of each color (its light-mode text tone) for the picker. */
export const ACCENT_INFO: Record<Accent, { name: string; swatch: string }> = {
  azul: { name: "Azul", swatch: "#2456c9" },
  cielo: { name: "Cielo", swatch: "#0b6c9e" },
  turquesa: { name: "Turquesa", swatch: "#0f7d75" },
  coral: { name: "Coral", swatch: "#c2410c" },
  frambuesa: { name: "Frambuesa", swatch: "#be185d" },
  lila: { name: "Lila", swatch: "#5a3fcf" },
  grafito: { name: "Grafito", swatch: "#3f4a5c" },
};

export function isAccent(v: unknown): v is Accent {
  return typeof v === "string" && (ACCENTS as readonly string[]).includes(v);
}
