import { describe, expect, it } from "vitest";
import { NEWS, NEWS_RELEASES, unseenNews } from "./news";

describe("Novedades", () => {
  it("shows everything once to a teacher who saw nothing, without repeating what one item already says", () => {
    const keys = unseenNews("").map((i) => i.key);
    expect(keys).toEqual(["alerts", "deliverables", "aspects", "rubric", "tutors", "english", "consignas", "closing", "scans", "ending", "tutorRules", "signin"]);
  });

  it("after a release, shows only what is new to that teacher", () => {
    expect(unseenNews("2026-10-22").map((i) => i.key)).toEqual(["tutors", "links", "english", "consignas", "closing", "scans", "ending", "tutorRules", "signin"]);
    expect(unseenNews("2026-10-22b").map((i) => i.key)).toEqual(["english", "consignas", "closing", "ending", "tutorRules", "signin"]);
    expect(unseenNews("2026-10-22c").map((i) => i.key)).toEqual(["ending", "tutorRules", "signin"]);
    expect(unseenNews(NEWS.id)).toEqual([]);
    expect(NEWS.id).toBe(NEWS_RELEASES.at(-1));
  });
});
