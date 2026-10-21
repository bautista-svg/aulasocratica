import { useEffect } from "react";

/** Sets the document title ("Informes · Aula Socrática") while the screen is mounted. */
export function usePageTitle(title: string | null | undefined, opts: { noindex?: boolean } = {}) {
  useEffect(() => {
    const prev = document.title;
    document.title = title ? `${title} · Aula Socrática` : "Aula Socrática";
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
  }, [title, opts.noindex]);
}
