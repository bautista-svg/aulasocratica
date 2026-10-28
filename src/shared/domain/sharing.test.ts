import { describe, expect, it } from "vitest";
import { can, deniedMessage, isMemberRole } from "./sharing";

describe("Compartir aula: roles", () => {
  it("each role can do what its level allows, and only the owner deletes the classroom", () => {
    const table = (["owner", "admin", "editor", "reader"] as const).map((r) => [r, can(r, "edit"), can(r, "manage"), can(r, "own")]);
    expect(table).toEqual([
      ["owner", true, true, true],
      ["admin", true, true, false],
      ["editor", true, false, false],
      ["reader", false, false, false],
    ]);
  });

  it("explains the refusal in plain words", () => {
    expect(deniedMessage("reader", "edit")).toMatch(/lectura/);
    expect(deniedMessage("editor", "manage")).toMatch(/admin/);
    expect(deniedMessage("admin", "own")).toMatch(/eliminarla/);
  });

  it("accepts only member roles from outside", () => {
    expect(["admin", "editor", "reader", "owner", "x", null].map(isMemberRole)).toEqual([true, true, true, false, false, false]);
  });
});
