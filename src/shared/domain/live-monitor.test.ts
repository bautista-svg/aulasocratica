import { describe, expect, it } from "vitest";
import { LIVE_STATUS_LABELS, stageNumber, stageReached, stagesOf, studentMessageCounts } from "./live-monitor";
import { activityState } from "./activity-state";

const session = (over: Record<string, unknown> = {}) => ({
  status: "in_progress",
  initialAnswer: "Mi idea",
  startedAt: "2026-10-21T10:00:00.000Z",
  lastActivityAt: "2026-10-21T10:05:00.000Z",
  completedAt: null,
  requireInitialAnswer: true,
  ...over,
});

describe("one vocabulary for works (D19)", () => {
  it("uses Activo / Sin actividad / Abandonada / Terminó", () => {
    expect(Object.values(LIVE_STATUS_LABELS)).toEqual(["Activo", "Sin actividad", "Abandonada", "Terminó"]);
  });

  it("numbers the stage like the student sees it, and keeps where a work was ended", () => {
    const events = [{ eventType: "message_sent", createdAt: "2026-10-21T10:02:00.000Z" }];
    expect(stageReached(session(), events)).toBe("tutor");
    expect(stageNumber("tutor", true)).toBe(2);
    expect(stageNumber("tutor", false)).toBe(1);
    expect(stagesOf(false)).toEqual(["tutor", "closing"]);
    const ended = session({ status: "completed", completedAt: "2026-10-21T10:06:00.000Z" });
    expect(stageReached(ended, events, true)).toBe("tutor");
    expect(stageReached(ended, events, false)).toBe("closing");
  });
});

describe("message counts (D20)", () => {
  it("separates written messages, help buttons and reformulations, ignoring the tutor and partial turns", () => {
    const c = studentMessageCounts([
      { role: "assistant", intent: null },
      { role: "user", intent: null },
      { role: "user", intent: null, isPartial: true },
      { role: "user", intent: "hint" },
      { role: "user", intent: "not_understood" },
      { role: "user", intent: "other_idea" },
    ]);
    expect(c).toEqual({ written: 1, help: 2, reformulations: 1 });
  });
});

describe("activity state (D11)", () => {
  it("never says Abierta for an activity of an archived classroom", () => {
    const a = { status: "published", linkActive: true, startsAt: null, expiresAt: null };
    expect(activityState(a).label).toBe("Abierta");
    expect(activityState({ ...a, classroomArchived: true })).toMatchObject({ label: "Cerrada (aula archivada)", open: false });
  });
});
