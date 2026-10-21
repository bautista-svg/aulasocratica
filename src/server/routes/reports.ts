// Informes. The observed-data snapshot is built on the server from the database (the
// original trusted numbers sent by the browser). AI only drafts the narrative, from the
// stored snapshot, and the teacher edits and validates it.
import { Hono } from "hono";
import { and, desc, eq, sql } from "drizzle-orm";
import type { AppEnv } from "../types";
import { db, schema } from "../db/client";
import { HttpError, badRequest, conflict, readJson } from "../lib/errors";
import { requireTeacher, teacherOf } from "../auth/teacher";
import { ownedReport } from "../services/access";
import { audit } from "../services/audit";
import { rateLimit } from "../lib/rate-limit";
import { attachmentHeader } from "../lib/pdf";
import { buildReport, scopeInputOf, type BuiltReport } from "../services/reports/build";
import { draftNarrative } from "../services/reports/narrative";
import { reportPdf } from "../services/reports/pdf";
import { createReportBody, patchReportBody, type ReportDetail, type ReportScope, type ReportSummary } from "@shared/contracts/reports";
import {
  emptyNarrative,
  isReportKind,
  missingSections,
  readNarrative,
  readReportData,
  reportFileName,
  reportToCsv,
  type ReportKind,
  type ReportStatus,
} from "@shared/domain/reports";

const MAX_REPORTS = 500;

type Row = typeof schema.reports.$inferSelect;

function readScope(raw: unknown): ReportScope {
  const r = (raw && typeof raw === "object" ? raw : {}) as Record<string, unknown>;
  const id = (k: string) => (typeof r[k] === "string" ? (r[k] as string) : undefined);
  const out: ReportScope = { label: typeof r.label === "string" ? r.label : "" };
  for (const k of ["studentId", "sessionId", "activityId", "classroomId"] as const) {
    const v = id(k);
    if (v) out[k] = v;
  }
  return out;
}

const kindOf = (row: Pick<Row, "kind">): ReportKind => (isReportKind(row.kind) ? row.kind : "group");

function toSummary(row: Pick<Row, "id" | "kind" | "title" | "status" | "scope" | "createdAt" | "updatedAt" | "validatedAt">): ReportSummary {
  return {
    id: row.id,
    kind: kindOf(row),
    title: row.title,
    status: row.status === "validated" ? "validated" : "draft",
    scopeLabel: readScope(row.scope).label,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
    validatedAt: row.validatedAt?.toISOString() ?? null,
  };
}

function toDetail(row: Row): ReportDetail {
  const kind = kindOf(row);
  return {
    ...toSummary(row),
    scope: readScope(row.scope),
    data: readReportData(row.data),
    narrative: readNarrative(kind, row.narrative),
  };
}

/** Rebuilding needs the scope to still exist; if it was deleted, the saved report stays as it is. */
async function rebuild(teacherId: string, row: Row): Promise<BuiltReport> {
  try {
    return await buildReport(teacherId, scopeInputOf(kindOf(row), readScope(row.scope)));
  } catch (err) {
    if (err instanceof HttpError && err.status === 404) {
      throw conflict(
        "No se pueden actualizar los datos: el aula, la actividad o el alumno de este informe ya no existe. El informe guardado no cambió.",
      );
    }
    throw err;
  }
}

const perTeacher = (c: Parameters<typeof teacherOf>[0]) => teacherOf(c).id;

