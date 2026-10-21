import { z } from "zod";
import type { RubricCriterion, ReflectionQuestion } from "../domain/activity-design";
import type { VoiceLanguage } from "../domain/voice";

export type ActivityStatus = "draft" | "published" | "archived";
export type HelpLevel = "autonomous" | "moderate" | "intensive";

/** One activity in a classroom list. Participants are counted per activity (never per classroom). */
export interface ActivitySummary {
  id: string;
  classroomId: string;
  title: string;
  subject: string;
  status: ActivityStatus;
  linkActive: boolean;
  startsAt: string | null;
  expiresAt: string | null;
  publishedAt: string | null;
  createdAt: string;
  updatedAt: string;
  participants: number;
  completed: number;
  activeNow: number;
  openAlerts: number;
}

export const createActivityBody = z.object({
  classroomId: z.string().uuid(),
  title: z.string().trim().min(1, "Poné un título.").max(160, "Usá hasta 160 caracteres."),
  /** Optional saved tutor to start from. */
  tutorId: z.string().uuid().nullable().optional(),
});

export interface ActivityDetail {
  id: string;
  classroomId: string;
  classroomName: string;
  title: string;
  subject: string;
  objectives: string;
  instructions: string;
  material: string;
  tutorType: string;
  helpLevel: HelpLevel;
  tutorRules: string;
  tutorId: string | null;
  tutorName: string | null;
  requireInitialAnswer: boolean;
  voiceLanguage: VoiceLanguage;
  rubric: RubricCriterion[];
  reflectionQuestions: ReflectionQuestion[];
  status: ActivityStatus;
  publishedAt: string | null;
  linkToken: string;
  linkActive: boolean;
  startsAt: string | null;
  expiresAt: string | null;
  createdAt: string;
  updatedAt: string;
}
