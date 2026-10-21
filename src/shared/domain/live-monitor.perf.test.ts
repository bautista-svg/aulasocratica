import { describe, expect, it } from "vitest";
import { activityBuckets, currentStage, lastSignalAt, progressSteps, stageDurations, type LiveEvent, type LiveSession } from "./live-monitor";

const T0 = Date.parse("2026-10-01T12:00:00.000Z");
const ev = (eventType: string, min: number): LiveEvent => ({ eventType, createdAt: new Date(T0 + min * 60_000 + 123).toISOString() });
const withAt = (events: LiveEvent[]): LiveEvent[] => events.map((e) => ({ ...e, at: new Date(e.createdAt).getTime() }));

const session: LiveSession = {
  status: "in_progress",
  initialAnswer: "Mi idea",
  startedAt: new Date(T0).toISOString(),
  lastActivityAt: new Date(T0 + 20 * 60_000).toISOString(),
  completedAt: null,
  requireInitialAnswer: true,
};
const events = [
  ev("session_entered", 0),
  ev("initial_answer_saved", 2),
  ev("message_sent", 3),
  ev("hint_requested", 5),
  ev("left_app", 6),
  ev("message_sent", 9),
  ev("closing_started", 12),
  ev("pasted_text", 13),
  ev("example_requested", 11),
];

describe("live-monitor with precomputed event times", () => {
  it("gives the same results with or without `at`", () => {
    const now = T0 + 30 * 60_000;
    const a = withAt(events);
    expect(lastSignalAt(session, a)).toBe(lastSignalAt(session, events));
    expect(currentStage(session, a)).toBe(currentStage(session, events));
    expect(progressSteps(session, a)).toBe(progressSteps(session, events));
    expect(stageDurations(session, a, now)).toEqual(stageDurations(session, events, now));
    expect(activityBuckets(a, T0, now, 15)).toEqual(activityBuckets(events, T0, now, 15));
  });
});