export const reportRoutes = new Hono<AppEnv>()
  .use("*", requireTeacher)

  .get("/", async (c) => {
    const t = teacherOf(c);
    const rows = await db
      .select({
        id: schema.reports.id,
        kind: schema.reports.kind,
        title: schema.reports.title,
        status: schema.reports.status,
        scope: schema.reports.scope,
        createdAt: schema.reports.createdAt,
        updatedAt: schema.reports.updatedAt,
        validatedAt: schema.reports.validatedAt,
      })
      .from(schema.reports)
      .where(eq(schema.reports.teacherId, t.id))
      .orderBy(desc(schema.reports.updatedAt))
      .limit(MAX_REPORTS);
    return c.json({ reports: rows.map(toSummary) });
  })

  .post("/", rateLimit("report-create", 60, 60 * 60_000, perTeacher), async (c) => {
    const t = teacherOf(c);
    const body = await readJson(c, createReportBody);
    const [count] = await db
      .select({ n: sql<number>`count(*)::int` })
      .from(schema.reports)
      .where(eq(schema.reports.teacherId, t.id));
    if ((count?.n ?? 0) >= MAX_REPORTS) throw badRequest(`Llegaste al máximo de ${MAX_REPORTS} informes. Borrá alguno para crear otro.`);
    // Only the kind and the scope ids are read from the request: the data comes from the database.
    const built = await buildReport(t.id, { kind: body.kind, ...(body.kind === "overview" ? {} : body.scope) } as Parameters<typeof buildReport>[1]);
    const [row] = await db
      .insert(schema.reports)
      .values({
        teacherId: t.id,
        kind: body.kind,
        title: body.title ?? built.title,
        scope: built.scope,
        data: built.data,
        narrative: emptyNarrative(body.kind),
        status: "draft",
      })
      .returning();
    return c.json({ report: toDetail(row!) }, 201);
  })

  .get("/:id", async (c) => {
    const row = await ownedReport(teacherOf(c).id, c.req.param("id"));
    return c.json({ report: toDetail(row) });
  })

  // Editing a validated report returns it to draft: the validation covered the previous text.
  .patch("/:id", async (c) => {
    const t = teacherOf(c);
    const row = await ownedReport(t.id, c.req.param("id"));
    const body = await readJson(c, patchReportBody);
    const kind = kindOf(row);
    const current = readNarrative(kind, row.narrative);
    const narrative = body.narrative ? readNarrative(kind, { ...current, ...body.narrative }) : current;
    const title = body.title ?? row.title;
    const changed = title !== row.title || JSON.stringify(narrative) !== JSON.stringify(current);
    if (!changed) return c.json({ report: toDetail(row) });
    const [updated] = await db
      .update(schema.reports)
      .set({ title, narrative, status: "draft", validatedAt: null })
      .where(and(eq(schema.reports.id, row.id), eq(schema.reports.teacherId, t.id)))
      .returning();
    return c.json({ report: toDetail(updated!) });
  })

  // "Actualizar datos": rebuilds the observed data from the database and keeps the teacher's text.
  .post("/:id/refresh", async (c) => {
    const t = teacherOf(c);
    const row = await ownedReport(t.id, c.req.param("id"));
    const built = await rebuild(t.id, row);
    const [updated] = await db
      .update(schema.reports)
      .set({ data: built.data, scope: built.scope, status: "draft", validatedAt: null })
      .where(and(eq(schema.reports.id, row.id), eq(schema.reports.teacherId, t.id)))
      .returning();
    return c.json({ report: toDetail(updated!) });
  })

  // AI suggestion for the narrative, from the stored snapshot only. Not saved.
  .post("/:id/ai", rateLimit("report-ai", 30, 60 * 60_000, perTeacher), async (c) => {
    const t = teacherOf(c);
    const row = await ownedReport(t.id, c.req.param("id"));
    const draft = await draftNarrative({ teacherId: t.id, kind: kindOf(row), title: row.title, data: readReportData(row.data) });
    return c.json({ draft });
  })

  .post("/:id/validate", async (c) => {
    const t = teacherOf(c);
    const row = await ownedReport(t.id, c.req.param("id"));
    const kind = kindOf(row);
    const missing = missingSections(kind, readNarrative(kind, row.narrative));
    if (missing.length > 0) {
      throw badRequest(
        missing.length === 1
          ? `Completá «${missing[0]!.label}» antes de validar.`
          : "Completá todas las secciones de la valoración antes de validar.",
        Object.fromEntries(missing.map((s) => [s.key, "Completá esta sección antes de validar."])),
      );
    }
    const [updated] = await db
      .update(schema.reports)
      .set({ status: "validated", validatedAt: new Date() })
      .where(and(eq(schema.reports.id, row.id), eq(schema.reports.teacherId, t.id)))
      .returning();
    await audit(c, t.id, "report_validated", "report", row.id);
    return c.json({ report: toDetail(updated!) });
  })

  .delete("/:id", async (c) => {
    const t = teacherOf(c);
    const row = await ownedReport(t.id, c.req.param("id"));
    await db.delete(schema.reports).where(and(eq(schema.reports.id, row.id), eq(schema.reports.teacherId, t.id)));
    await audit(c, t.id, "report_deleted", "report", row.id);
    return c.json({ ok: true });
  })

  .get("/:id/export.csv", async (c) => {
    const row = await ownedReport(teacherOf(c).id, c.req.param("id"));
    const r = toDetail(row);
    const csv = reportToCsv({ title: r.title, kind: r.kind, status: r.status as ReportStatus, validatedAt: r.validatedAt }, r.data, r.narrative);
    return c.body(csv, 200, {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": attachmentHeader(reportFileName(r.title, "csv")),
    });
  })

  .get("/:id/export.pdf", async (c) => {
    const row = await ownedReport(teacherOf(c).id, c.req.param("id"));
    const r = toDetail(row);
    const pdf = await reportPdf({
      title: r.title,
      kind: r.kind,
      status: r.status,
      validatedAt: row.validatedAt,
      scopeLabel: r.scopeLabel,
      data: r.data,
      narrative: r.narrative,
    });
    return c.body(new Uint8Array(pdf), 200, {
      "Content-Type": "application/pdf",
      "Content-Disposition": attachmentHeader(reportFileName(r.title, "pdf")),
    });
  });
