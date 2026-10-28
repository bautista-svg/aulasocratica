// Checks the 28-10 changes against a deployed instance, in throwaway workspaces deleted at the end:
// divisions (students pick one when entering, En vivo has the filter), the activity's open alerts
// for the «Alertas» tab, and classroom invitations (preview, a workspace without an account
// cannot accept, revoking). Roles are covered by tests/integration/sharing.test.ts.
//   node scripts/dev/prod-divisions-sharing-check.mjs [https://aulasocratica.becode.com.ar]
const BASE = process.argv[2] ?? "https://aulasocratica.becode.com.ar";
let failed = 0;
const ok = (name, pass, detail = "") => {
  if (!pass) failed++;
  console.log(`${pass ? "OK  " : "FAIL"} ${name}${detail ? ` — ${detail}` : ""}`);
};
function jar() {
  const cookies = new Map();
  return {
    header: () => [...cookies].map(([k, v]) => `${k}=${v}`).join("; "),
    store(res) {
      for (const c of res.headers.getSetCookie?.() ?? []) {
        const [pair] = c.split(";");
        const i = pair.indexOf("=");
        cookies.set(pair.slice(0, i), pair.slice(i + 1));
      }
    },
  };
}
async function req(j, method, path, body) {
  const res = await fetch(BASE + path, {
    method,
    headers: { origin: BASE, "x-aula-client": "1", "content-type": "application/json", cookie: j.header() },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  j.store(res);
  const text = await res.text();
  try {
    return { status: res.status, data: JSON.parse(text) };
  } catch {
    return { status: res.status, data: text };
  }
}

const teacher = jar();
const guest = jar();
try {
  await req(teacher, "POST", "/api/auth/start", {});
  const room = await req(teacher, "POST", "/api/classrooms", { name: "Prueba divisiones", teacherName: "Prueba", grade: "1.º", divisionOptions: ["N", "F", "S"] });
  const classroom = room.data.classroom;
  ok("aula con divisiones N, F, S", room.status === 201 || room.status === 200, JSON.stringify(classroom?.divisionOptions));
  const { activity } = (await req(teacher, "POST", "/api/activities", { classroomId: classroom.id, title: "Esparta y Atenas" })).data;
  await req(teacher, "PATCH", `/api/activities/${activity.id}`, { instructions: "Compará Esparta y Atenas.", requireInitialAnswer: false, askReflection: false });
  const pub = await req(teacher, "POST", `/api/activities/${activity.id}/publish`);
  const token = pub.data.activity.linkToken;

  const info = await req(jar(), "GET", `/api/s/${token}`);
  ok("el enlace del alumno trae las divisiones", JSON.stringify(info.data.activity?.divisions ?? info.data.divisions) === '["N","F","S"]', JSON.stringify(info.data.activity?.divisions ?? info.data.divisions));
  const noDivision = await req(jar(), "POST", `/api/s/${token}/join`, { name: "Sin División" });
  ok("sin elegir división no entra", noDivision.status === 400 && Boolean(noDivision.data.error?.fields?.division), `${noDivision.status} ${JSON.stringify(noDivision.data).slice(0, 160)}`);
  const wrong = await req(jar(), "POST", `/api/s/${token}/join`, { name: "Otra División", division: "Z" });
  ok("una división que no es del aula no entra", wrong.status === 400, String(wrong.status));
  for (const [name, division] of [["Ana Prueba", "N"], ["Bruno Prueba", "F"], ["Diego Prueba", "N"]]) {
    const s = jar();
    const r = await req(s, "POST", `/api/s/${token}/join`, { name, division });
    if (r.status !== 200 && r.status !== 201) throw new Error(`join ${name}: ${r.status} ${JSON.stringify(r.data)}`);
    if (name === "Bruno Prueba") await req(s, "POST", `/api/s/${token}/signal`, { kind: "pasted_text", chars: 900 });
  }
  const live = (await req(teacher, "GET", `/api/live/${activity.id}`)).data;
  const counts = Object.fromEntries((live.divisions ?? []).map((d) => [d.division ?? d.value ?? d.key, d.count]));
  ok("En vivo: división de cada alumno", live.participants?.filter((p) => p.division === "N").length === 2, live.participants?.map((p) => `${p.name ?? p.studentName}:${p.division}`).join(", "));
  ok("En vivo: el filtro cuenta cada división", JSON.stringify(live.divisions ?? []).includes('"N"'), JSON.stringify(live.divisions));
  void counts;
  const detail = (await req(teacher, "GET", `/api/activities/${activity.id}`)).data.activity;
  ok("pestaña Alertas: cuenta las abiertas", detail.openAlerts === 1, String(detail.openAlerts));

  const invite = await req(teacher, "POST", `/api/classrooms/${classroom.id}/invites`, { role: "reader" });
  ok("crear enlace de invitación (lector)", invite.status === 200 || invite.status === 201, invite.data.invite?.role ?? invite.data.role);
  const preview = await req(guest, "GET", `/api/invites/${invite.data.token}`);
  ok("la invitación se ve con el aula y el rol", preview.status === 200 && preview.data.status === "valid" && preview.data.role === "reader", `${preview.data.classroom?.label} · ${preview.data.role}`);
  await req(guest, "POST", "/api/auth/start", {});
  const accept = await req(guest, "POST", `/api/invites/${invite.data.token}/accept`);
  ok("sin cuenta no se puede aceptar", accept.status === 403, accept.data.error?.message ?? String(accept.status));
  const stranger = await req(guest, "GET", `/api/classrooms/${classroom.id}`);
  ok("un docente sin acceso no ve el aula", stranger.status === 404, String(stranger.status));
  const sharing = (await req(teacher, "GET", `/api/classrooms/${classroom.id}/sharing`)).data;
  const pending = sharing.invites ?? [];
  const revoke = await req(teacher, "DELETE", `/api/classrooms/${classroom.id}/invites/${pending[0]?.id}`);
  ok("anular la invitación", revoke.status === 200 || revoke.status === 204, String(revoke.status));
  const after = await req(guest, "GET", `/api/invites/${invite.data.token}`);
  ok("la invitación anulada ya no sirve", after.data.status === "revoked", after.data.status);
} catch (e) {
  failed++;
  console.log(`FAIL ${e.message}`);
} finally {
  for (const [who, j] of [["docente", teacher], ["invitado", guest]]) {
    const del = await req(j, "DELETE", "/api/auth/workspace", { confirm: "BORRAR" });
    ok(`espacio de prueba (${who}) borrado`, del.status === 200 || del.status === 204 || del.status === 401, String(del.status));
  }
}
console.log(failed ? `\n${failed} con problemas` : "\nTodo OK");
process.exit(failed ? 1 : 0);
