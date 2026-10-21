// Minimal, safe Markdown for the tutor's replies: paragraphs, line breaks, **bold**,
// *italic*, `code`, bullet and numbered lists. Output is built as React elements from plain
// strings, so raw HTML is never interpreted; links show their text only (no navigation away
// from the activity). Tolerant of half-written markup while a reply streams.
import { Fragment, type ReactNode } from "react";
import { cn } from "@client/lib/cn";

type Block =
  | { type: "p"; text: string }
  | { type: "ul"; items: string[] }
  | { type: "ol"; items: string[]; start: number }
  | { type: "pre"; text: string };

const UL = /^\s{0,3}[-*•]\s+(.*)$/;
const OL = /^\s{0,3}(\d{1,3})[.)]\s+(.*)$/;

export function parseBlocks(src: string): Block[] {
  const lines = src.replace(/\r\n/g, "\n").split("\n");
  const blocks: Block[] = [];
  let para: string[] = [];
  const flush = () => {
    if (para.length) blocks.push({ type: "p", text: para.join("\n") });
    para = [];
  };
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]!;
    if (/^\s*```/.test(line)) {
      flush();
      const body: string[] = [];
      i++;
      while (i < lines.length && !/^\s*```/.test(lines[i]!)) body.push(lines[i++]!);
      blocks.push({ type: "pre", text: body.join("\n") });
      continue;
    }
    if (!line.trim()) {
      flush();
      continue;
    }
    const ul = UL.exec(line);
    const ol = OL.exec(line);
    if (ul || ol) {
      flush();
      const last = blocks[blocks.length - 1];
      if (ul) {
        if (last?.type === "ul") last.items.push(ul[1]!);
        else blocks.push({ type: "ul", items: [ul[1]!] });
      } else {
        if (last?.type === "ol") last.items.push(ol![2]!);
        else blocks.push({ type: "ol", items: [ol![2]!], start: Number(ol![1]) });
      }
      continue;
    }
    const last = blocks[blocks.length - 1];
    // A continuation line right after a list item belongs to that item.
    if (!para.length && (last?.type === "ul" || last?.type === "ol") && /^\s{2,}\S/.test(line)) {
      last.items[last.items.length - 1] += ` ${line.trim()}`;
      continue;
    }
    para.push(line.replace(/^\s{0,3}#{1,6}\s+/, "").replace(/^\s{0,3}>\s?/, ""));
  }
  flush();
  return blocks;
}

const INLINE =
  /(\*\*[^*\n]+?\*\*|__[^_\n]+?__|`[^`\n]+`|\*(?=\S)[^*\n]+?\*|(?<![\p{L}\p{N}_])_(?=\S)[^_\n]+?_(?![\p{L}\p{N}_])|\[[^\]\n]+\]\([^)\s]*\))/u;

export function renderInline(text: string, keyBase = "i"): ReactNode[] {
  const parts = text.split(new RegExp(INLINE.source, "gu"));
  const out: ReactNode[] = [];
  parts.forEach((part, idx) => {
    if (!part) return;
    const key = `${keyBase}-${idx}`;
    if ((part.startsWith("**") && part.endsWith("**") && part.length > 4) || (part.startsWith("__") && part.endsWith("__") && part.length > 4)) {
      out.push(
        <strong key={key} className="font-semibold text-ink">
          {part.slice(2, -2)}
        </strong>,
      );
    } else if (part.startsWith("`") && part.endsWith("`") && part.length > 2) {
      out.push(
        <code key={key} className="rounded bg-sunken px-1 py-0.5 font-mono text-[0.92em]">
          {part.slice(1, -1)}
        </code>,
      );
    } else if (part.startsWith("[") && part.includes("](")) {
      out.push(<Fragment key={key}>{part.slice(1, part.indexOf("]("))}</Fragment>);
    } else if (
      ((part.startsWith("*") && part.endsWith("*")) || (part.startsWith("_") && part.endsWith("_"))) &&
      part.length > 2
    ) {
      out.push(<em key={key}>{part.slice(1, -1)}</em>);
    } else {
      const lines = part.split("\n");
      lines.forEach((l, li) => {
        if (li > 0) out.push(<br key={`${key}-br${li}`} />);
        if (l) out.push(<Fragment key={`${key}-t${li}`}>{l}</Fragment>);
      });
    }
  });
  return out;
}

/**
 * Splits the closing question off a paragraph: "Muy bien. ¿Y si probás con 3/6?" →
 * { lead: "Muy bien.", question: "¿Y si probás con 3/6?" }. Null when it does not end in "?".
 */
export function splitTrailingQuestion(text: string): { lead: string; question: string } | null {
  const t = text.trim();
  if (!/\?["'»”)]*$/.test(t)) return null;
  const open = t.lastIndexOf("¿");
  if (open >= 0) return { lead: t.slice(0, open).trim(), question: t.slice(open).trim() };
  // English (or no opening mark): the last sentence.
  const m = /^(.*[.!?…:])\s+([^.!?…]*\?["'»”)]*)$/s.exec(t);
  return m ? { lead: m[1]!.trim(), question: m[2]!.trim() } : { lead: "", question: t };
}

export function Markdown({
  text,
  highlightQuestion = false,
  trailing,
  className,
}: {
  text: string;
  /** Render the closing question of the reply with the hanging "?" signature. */
  highlightQuestion?: boolean;
  /** Inline element after the last word (the streaming caret). */
  trailing?: ReactNode;
  className?: string;
}) {
  const blocks = parseBlocks(text);
  const lastIdx = blocks.length - 1;
  if (blocks.length === 0 && trailing) return <div className={className}>{trailing}</div>;
  return (
    <div className={cn("space-y-3 break-words", className)}>
      {blocks.map((b, i) => {
        const key = `b${i}`;
        if (b.type === "ul" || b.type === "ol") {
          const items = b.items.map((it, j) => (
            <li key={j} className="pl-1">
              {renderInline(it, `${key}-${j}`)}
              {i === lastIdx && j === b.items.length - 1 ? trailing : null}
            </li>
          ));
          return b.type === "ul" ? (
            <ul key={key} className="list-disc space-y-1 pl-5 marker:text-lilac">
              {items}
            </ul>
          ) : (
            <ol key={key} start={b.start} className="list-decimal space-y-1 pl-5 marker:text-text-3">
              {items}
            </ol>
          );
        }
        if (b.type === "pre") {
          return (
            <pre key={key} className="overflow-x-auto rounded-md bg-sunken px-3 py-2 font-mono text-sm leading-6 whitespace-pre">
              {b.text}
              {i === lastIdx ? trailing : null}
            </pre>
          );
        }
        if (highlightQuestion && i === lastIdx) {
          const split = splitTrailingQuestion(b.text);
          if (split) {
            return (
              <Fragment key={key}>
                {split.lead ? <p>{renderInline(split.lead, `${key}-lead`)}</p> : null}
                <p className="q-hang text-[18px] leading-7">{renderInline(split.question, `${key}-q`)}</p>
              </Fragment>
            );
          }
        }
        return (
          <p key={key}>
            {renderInline(b.text, key)}
            {i === lastIdx ? trailing : null}
          </p>
        );
      })}
    </div>
  );
}
