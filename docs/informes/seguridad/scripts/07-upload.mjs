// Upload safety: type allowlist, content-type of served files, file names in headers,
// files whose bytes do not match the extension.
import { Actor, BASE, setupTeacher, upload, check, done, sleep } from "./lib.mjs";

const A = await setupTeacher("Docente Archivos");
const url = `/api/activities/${A.activityId}/files`;
const html = "<!doctype html><script>alert(document.domain)</script>";

const cases = [
  { name: "dibujo.svg", data: `<svg xmlns="http://www.w3.org/2000/svg" onload="alert(1)"/>`, type: "image/svg+xml", expect: "rechazado" },
  { name: "pagina.html", data: html, type: "text/html", expect: "rechazado" },
  { name: "sin-extension", data: html, type: "text/html", expect: "rechazado" },
  { name: "x.exe", data: "MZ", type: "application/octet-stream", expect: "rechazado" },
  { name: "foto.png", data: html, type: "image/png", expect: "aceptado (sin verificar bytes)" },
  { name: "doc.pdf", data: html, type: "application/pdf", expect: "aceptado (sin verificar bytes)" },
  { name: "notas.txt", data: html, type: "text/html", expect: "aceptado como text/plain" },
  { name: 'evil"; filename=hack.exe\r\nX-Injected: 1.txt', data: "hola", type: "text/plain", expect: "nombre saneado" },
  { name: "..\\..\\..\\etc\\passwd.txt", data: "hola", type: "text/plain", expect: "sin carpetas" },
  { name: "tarea‮txt.pdf", data: "%PDF-1.4", type: "application/pdf", expect: "override bidi" },
];
const accepted = {};
for (const cse of cases) {
  const r = await upload(A.t, url, [{ name: cse.name, data: cse.data, type: cse.type }]);
  const f = r.data.files?.[0];
  accepted[cse.name] = f;
  console.log(`${JSON.stringify(cse.name)} → ${r.status} ${f ? `kind=${f.kind} mime=${f.mimeType} fileName=${JSON.stringify(f.fileName)}` : r.data?.error?.message ?? ""} [esperado: ${cse.expect}]`);
}
check("SVG rechazado", !accepted["dibujo.svg"]);
check("HTML rechazado", !accepted["pagina.html"] && !accepted["sin-extension"]);
await sleep(2500);

// Teacher download of the HTML-disguised-as-PNG, inline.
const png = accepted["foto.png"];
const dl = await fetch(`${BASE}/api/activities/${A.activityId}/files/${png.id}/download?inline=1`, { headers: { cookie: A.t.cookieHeader() } });
console.log("descarga inline de foto.png (contenido HTML):", dl.status, dl.headers.get("content-type"), "|", dl.headers.get("content-disposition"), "| nosniff:", dl.headers.get("x-content-type-options"), "| CSP:", dl.headers.get("content-security-policy") ?? "(ninguna)");
check("archivo con bytes HTML se sirve como image/png + nosniff (el navegador no lo interpreta como HTML)", dl.headers.get("content-type") === "image/png" && dl.headers.get("x-content-type-options") === "nosniff");

// Header with the hostile name.
const evil = accepted['evil"; filename=hack.exe\r\nX-Injected: 1.txt'];
if (evil) {
  const d2 = await fetch(`${BASE}/api/activities/${A.activityId}/files/${evil.id}/download`, { headers: { cookie: A.t.cookieHeader() } });
  console.log("Content-Disposition con nombre hostil:", d2.headers.get("content-disposition"), "| X-Injected:", d2.headers.get("x-injected"));
  check("sin inyección de encabezados por nombre de archivo", !d2.headers.get("x-injected"));
}

// Student view of the text file with HTML inside.
const s = new Actor("alumno");
await s.post(`/api/s/${A.linkToken}/join`, { name: "Alumno Archivos" });
const txt = accepted["notas.txt"];
const sd = await s.get(`/api/s/${A.linkToken}/files/${txt.id}`);
console.log("alumno abre notas.txt (bytes HTML):", sd.status, sd.headers.get("content-type"), sd.headers.get("content-disposition"));
check("texto con HTML se sirve como text/plain inline + nosniff", (sd.headers.get("content-type") ?? "").startsWith("text/plain") && sd.headers.get("x-content-type-options") === "nosniff");
const pdfFake = accepted["doc.pdf"];
const st = await A.t.get(`/api/activities/${A.activityId}/files`);
const row = st.data.files.find((f) => f.id === pdfFake.id);
console.log("doc.pdf (bytes HTML) quedó en estado:", row.processingStatus, "-", row.processingError);
const sp = await s.get(`/api/s/${A.linkToken}/files/${pdfFake.id}`);
check("archivo que no se pudo leer no se sirve al alumno", sp.status === 404, String(sp.status));

// Range header handling.
const rr = await fetch(`${BASE}/api/s/${A.linkToken}/files/${txt.id}`, { headers: { cookie: s.cookieHeader(), range: "bytes=999999-" } });
console.log("Range fuera de rango →", rr.status, rr.headers.get("content-range"));
done();
