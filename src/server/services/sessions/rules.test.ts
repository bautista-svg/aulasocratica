import { describe, expect, it } from "vitest";
import type { XrayItem } from "@shared/domain/thinking-xray";
import { buildTranscript, ownWords, quoteInTexts, studentTexts } from "./corpus";
import { mergeXray, readXrayItems } from "./xray-store";
import { MAX_COUNTED_GAP_MS, progressFor, stepsFor, workTime } from "./live-rules";

const item = (o: Partial<XrayItem>): XrayItem => ({
  id: Math.random().toString(36).slice(2, 8),
  moment: "during",
  category: "reformulation",
  interpretation: "Algo.",
  evidence: "una cita del alumno",
  status: "suggested",
  edited: false,
  ...o,
});

describe("student corpus", () => {
  it("removes the help-button texts from what counts as the student's words", () => {
    expect(ownWords({ role: "user", content: "Necesito una pista.", intent: "hint" })).toBe("");
    expect(ownWords({ role: "user", content: "Tengo otra idea: la luz es energía", intent: "other_idea" })).toBe("la luz es energía");
    expect(ownWords({ role: "user", content: "no entendí", intent: null })).toBe("");
    const texts = studentTexts({
      initialAnswer: "Mi primera idea sobre la luz",
      finalAnswer: null,
      reflection: [],
      messages: [
        { role: "user", content: "Necesito una pista.", intent: "hint" },
        { role: "assistant", content: "¿Qué pensás de la clorofila?", intent: null },
        { role: "user", content: "Que es verde y atrapa la luz", intent: null },
      ],
    });
    expect(texts).toEqual(["Mi primera idea sobre la luz", "Que es verde y atrapa la luz"]);
    expect(quoteInTexts("Necesito una pista", texts)).toBe(false);
    expect(quoteInTexts("qué pensás de la clorofila", texts)).toBe(false);
    expect(quoteInTexts("es verde y atrapa la luz", texts)).toBe(true);
    // A quote must live inside one text, not glue two of them.
    expect(quoteInTexts("sobre la luz Que es verde", texts)).toBe(false);
  });

  it("keeps the whole conversation and only shortens it when it is huge", () => {
    const msgs = Array.from({ length: 300 }, (_, i) => ({ role: i % 2 ? "user" : "assistant", content: `Mensaje ${i}. ¿Y entonces qué pasa ${i}?`, intent: null }));
    const full = buildTranscript(msgs);
    expect(full.omitted).toBe(0);
    expect(full.text).toContain("Mensaje 299");
    const small = buildTranscript(msgs, 3000);
    expect(small.shortened).toBe(true);
    expect(small.omitted).toBeGreaterThan(0);
    expect(small.text).toContain("Mensaje 299");
    expect(small.text).toContain("se omitieron");
    expect(small.text.length).toBeLessThanOrEqual(3200);
  });
});

describe("x-ray merge", () => {
  it("keeps validated/edited, remembers discarded and drops repeated suggestions", () => {
    const validated = item({ category: "reformulation", evidence: "primera cita larga", status: "validated" });
    const discarded = item({ category: "argument_added", evidence: "segunda cita larga", status: "discarded" });
    const unreviewed = item({ category: "strategy_change", evidence: "tercera cita larga" });
    const fresh = [
      item({ category: "argument_added", evidence: "Segunda cita larga." }),
      item({ category: "reformulation", evidence: "primera cita larga" }),
      item({ category: "error_revised", evidence: "cuarta cita larga" }),
      item({ category: "error_revised", evidence: "cuarta cita larga" }),
    ];
    const r = mergeXray([validated, discarded, unreviewed], fresh);
    expect(r.added).toBe(1);
    expect(r.duplicates).toBe(3);
    expect(r.items.map((i) => `${i.category}:${i.status}`)).toEqual(["reformulation:validated", "error_revised:suggested", "argument_added:discarded"]);
    // Stored discarded items do not count against the visible cap when read back.
    const many = [...Array.from({ length: 18 }, (_, i) => item({ evidence: `cita visible ${i}` })), ...Array.from({ length: 5 }, (_, i) => item({ evidence: `cita descartada ${i}`, status: "discarded" }))];
    expect(readXrayItems(many)).toHaveLength(23);
  });
});

describe("live rules", () => {
  const session = { status: "in_progress", initialAnswer: null, startedAt: "2026-01-01T10:00:00Z", lastActivityAt: "2026-01-01T10:05:00Z", completedAt: null };
  it("uses 2 steps when the activity has no initial answer", () => {
    expect(stepsFor(false)).toBe(2);
    expect(progressFor(session, [], false)).toBe(0);
    expect(progressFor(session, [{ eventType: "closing_started", createdAt: "2026-01-01T10:04:00Z" }], false)).toBe(1);
    expect(progressFor({ ...session, status: "completed" }, [], false)).toBe(2);
    expect(progressFor(session, [], true)).toBe(0);
    expect(progressFor({ ...session, initialAnswer: "x" }, [], true)).toBe(1);
  });

  it("counts long pauses only up to 5 minutes", () => {
    const t = Date.parse("2026-01-01T10:00:00Z");
    expect(workTime([t, t + 60_000, t + 60 * 60_000])).toBe(60_000 + MAX_COUNTED_GAP_MS);
    expect(workTime([t])).toBe(0);
  });
});
