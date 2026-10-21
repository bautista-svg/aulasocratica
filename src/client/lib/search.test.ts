import { describe, expect, it } from "vitest";
import { z } from "zod";
import { optionalBoolean, optionalEnum, optionalString, optionalUuid, searchParams } from "./search";

// The validators replaced these zod schemas in the route definitions: same output, same failures.
const TABS = ["actividades", "alumnos", "alertas"] as const;
const pairs = [
  [searchParams({ tab: optionalEnum(TABS), actividad: optionalString }), z.object({ tab: z.enum(TABS).optional(), actividad: z.string().optional() })],
  [searchParams({ archivadas: optionalBoolean }), z.object({ archivadas: z.boolean().optional() })],
  [searchParams({ aula: optionalUuid }), z.object({ aula: z.string().uuid().optional() })],
] as const;

const inputs: Record<string, unknown>[] = [
  {},
  { tab: "alumnos" },
  { tab: "otra" },
  { tab: 3 },
  { tab: null },
  { actividad: "x", extra: 1 },
  { actividad: 12 },
  { archivadas: true },
  { archivadas: "true" },
  { aula: "3be225bb-a647-408c-9050-f39c1e82b324" },
  { aula: "3BE225BB-A647-408C-9050-F39C1E82B324" },
  { aula: "3be225bb-a647-008c-9050-f39c1e82b324" },
  { aula: "00000000-0000-0000-0000-000000000000" },
  { aula: "no-es-un-id" },
  { aula: 5 },
];

describe("route search validators", () => {
  it("behave like the zod schemas they replaced", () => {
    for (const [mine, zod] of pairs) {
      for (const input of inputs) {
        const expected = zod.safeParse(input);
        if (expected.success) {
          const out = mine(input) as Record<string, unknown>;
          expect(out).toEqual(Object.fromEntries(Object.entries(expected.data).filter(([, v]) => v !== undefined)));
        } else {
          expect(() => mine(input)).toThrow();
        }
      }
    }
  });
});
