import { useEffect } from "react";

type TitlePart = string | null | undefined | false;

/** "El agua en la montaña · En vivo · Aula Socrática" (empty parts are skipped). */
export function pageTitle(title: TitlePart | readonly TitlePart[]): string {
  const parts = (Array.isArray(title) ? title : [title]).map((p) => (typeof p === "string" ? p.trim() : "")).filter(Boolean);
  return parts.length ? `${parts.join(" · ")} · Aula Socrática` : "Aula Socrática";
}

/**
 * Sets the document title while the screen is mounted, so every tab and every screen-reader
 * page announcement names the screen (WCAG 2.4.2). Pass the most specific part first:
 * `usePageTitle([activity.title, "En vivo"])` → "El agua en la montaña · En vivo · Aula Socrática".
 */
export function usePageTitle(title: TitlePart | readonly TitlePart[], opts: { noindex?: boolean } = {}) {
  const text = pageTitle(title);
  useEffect(() => {
    const prev = document.title;
    document.title = text;
    let meta: HTMLMetaElement | null = null;
    if (opts.noindex) {
      meta = document.createElement("meta");
      meta.name = "robots";
      meta.content = "noindex, nofollow";
      document.head.appendChild(meta);
    }
    return () => {
      document.title = prev;
      meta?.remove();
    };
  }, [text, opts.noindex]);
}
