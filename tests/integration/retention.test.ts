import { describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { db, schema } from "@server/db/client";
import { runRetention } from "@server/services/retention";
import { humanCode, randomToken } from "@server/lib/crypto";

const DAY = 86_400_000;

async function teacher(daysIdle: number, opts: { account?: boolean; content?: boolean } = {}) {
  const [t] = await db
    .insert(schema.teachers)
    .values({
      lastSeenAt: new Date(Date.now() - daysIdle * DAY),
      ...(opts.account ? { email: `t${randomToken(4)}@x.com`, passwordHash: "scrypt$x" } : {}),
    })
    .returning();
  if (opts.content) await db.insert(schema.classrooms).values({ teacherId: t!.id, name: "Aula" });
  return t!.id;
}

const exists = async (id: string) => (await db.select().from(schema.teachers).where(eq(schema.teachers.id, id))).length === 1;

describe("retention job", () => {
  it("applies the documented rules", async () => {
    const emptyOld = await teacher(31);
    const emptyRecent = await teacher(5);
    const withContent = await teacher(200, { content: true });
    const withContentVeryOld = await teacher(366, { content: true });
    const account = await teacher(900, { account: true, content: true });
    await runRetention();
    expect(await exists(emptyOld)).toBe(false);
    expect(await exists(emptyRecent)).toBe(true);
    expect(await exists(withContent)).toBe(true);
    expect(await exists(withContentVeryOld)).toBe(false);
    expect(await exists(account)).toBe(true);
  });

  it("purges interrupted partial tutor replies and expired tokens", async () => {
    const t = await teacher(1, { content: true });
    const [room] = await db.select().from(schema.classrooms).where(eq(schema.classrooms.teacherId, t));
    const [a] = await db.insert(schema.activities).values({ teacherId: t, classroomId: room!.id, title: "A", linkToken: randomToken() }).returning();
    const [st] = await db.insert(schema.students).values({ classroomId: room!.id, fullName: "Ana", nameKey: "ana" }).returning();
    const [se] = await db.insert(schema.learningSessions).values({ activityId: a!.id, studentId: st!.id, resumeCode: humanCode(6) }).returning();
    await db.insert(schema.messages).values([
      { sessionId: se!.id, role: "assistant", content: "cortada", isPartial: true, createdAt: new Date(Date.now() - 20 * 60_000) },
      { sessionId: se!.id, role: "assistant", content: "en curso", isPartial: true },
      { sessionId: se!.id, role: "assistant", content: "completa" },
    ]);
    await db.insert(schema.studentTokens).values({ sessionId: se!.id, tokenHash: randomToken(), expiresAt: new Date(Date.now() - 1000) });
    await runRetention();
    const msgs = await db.select({ c: schema.messages.content }).from(schema.messages).where(eq(schema.messages.sessionId, se!.id));
    expect(msgs.map((m) => m.c).sort()).toEqual(["completa", "en curso"]);
    expect(await db.select().from(schema.studentTokens).where(eq(schema.studentTokens.sessionId, se!.id))).toHaveLength(0);
  });
});
