import { describe, expect, it } from "vitest";
import { call, newTeacher } from "./helpers";
import { NEWS } from "@shared/domain/news";

describe("Novedades notice", () => {
  it("is pending for every workspace until it is shown once, then never again", async () => {
    const t = await newTeacher();
    const before = await call("GET", "/api/auth/me", { cookie: t.cookie });
    expect(before.body.teacher.newsSeen).toBe("");

    const seen = await call("POST", "/api/auth/me/news", { cookie: t.cookie, body: { id: NEWS.id } });
    expect(seen.status).toBe(200);
    expect(seen.body.teacher.newsSeen).toBe(NEWS.id);
    expect((await call("GET", "/api/auth/me", { cookie: t.cookie })).body.teacher.newsSeen).toBe(NEWS.id);

    expect((await call("POST", "/api/auth/me/news", { cookie: t.cookie, body: { id: "" } })).status).toBe(400);
    expect((await call("POST", "/api/auth/me/news", { cookie: t.cookie, body: { id: "x".repeat(41) } })).status).toBe(400);
    expect((await call("POST", "/api/auth/me/news", { body: { id: NEWS.id } })).status).toBe(401);
  });
});
