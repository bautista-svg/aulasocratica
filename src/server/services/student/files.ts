// Serves an activity's files to its students. Only ready files of the activity the device
// session belongs to; supports Range requests (iOS Safari needs them to play audio).
import { Readable } from "node:stream";
import type { Context } from "hono";
import { and, eq } from "drizzle-orm";
import { db, schema } from "../../db/client";
import { fileSize, fileStream } from "../../lib/storage";
import { HttpError } from "../../lib/errors";
import { isUuid } from "../access";

const INLINE_TYPES = /^(application\/pdf|image\/(jpeg|png|webp|gif)|audio\/[a-z0-9.+-]+|text\/(plain|markdown|csv))$/;

/** inline/attachment header with an ASCII fallback name and the UTF-8 original. */
export function contentDisposition(filename: string, inline: boolean): string {
  const ascii =
    filename
      .normalize("NFD")
      .replace(/[̀-ͯ]/g, "")
      .replace(/[^\w.\- ]/g, "")
      .trim() || "archivo";
  return `${inline ? "inline" : "attachment"}; filename="${ascii}"; filename*=UTF-8''${encodeURIComponent(filename)}`;
}

const fileGone = () => new HttpError(404, "Este archivo ya no está disponible. Avisale a tu docente.", "not_found");

export async function serveActivityFile(c: Context, activityId: string, fileId: string, download: boolean): Promise<Response> {
  if (!isUuid(fileId)) throw fileGone();
  const [file] = await db
    .select()
    .from(schema.activityFiles)
    .where(
      and(
        eq(schema.activityFiles.id, fileId),
        eq(schema.activityFiles.activityId, activityId),
        eq(schema.activityFiles.processingStatus, "ready"),
      ),
    )
    .limit(1);
  if (!file) throw fileGone();

  const size = await fileSize(file.storageKey).catch(() => null);
  if (size === null) throw fileGone();

  const mime = file.mimeType.toLowerCase();
  const inlineOk = INLINE_TYPES.test(mime);
  const headers: Record<string, string> = {
    "Content-Type": inlineOk ? (mime.startsWith("text/") ? `${mime}; charset=utf-8` : mime) : "application/octet-stream",
    "Content-Disposition": contentDisposition(file.fileName, inlineOk && !download),
    "X-Content-Type-Options": "nosniff",
    "Cache-Control": "private, max-age=300, no-transform",
    "Accept-Ranges": "bytes",
  };

  let start = 0;
  let end = size - 1;
  let status: 200 | 206 = 200;
  const range = c.req.header("range");
  if (range && size > 0) {
    const m = /^bytes=(\d*)-(\d*)$/.exec(range.trim());
    if (m && (m[1] || m[2])) {
      if (m[1]) {
        start = Number(m[1]);
        end = m[2] ? Math.min(Number(m[2]), size - 1) : size - 1;
      } else {
        start = Math.max(0, size - Number(m[2]));
      }
      if (start > end || start >= size) {
        return new Response(null, { status: 416, headers: { "Content-Range": `bytes */${size}` } });
      }
      status = 206;
      headers["Content-Range"] = `bytes ${start}-${end}/${size}`;
    }
  }
  headers["Content-Length"] = String(size === 0 ? 0 : end - start + 1);
  if (size === 0) return new Response(null, { status: 200, headers });
  const body = Readable.toWeb(fileStream(file.storageKey, { start, end })) as unknown as ReadableStream<Uint8Array>;
  return new Response(body, { status, headers });
}
