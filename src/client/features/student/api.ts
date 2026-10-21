// Data access for the student page. The device session lives in an httpOnly cookie; the
// client only ever sends the link token in the URL.
import { useQuery, type QueryClient } from "@tanstack/react-query";
import { api, ApiError } from "@client/lib/api";
import { rememberLink } from "./hooks";
import type {
  ChatInput,
  FinishInput,
  SignalInput,
  StudentLinkInfo,
  StudentMessage,
  StudentWorkspace,
  WorkspaceResponse,
} from "@shared/contracts/student";

export const studentKey = (token: string) => ["student", token] as const;

const base = (token: string) => `/api/s/${encodeURIComponent(token)}`;

export function useStudentLink(token: string) {
  return useQuery({
    queryKey: studentKey(token),
    queryFn: async ({ signal }) => {
      const info = await api.get<StudentLinkInfo>(base(token), signal);
      rememberLink(token);
      return info;
    },
    // While a reply is still being written on the server (e.g. after a reload), check often;
    // otherwise a slow heartbeat notices when the teacher closes the link or ends the session.
    // A link that no longer exists (replaced by a new one) is not asked again.
    refetchInterval: (query) => {
      const err = query.state.error;
      if (query.state.status === "error" && err instanceof ApiError && err.status === 404) return false;
      return query.state.data?.workspace?.replyPending && query.state.status !== "error" ? 2000 : 60_000;
    },
    refetchIntervalInBackground: false,
    staleTime: 10_000,
  });
}

export function setWorkspace(qc: QueryClient, token: string, workspace: StudentWorkspace | null) {
  qc.setQueryData<StudentLinkInfo>(studentKey(token), (old) => (old ? { ...old, workspace } : old));
}

export function updateWorkspace(qc: QueryClient, token: string, fn: (w: StudentWorkspace) => StudentWorkspace) {
  qc.setQueryData<StudentLinkInfo>(studentKey(token), (old) => (old?.workspace ? { ...old, workspace: fn(old.workspace) } : old));
}

export const studentApi = {
  join: (token: string, name: string) => api.post<WorkspaceResponse & { created: boolean }>(`${base(token)}/join`, { name }),
  resume: (token: string, name: string, code: string) => api.post<WorkspaceResponse>(`${base(token)}/resume`, { name, code }),
  leave: (token: string) => api.post<{ ok: true }>(`${base(token)}/leave`),
  initial: (token: string, answer: string) => api.post<WorkspaceResponse>(`${base(token)}/initial`, { answer }),
  closing: (token: string) => api.post<{ ok: true }>(`${base(token)}/closing`),
  finish: (token: string, body: FinishInput) => api.post<WorkspaceResponse>(`${base(token)}/finish`, body as Record<string, unknown>),
};

/** Integrity signals are best-effort: never shown, never retried, survive page hide. */
export function sendSignal(token: string, body: SignalInput) {
  void fetch(`${base(token)}/signal`, {
    method: "POST",
    headers: { "content-type": "application/json", "x-aula-client": "1" },
    body: JSON.stringify(body),
    credentials: "same-origin",
    keepalive: true,
  }).catch(() => undefined);
}

export interface ChatHandlers {
  onStart: (userMessageId: string | null) => void;
  onDelta: (text: string) => void;
  onDone: (data: { messageId: string; text: string }) => void;
  onError: (data: { message: string; code: string }) => void;
}

/**
 * POST /chat and read its Server-Sent Events. Throws ApiError when the server refused the
 * message before storing it (validation, closed link, limits) or the connection dropped.
 */
export async function streamChat(token: string, body: ChatInput, h: ChatHandlers): Promise<void> {
  let res: Response;
  try {
    res = await fetch(`${base(token)}/chat`, {
      method: "POST",
      headers: { "content-type": "application/json", accept: "text/event-stream", "x-aula-client": "1" },
      body: JSON.stringify(body),
      credentials: "same-origin",
    });
  } catch {
    throw new ApiError(0, "No hay conexión con el servidor. Revisá tu internet y probá de nuevo.", "network");
  }
  if (!res.ok || !res.body) {
    let e: { message?: string; code?: string; fields?: Record<string, string> } | undefined;
    try {
      e = ((await res.json()) as { error?: typeof e }).error;
    } catch {
      e = undefined;
    }
    throw new ApiError(res.status, e?.message ?? "No pudimos enviar tu mensaje. Probá de nuevo.", e?.code ?? "error", e?.fields ?? {});
  }

  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  let finished = false;
  const dispatch = (block: string) => {
    let event = "message";
    const data: string[] = [];
    for (const line of block.split("\n")) {
      if (line.startsWith("event:")) event = line.slice(6).trim();
      else if (line.startsWith("data:")) data.push(line.slice(5).replace(/^ /, ""));
    }
    if (!data.length) return;
    let payload: unknown;
    try {
      payload = JSON.parse(data.join("\n"));
    } catch {
      return;
    }
    const p = payload as Record<string, unknown>;
    if (event === "start") h.onStart((p.userMessageId as string | null) ?? null);
    else if (event === "delta") h.onDelta(String(p.text ?? ""));
    else if (event === "done") {
      finished = true;
      h.onDone({ messageId: String(p.messageId), text: String(p.text ?? "") });
    } else if (event === "error") {
      finished = true;
      h.onError({ message: String(p.message ?? "El tutor no pudo responder."), code: String(p.code ?? "error") });
    }
  };
  try {
    for (;;) {
      const { value, done } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true }).replace(/\r\n/g, "\n");
      let idx: number;
      while ((idx = buffer.indexOf("\n\n")) >= 0) {
        dispatch(buffer.slice(0, idx));
        buffer = buffer.slice(idx + 2);
      }
    }
    if (buffer.trim()) dispatch(buffer);
  } catch {
    if (!finished) throw new ApiError(0, "Se cortó la conexión mientras el tutor respondía.", "network");
  }
  if (!finished) throw new ApiError(0, "Se cortó la conexión mientras el tutor respondía.", "network");
}

/** Appends messages to the cached workspace (after a reply, before the background refetch). */
export function appendMessages(qc: QueryClient, token: string, add: StudentMessage[]) {
  updateWorkspace(qc, token, (w) => {
    const ids = new Set(w.messages.map((m) => m.id));
    return { ...w, messages: [...w.messages, ...add.filter((m) => !ids.has(m.id))], replyPending: false };
  });
}
