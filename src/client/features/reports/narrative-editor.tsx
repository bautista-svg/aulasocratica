import { Sparkles, X } from "lucide-react";
import { Button } from "@client/components/ui/button";
import { Field, Textarea } from "@client/components/ui/field";
import { NARRATIVE_MAX, type ReportSection } from "@shared/domain/reports";
import { SourceTag } from "./report-data-view";

/**
 * The teacher's text, one textarea per section. AI suggestions are shown next to each
 * section, clearly marked, and only enter the text when the teacher taps "Insertar".
 */
export function NarrativeEditor({
  sections,
  text,
  onChange,
  errors,
  suggestion,
  onInsert,
  onDiscard,
  disabled,
}: {
  sections: ReportSection[];
  text: Record<string, string>;
  onChange: (key: string, value: string) => void;
  errors: Record<string, string>;
  suggestion: Record<string, string> | null;
  onInsert: (key: string) => void;
  onDiscard: (key: string) => void;
  disabled?: boolean;
}) {
  return (
    <div className="grid gap-6">
      {sections.map((s) => {
        const value = text[s.key] ?? "";
        const proposal = suggestion?.[s.key]?.trim();
        return (
          <div key={s.key} className="grid gap-3">
            <Field label={s.label} hint={s.hint} error={errors[s.key]} counter={{ value: value.length, max: NARRATIVE_MAX }}>
              {(p) => (
                <Textarea
                  id={p.id}
                  aria-describedby={p.describedBy}
                  invalid={p.invalid}
                  value={value}
                  disabled={disabled}
                  onChange={(e) => onChange(s.key, e.target.value)}
                  maxLength={NARRATIVE_MAX}
                  minRows={3}
                  maxRows={16}
                />
              )}
            </Field>
            {proposal ? (
              <div className="rounded-md border border-lilac/50 bg-lilac-soft/50 p-4">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <span className="inline-flex items-center gap-2">
                    <Sparkles className="size-4 text-lilac-ink" aria-hidden="true" />
                    <SourceTag source="ai" />
                  </span>
                  <span className="text-xs text-text-3">Escrita a partir de los datos observados. Revisala antes de usarla.</span>
                </div>
                <p className="mt-2 text-[15px] leading-6 whitespace-pre-line text-text">{proposal}</p>
                <div className="mt-3 flex flex-wrap gap-2">
                  <Button size="sm" variant="lilac" onClick={() => onInsert(s.key)}>
                    {value.trim() ? "Agregar a mi texto" : "Insertar"}
                  </Button>
                  <Button size="sm" variant="ghost" icon={<X className="size-4" />} onClick={() => onDiscard(s.key)}>
                    Descartar
                  </Button>
                </div>
              </div>
            ) : null}
          </div>
        );
      })}
    </div>
  );
}
