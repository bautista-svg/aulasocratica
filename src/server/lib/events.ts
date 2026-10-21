// In-process pub/sub that powers the teacher's live view (Server-Sent Events). The app runs
// as a single instance; the live view also re-fetches periodically, so a missed event only
// delays an update, it never loses data.
import { EventEmitter } from "node:events";

export type LiveEventType = "session" | "message" | "alert" | "activity";

export interface LiveEvent {
  type: LiveEventType;
  activityId: string;
  sessionId?: string;
  at: number;
}

const bus = new EventEmitter();
bus.setMaxListeners(0);

export function publish(activityId: string, type: LiveEventType, sessionId?: string) {
  bus.emit(`activity:${activityId}`, { type, activityId, sessionId, at: Date.now() } satisfies LiveEvent);
}

export function subscribe(activityId: string, fn: (e: LiveEvent) => void): () => void {
  const name = `activity:${activityId}`;
  bus.on(name, fn);
  return () => bus.off(name, fn);
}
