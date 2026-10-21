import type { ActivitySummary } from "./activities";
import type { AlertSeverity } from "../domain/alerts";

export interface DashboardLiveActivity {
  id: string;
  title: string;
  classroomId: string;
  classroomName: string;
  /** Students with a signal in the last 2 minutes. */
  activeNow: number;
  participants: number;
  completed: number;
  openAlerts: number;
}

export interface DashboardAlert {
  id: string;
  sessionId: string;
  activityId: string;
  activityTitle: string;
  studentName: string;
  name: string;
  category: string;
  severity: AlertSeverity;
  createdAt: string;
}

export interface DashboardOnboarding {
  hasClassroom: boolean;
  hasActivity: boolean;
  hasPublished: boolean;
  hasStudentSession: boolean;
  /** Targets for the checklist's direct actions. */
  classroomId: string | null;
  draftActivityId: string | null;
  publishedActivityId: string | null;
  done: boolean;
}

export interface DashboardResponse {
  workspace: { displayName: string; hasAccount: boolean };
  counts: { classrooms: number; activities: number; published: number; students: number; openAlerts: number };
  live: DashboardLiveActivity[];
  recent: (ActivitySummary & { classroomName: string })[];
  alerts: DashboardAlert[];
  onboarding: DashboardOnboarding;
}
