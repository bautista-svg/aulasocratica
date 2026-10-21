// A student's page: their works (learning sessions) across the activities of their classroom.

export interface StudentWork {
  sessionId: string;
  activityId: string;
  activityTitle: string;
  activityStatus: string;
  requireInitialAnswer: boolean;
  status: "in_progress" | "completed";
  endedByTeacher: boolean;
  startedAt: string;
  lastActivityAt: string;
  completedAt: string | null;
  initialAnswerPreview: string | null;
  finalAnswerPreview: string | null;
  openAlerts: number;
  immediateAlerts: number;
  totalAlerts: number;
}

export interface StudentDetail {
  student: { id: string; fullName: string; selfRegistered: boolean; createdAt: string };
  classroom: { id: string; name: string; label: string; isArchived: boolean };
  works: StudentWork[];
  /** Published activities of the classroom this student has not joined. */
  notJoined: { activityId: string; title: string }[];
}
