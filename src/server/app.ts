import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { Hono } from "hono";
import { bodyLimit } from "hono/body-limit";
import { compress } from "hono/compress";
import { serveStatic } from "@hono/node-server/serve-static";
import { randomUUID } from "node:crypto";
import type { AppEnv } from "./types";
import { onError, HttpError } from "./lib/errors";
import { securityHeaders, sameOriginMutations } from "./lib/security";
import { loadTeacher } from "./auth/teacher";
import { log } from "./lib/logger";
import { healthRoutes } from "./routes/health";
import { authRoutes } from "./routes/auth";
import { classroomRoutes } from "./routes/classrooms";
import { activityRoutes } from "./routes/activities";
import { sessionRoutes } from "./routes/sessions";
import { liveRoutes } from "./routes/live";
import { studentRoutes } from "./routes/students";
import { tutorRoutes } from "./routes/tutors";
import { materialRoutes } from "./routes/materials";
import { planningRoutes } from "./routes/planning";
import { reportRoutes } from "./routes/reports";
import { dashboardRoutes } from "./routes/dashboard";
import { publicStudentRoutes } from "./routes/public-student";
import { adminRoutes } from "./routes/admin";

export const MAX_UPLOAD_BYTES = 60 * 1024 * 1024;

export function createApp(opts: { staticDir?: string | null } = {}) {
  const app = new Hono<AppEnv>();

  app.use("*", async (c, next) => {
    c.set("requestId", randomUUID());
    const started = performance.now();
    await next();
    const ms = Math.round(performance.now() - started);
    if (c.req.path.startsWith("/api/") && !c.req.path.startsWith("/api/health")) {
      log.info("request", { method: c.req.method, path: c.req.routePath ?? c.req.path, status: c.res.status, ms });
    }
    c.header("Server-Timing", `app;dur=${ms}`);
  });
  app.use("*", securityHeaders);
  // gzip for JSON/HTML (SSE is excluded by Hono's filter; static assets are precompressed).
  app.use("*", compress());
  app.onError(onError);

  const api = new Hono<AppEnv>();
  api.use("*", sameOriginMutations);
  // Uploads get a larger limit; everything else is small JSON.
  api.use("*", async (c, next) => {
    const isUpload = c.req.method === "POST" && /\/(files|upload|import)(\/|$)/.test(c.req.path);
    return bodyLimit({
      maxSize: isUpload ? MAX_UPLOAD_BYTES : 1024 * 1024,
      onError: () => {
        throw new HttpError(
          413,
          isUpload ? "El archivo supera el máximo de 60 MB." : "Los datos enviados son demasiado grandes.",
          "too_large",
        );
      },
    })(c, next);
  });
  api.use("*", async (c, next) => {
    await next();
    if (!c.res.headers.has("Cache-Control")) c.header("Cache-Control", "no-store");
  });
  api.use("*", loadTeacher);

  api.route("/health", healthRoutes);
  api.route("/auth", authRoutes);
  api.route("/dashboard", dashboardRoutes);
  api.route("/classrooms", classroomRoutes);
  api.route("/activities", activityRoutes);
  api.route("/sessions", sessionRoutes);
  api.route("/live", liveRoutes);
  api.route("/students", studentRoutes);
  api.route("/tutors", tutorRoutes);
  api.route("/materials", materialRoutes);
  api.route("/planning", planningRoutes);
  api.route("/reports", reportRoutes);
  api.route("/s", publicStudentRoutes);
  api.route("/admin", adminRoutes);
  api.all("*", (c) => c.json({ error: { code: "not_found", message: "Ruta inexistente." } }, 404));

  app.route("/api", api);

  const staticDir = opts.staticDir;
  if (staticDir && fs.existsSync(staticDir)) {
    const indexHtml = fs.readFileSync(path.join(staticDir, "index.html"), "utf8");
    const landingPath = path.join(staticDir, "landing.html");
    const landingHtml = fs.existsSync(landingPath) ? fs.readFileSync(landingPath, "utf8") : indexHtml;
    // The public landing is prerendered at build time (fast first paint without JS).
    app.get("/", (c) => {
      c.header("Cache-Control", "no-cache");
      return c.html(landingHtml);
    });
    app.use(
      "/assets/*",
      serveStatic({
        root: path.relative(process.cwd(), staticDir),
        precompressed: true,
        onFound: (_p, c) => {
          c.header("Cache-Control", "public, max-age=31536000, immutable");
        },
      }),
    );
    app.use(
      "*",
      serveStatic({
        root: path.relative(process.cwd(), staticDir),
        precompressed: true,
        onFound: (p, c) => {
          if (!p.endsWith(".html")) c.header("Cache-Control", "public, max-age=3600");
        },
      }),
    );
    // SPA fallback: client-side routes get the app shell.
    app.get("*", (c) => {
      c.header("Cache-Control", "no-cache");
      return c.html(indexHtml);
    });
  }
  return app;
}

export function defaultStaticDir(): string {
  const here = path.dirname(fileURLToPath(import.meta.url));
  return path.resolve(here, "../client");
}
