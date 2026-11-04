// A fragment of code as students and teachers read it: file name, line numbers and a light
// highlight in the app's own colors (both themes). Built from React text, nothing is interpreted.
import type { ReactNode } from "react";
import { FileCode2 } from "lucide-react";
import { cn } from "@client/lib/cn";

const TOKEN =
  /(\/\*.*?(?:\*\/|$)|<!--.*?(?:-->|$)|\/\/.*$)|("(?:[^"\\]|\\.)*"|'(?:[^'\\]|\\.)*'|`(?:[^`\\]|\\.)*`)|(\b(?:const|let|var|function|return|if|else|for|while|class|new|import|from|export|async|await|def|public|private|void|true|false|null|this)\b)|(<\/?[a-zA-Z][\w-]*|\/?>)|(--[\w-]+|#[0-9a-fA-F]{3,8}\b|\b\d+(?:\.\d+)?(?:px|rem|em|%|vh|vw|s|ms|fr|deg)?\b)/g;

const TOKEN_CLASS = ["text-text-3 italic", "text-leaf", "font-medium text-lilac-ink", "text-primary", "text-amber"];

function highlight(line: string): ReactNode[] {
  const out: ReactNode[] = [];
  let at = 0;
  for (const m of line.matchAll(TOKEN)) {
    if (m.index > at) out.push(line.slice(at, m.index));
    const kind = m.slice(1).findIndex(Boolean);
    out.push(
      <span key={m.index} className={TOKEN_CLASS[kind]}>
        {m[0]}
      </span>,
    );
    at = m.index + m[0].length;
  }
  if (at < line.length) out.push(line.slice(at));
  return out;
}

export function CodeBlock({ code, file, start = 1, diff, className }: { code: string; file?: string; start?: number; diff?: boolean; className?: string }) {
  const lines = code.replace(/\n+$/, "").split("\n");
  const width = String(start + lines.length - 1).length;
  return (
    <figure className={cn("overflow-hidden rounded-lg border border-line bg-sunken", className)}>
      {file ? (
        <figcaption className="flex items-center gap-1.5 border-b border-line px-3 py-1.5 font-mono text-[12px] text-text-2">
          <FileCode2 className="size-3.5 shrink-0 text-text-3" aria-hidden="true" />
          <span className="min-w-0 truncate">{file}</span>
        </figcaption>
      ) : null}
      <pre className="py-2 font-mono text-[13px] leading-[1.65] sm:text-[13.5px]">
        <code className="block">
          {lines.map((line, i) => {
            const removed = diff && line.startsWith("-");
            const added = diff && line.startsWith("+");
            return (
              <span key={i} className={cn("flex", removed && "bg-rose-soft", added && "bg-leaf-soft")}>
                {diff ? (
                  <span className={cn("shrink-0 select-none px-3 font-semibold", removed ? "text-rose" : "text-leaf")} aria-hidden="true">
                    {removed ? "−" : "+"}
                  </span>
                ) : (
                  <span className="shrink-0 pr-3 pl-3 text-right text-text-3 select-none tabular" style={{ minWidth: `${width + 2.5}ch` }} aria-hidden="true">
                    {start + i}
                  </span>
                )}
                <span className="min-w-0 flex-1 pr-3 break-words whitespace-pre-wrap">{diff ? <span className={removed ? "text-rose" : "text-leaf"}>{line.replace(/^[-+] ?/, "")}</span> : highlight(line)}</span>
              </span>
            );
          })}
        </code>
      </pre>
    </figure>
  );
}
