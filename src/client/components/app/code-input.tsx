// Picks code for «Defensa de código»: files read here in the browser, or pasted text. Used by the
// student and by the teacher, each with their own words.
import { useRef, useState, type ReactNode } from "react";
import { FileCode2, Upload, X } from "lucide-react";
import { buttonClass } from "@client/components/ui/button";
import { Textarea } from "@client/components/ui/field";
import { CODE_ACCEPT, lineCount, type CodeFile } from "@shared/domain/code-defense";

const guessName = (text: string) => {
  const t = text.trimStart();
  if (t.startsWith("<")) return "codigo.html";
  if (/^[^{}]*\{[^{}]*:[^{}]*;/s.test(t) && !/\b(function|const|let|var)\b/.test(t)) return "codigo.css";
  return /\b(function|const|let|var|document\.)\b/.test(t) ? "codigo.js" : "codigo.txt";
};

export function codeFilesToSend(files: CodeFile[], pasted: string): CodeFile[] {
  return [...files, ...(pasted.trim() ? [{ name: guessName(pasted), text: pasted }] : [])];
}

export function CodeInput({
  files,
  onFiles,
  pasted,
  onPasted,
  labels,
}: {
  files: CodeFile[];
  onFiles: (files: CodeFile[]) => void;
  pasted: string;
  onPasted: (text: string) => void;
  labels: { files: ReactNode; lines: (n: number) => string; paste: string; placeholder: string; remove: (name: string) => string };
}) {
  const input = useRef<HTMLInputElement>(null);
  const [reading, setReading] = useState(false);

  async function pick(list: FileList | null) {
    if (!list?.length) return;
    setReading(true);
    try {
      const added = await Promise.all(Array.from(list).map(async (f) => ({ name: f.webkitRelativePath || f.name, text: await f.text() })));
      const names = new Set(added.map((f) => f.name));
      onFiles([...files.filter((f) => !names.has(f.name)), ...added]);
    } finally {
      setReading(false);
      if (input.current) input.current.value = "";
    }
  }

  return (
    <div className="grid gap-3">
      <div>
        <input ref={input} id="code-files" type="file" multiple accept={CODE_ACCEPT} className="peer sr-only" disabled={reading} onChange={(e) => void pick(e.target.files)} />
        <label htmlFor="code-files" className={buttonClass("secondary", "md", "cursor-pointer peer-focus-visible:ring-2 peer-focus-visible:ring-lilac")}>
          <Upload className="size-4" aria-hidden="true" />
          {labels.files}
        </label>
      </div>
      {files.length ? (
        <ul className="divide-y divide-line rounded-lg border border-line bg-surface">
          {files.map((f) => (
            <li key={f.name} className="flex items-center gap-2.5 py-1 pr-1 pl-3">
              <FileCode2 className="size-4 shrink-0 text-lilac-ink" aria-hidden="true" />
              <span className="min-w-0 flex-1 truncate font-mono text-[13px] text-ink">{f.name}</span>
              <span className="shrink-0 text-[12.5px] text-text-3 tabular">{labels.lines(lineCount(f.text))}</span>
              <button
                type="button"
                onClick={() => onFiles(files.filter((x) => x.name !== f.name))}
                aria-label={labels.remove(f.name)}
                className="inline-flex size-9 shrink-0 items-center justify-center rounded-md text-text-3 hover:bg-sunken hover:text-ink"
              >
                <X className="size-4" aria-hidden="true" />
              </button>
            </li>
          ))}
        </ul>
      ) : null}
      <div className="grid gap-1.5">
        <label htmlFor="code-paste" className="text-[13px] font-medium text-text-2">
          {labels.paste}
        </label>
        <Textarea
          id="code-paste"
          data-code-input
          value={pasted}
          onChange={(e) => onPasted(e.target.value)}
          minRows={5}
          maxRows={14}
          spellCheck={false}
          autoCapitalize="off"
          autoCorrect="off"
          placeholder={labels.placeholder}
          className="font-mono text-[13px] leading-6"
        />
      </div>
    </div>
  );
}
