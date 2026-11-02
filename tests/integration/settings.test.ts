import { describe, expect, it } from "vitest";
import { call, cookiePair, newTeacher } from "./helpers";

const PASSWORD = "test-admin-password-123456"; // vitest.config.ts

/** A teacher the admin enabled (the same permission as "Pedidos de cambios"). */
async function trusted(email: string) {
  const t = await newTeacher();
  expect((await call("POST", "/api/auth/register", { cookie: t.cookie, body: { email, password: "una-clave-larga" } })).status).toBe(200);
  const admin = cookiePair((await call("POST", "/api/admin/login", { body: { password: PASSWORD } })).cookies, "as_admin");
  expect((await call("POST", "/api/admin/requests-access", { cookie: admin, body: { email, enabled: true } })).status).toBe(200);
  return t;
}

describe("color de la app", () => {
  it("todos lo leen; arranca en azul sin elegir", async () => {
    const r = await call("GET", "/api/settings/appearance");
    expect(r.status).toBe(200);
    expect(r.body).toEqual({ accent: "azul", chosen: false, canChoose: false });
  });

  it("un docente común no lo puede cambiar", async () => {
    const t = await newTeacher();
    expect((await call("GET", "/api/settings/appearance", { cookie: t.cookie })).body.canChoose).toBe(false);
    const r = await call("PUT", "/api/settings/appearance", { cookie: t.cookie, body: { accent: "coral" } });
    expect(r.status).toBe(403);
    expect((await call("GET", "/api/settings/appearance")).body.accent).toBe("azul");
  });

  it("quien tiene el permiso lo elige y queda para todos", async () => {
    const t = await trusted("directora@escuela.edu.ar");
    expect((await call("GET", "/api/settings/appearance", { cookie: t.cookie })).body.canChoose).toBe(true);

    const bad = await call("PUT", "/api/settings/appearance", { cookie: t.cookie, body: { accent: "violeta-neon" } });
    expect(bad.status).toBe(400);

    const ok = await call("PUT", "/api/settings/appearance", { cookie: t.cookie, body: { accent: "turquesa" } });
    expect(ok.status).toBe(200);
    expect(ok.body).toEqual({ accent: "turquesa", chosen: true, canChoose: true });

    const other = await newTeacher();
    expect((await call("GET", "/api/settings/appearance", { cookie: other.cookie })).body).toEqual({ accent: "turquesa", chosen: true, canChoose: false });
    expect((await call("GET", "/api/settings/appearance")).body.accent).toBe("turquesa");
  });
});
