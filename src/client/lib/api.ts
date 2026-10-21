// Typed fetch wrapper for the JSON API. Errors carry the server's Spanish, user-facing
// message plus per-field messages for forms.

export class ApiError extends Error {
  constructor(
    public status: number,
    message: string,
    public code: string,
    public fields: Record<string, string> = {},
  ) {
    super(message);
  }
  get isNetwork() {
    return this.status === 0;
  }
}

type Json = Record<string, unknown> | unknown[];

async function request<T>(method: string, url: string, body?: Json | FormData, signal?: AbortSignal): Promise<T> {
  const headers: Record<string, string> = { "x-aula-client": "1", accept: "application/json" };
  let payload: BodyInit | undefined;
  if (body instanceof FormData) payload = body;
  else if (body !== undefined) {
    headers["content-type"] = "application/json";
    payload = JSON.stringify(body);
  }
  let res: Response;
  try {
    res = await fetch(url, { method, headers, body: payload, credentials: "same-origin", signal });
  } catch (err) {
    if ((err as Error).name === "AbortError") throw err;
    throw new ApiError(0, "No hay conexión con el servidor. Revisá tu internet y probá de nuevo.", "network");
  }
  if (res.status === 204) return undefined as T;
  const text = await res.text();
  let data: unknown = null;
  try {
    data = text ? JSON.parse(text) : null;
  } catch {
    data = null;
  }
  if (!res.ok) {
    const e = (data as { error?: { message?: string; code?: string; fields?: Record<string, string> } } | null)?.error;
    throw new ApiError(
      res.status,
      e?.message ?? (res.status >= 500 ? "El servidor tuvo un problema. Probá de nuevo en unos segundos." : "No se pudo completar la acción."),
      e?.code ?? "error",
      e?.fields ?? {},
    );
  }
  return data as T;
}

export const api = {
  get: <T>(url: string, signal?: AbortSignal) => request<T>("GET", url, undefined, signal),
  post: <T>(url: string, body?: Json | FormData) => request<T>("POST", url, body ?? {}),
  patch: <T>(url: string, body: Json) => request<T>("PATCH", url, body),
  put: <T>(url: string, body: Json) => request<T>("PUT", url, body),
  del: <T>(url: string, body?: Json) => request<T>("DELETE", url, body),
};

/** Upload with progress (fetch has no upload progress). */
export function uploadWithProgress<T>(url: string, form: FormData, onProgress: (fraction: number) => void): Promise<T> {
  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    xhr.open("POST", url);
    xhr.setRequestHeader("x-aula-client", "1");
    xhr.responseType = "text";
    xhr.upload.onprogress = (e) => {
      if (e.lengthComputable) onProgress(e.loaded / e.total);
    };
    xhr.onerror = () => reject(new ApiError(0, "Se cortó la conexión mientras se subía el archivo.", "network"));
    xhr.onload = () => {
      let data: unknown = null;
      try {
        data = xhr.responseText ? JSON.parse(xhr.responseText) : null;
      } catch {
        data = null;
      }
      if (xhr.status >= 200 && xhr.status < 300) resolve(data as T);
      else {
        const e = (data as { error?: { message?: string; code?: string; fields?: Record<string, string> } } | null)?.error;
        reject(new ApiError(xhr.status, e?.message ?? "No se pudo subir el archivo.", e?.code ?? "error", e?.fields ?? {}));
      }
    };
    xhr.send(form);
  });
}

export function errorMessage(err: unknown): string {
  if (err instanceof ApiError) return err.message;
  if (err instanceof Error && err.name === "AbortError") return "";
  return "Ocurrió un error inesperado.";
}
