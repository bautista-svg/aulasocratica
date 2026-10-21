// Resource hints in the HTML of the pages people open directly (the student link, the teacher's
// pages). Without them the page is a chain: HTML → entry JS runs → route JS → the first API call
// → (for teachers) the page's own API calls. The server knows the route from the URL, so it adds
// <link rel="modulepreload"> for that route's JS (dist/route-preloads.json, written by the build)
// and <link rel="preload" as="fetch"> for the API calls the page makes first: everything downloads
// in parallel with the entry chunk and the app finds it ready. URLs must be exactly the ones the
// client fetches; ids and tokens are validated by the patterns, so they are safe in an attribute.
import fs from "node:fs";

interface Page {
  re: RegExp;
  /** Route files (src/client/routes) whose code-split component the page renders. */
  routes: string[];
  /** API calls the page makes on load; teacher data only when the request has a workspace cookie. */
  data?: (m: RegExpExecArray, teacher: boolean) => string[];
}

const ID = "([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})";
const me = "/api/auth/me";

const PAGES: Page[] = [
  { re: /^\/$/, routes: ["index"], data: () => [me] },
  { re: /^\/clase\/([A-Za-z0-9_-]{6,128})\/?$/, routes: ["clase.$token"], data: (m) => [`/api/s/${m[1]}`] },
  { re: /^\/ingresar\/?$/, routes: ["ingresar"], data: () => [me] },
  { re: /^\/app\/?$/, routes: ["app", "app.index"], data: (_m, t) => [me, ...(t ? ["/api/dashboard"] : [])] },
  { re: /^\/app\/aulas\/?$/, routes: ["app", "app.aulas.index"], data: (_m, t) => [me, ...(t ? ["/api/classrooms"] : [])] },
  {
    re: new RegExp(`^/app/aulas/${ID}/?$`),
    routes: ["app", "app.aulas.$classroomId"],
    data: (m, t) => {
      const base = `/api/classrooms/${m[1]}`;
      return [me, ...(t ? [base, `${base}/activities`, `${base}/students`, `${base}/alerts`] : [])];
    },
  },
  {
    re: new RegExp(`^/app/actividades/${ID}/?$`),
    routes: ["app", "app.actividades.$activityId"],
    data: (m, t) => [me, ...(t ? [`/api/activities/${m[1]}`] : [])],
  },
  {
    re: new RegExp(`^/app/sesiones/${ID}/?$`),
    routes: ["app", "app.sesiones.$sessionId"],
    data: (m, t) => [me, ...(t ? [`/api/sessions/${m[1]}`] : [])],
  },
  { re: /^\/app\/radiografia\/?$/, routes: ["app", "app.radiografia"], data: () => [me] },
  { re: /^\/app\/informes\/?$/, routes: ["app", "app.informes.index"], data: () => [me] },
  { re: /^\/app\/materiales\/?$/, routes: ["app", "app.materiales"], data: () => [me] },
  { re: /^\/app\/tutores\/?$/, routes: ["app", "app.tutores"], data: () => [me] },
  { re: /^\/app\/crear\/?$/, routes: ["app", "app.crear"], data: () => [me] },
  { re: /^\/app\/cuenta\/?$/, routes: ["app", "app.cuenta"], data: () => [me] },
];

export function loadRoutePreloads(file: string): Record<string, string[]> {
  try {
    return JSON.parse(fs.readFileSync(file, "utf8")) as Record<string, string[]>;
  } catch {
    return {};
  }
}

/** The <link> tags for one request path ("" when the page has none). */
export function hintsFor(pathname: string, teacher: boolean, routeFiles: Record<string, string[]>): string {
  const page = PAGES.find((p) => p.re.test(pathname));
  if (!page) return "";
  const m = page.re.exec(pathname)!;
  const js = [...new Set(page.routes.flatMap((r) => routeFiles[r] ?? []))];
  const data = page.data?.(m, teacher) ?? [];
  return [
    ...data.map((u) => `<link rel="preload" as="fetch" crossorigin="anonymous" href="${u}">`),
    // Low priority: they must not delay the entry chunk (the first render) on slow connections.
    ...js.map((u) => `<link rel="modulepreload" crossorigin fetchpriority="low" href="${u}">`),
  ].join("");
}

/** Inserts the hints right before </head>. */
export function withHints(html: string, hints: string): string {
  if (!hints) return html;
  const i = html.indexOf("</head>");
  return i < 0 ? html : html.slice(0, i) + hints + html.slice(i);
}
