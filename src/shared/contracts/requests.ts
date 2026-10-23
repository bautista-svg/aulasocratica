// "Pedidos de cambios": teachers given access (teachers.can_request_changes) describe a change to
// an AI that asks until it understands, then send a clear request that the developer reads
// through the admin API.
import { z } from "zod";

export const REQUEST_STATUSES = ["draft", "pending", "in_progress", "done", "discarded"] as const;
export type RequestStatus = (typeof REQUEST_STATUSES)[number];

export const REQUEST_STATUS_LABELS: Record<RequestStatus, string> = {
  draft: "Borrador",
  pending: "Enviado",
  in_progress: "En curso",
  done: "Hecho",
  discarded: "Descartado",
};

export const REQUEST_TEXT_MAX = 4000;
export const REQUEST_IMAGES_MAX = 6;

export interface RequestImage {
  id: string;
  name: string;
  /** Same-origin URL (teacher or admin session). */
  url: string;
}

export interface RequestMessage {
  role: "teacher" | "assistant";
  text: string;
  imageIds: string[];
  at: string;
}

export const REQUEST_KINDS = ["fix", "change", "new"] as const;
export type RequestKind = (typeof REQUEST_KINDS)[number];

export const REQUEST_KIND_LABELS: Record<RequestKind, string> = {
  fix: "Algo no funciona",
  change: "Cambiar algo que ya existe",
  new: "Algo nuevo",
};

/** What the AI understood, for the teacher to confirm and the developer to build. */
export interface RequestSummary {
  kind: RequestKind;
  title: string;
  /** Where in the app ("Actividad → Configuración → Reflexión final"). */
  screen: string;
  /** How it works today, as the teacher sees it. */
  today: string;
  /** What she wants instead. */
  desired: string;
  /** Concrete details and how to know it is done. */
  details: string[];
}

export interface ChangeRequestView {
  id: string;
  status: RequestStatus;
  title: string;
  summary: RequestSummary | null;
  /** The AI understood enough to send it. */
  ready: boolean;
  /** The last message is the teacher's and the AI has not answered it (its call failed): retry. */
  awaitingReply: boolean;
  messages: RequestMessage[];
  images: RequestImage[];
  /** Note from the developer (what was done, or why not). */
  note: string;
  createdAt: string;
  submittedAt: string | null;
  resolvedAt: string | null;
}

/** Admin listing: the request plus who sent it. */
export interface AdminChangeRequest extends ChangeRequestView {
  teacher: { id: string; name: string; email: string | null };
}

export const requestMessageBody = z.object({
  text: z.string().trim().max(REQUEST_TEXT_MAX, `Usá hasta ${REQUEST_TEXT_MAX} caracteres.`).default(""),
  imageIds: z.array(z.string().max(40)).max(REQUEST_IMAGES_MAX).default([]),
});
export type RequestMessageInput = z.input<typeof requestMessageBody>;

export const adminRequestPatch = z.object({
  status: z.enum(["pending", "in_progress", "done", "discarded"]).optional(),
  note: z.string().trim().max(4000).optional(),
});

export const requestAccessBody = z.object({
  email: z.string().trim().toLowerCase().email("Correo inválido."),
  enabled: z.boolean().default(true),
});
