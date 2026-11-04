import { describe, expect, it } from "vitest";
import { NEWS, NEWS_RELEASES, unseenNews } from "./news";

describe("Novedades", () => {
  it("shows everything once to a teacher who saw nothing, without repeating what one item already says", () => {
    const keys = unseenNews("").map((i) => i.key);
    expect(keys).toEqual(["webDesign", "redesign", "helpAssistant", "darkMode", "alerts", "deliverables", "aspects", "rubric", "tutors", "english", "consignas", "closing", "scans", "ending", "tutorRules", "skills", "formative", "indicators", "reflection", "sharedSummary", "alertsTab", "divisions", "sharedClassrooms", "defense", "indicatorLevels", "tutorStop", "structure", "trash", "google"]);
  });

  it("after a release, shows only what is new to that teacher", () => {
    expect(unseenNews("2026-10-22").map((i) => i.key)).toEqual(["webDesign", "redesign", "helpAssistant", "darkMode", "tutors", "links", "english", "consignas", "closing", "scans", "ending", "tutorRules", "skills", "formative", "indicators", "reflection", "sharedSummary", "alertsTab", "divisions", "sharedClassrooms", "defense", "indicatorLevels", "tutorStop", "structure", "trash", "google"]);
    expect(unseenNews("2026-10-22b").map((i) => i.key)).toEqual(["webDesign", "redesign", "helpAssistant", "darkMode", "english", "consignas", "closing", "ending", "tutorRules", "skills", "formative", "indicators", "reflection", "sharedSummary", "alertsTab", "divisions", "sharedClassrooms", "defense", "indicatorLevels", "tutorStop", "structure", "trash", "google"]);
    expect(unseenNews("2026-10-22c").map((i) => i.key)).toEqual(["webDesign", "redesign", "helpAssistant", "darkMode", "ending", "tutorRules", "skills", "formative", "indicators", "reflection", "sharedSummary", "alertsTab", "divisions", "sharedClassrooms", "defense", "indicatorLevels", "tutorStop", "structure", "trash", "google"]);
    // Those who already saw «Entrá con tu cuenta» get only what came after.
    expect(unseenNews("2026-10-23").map((i) => i.key)).toEqual(["webDesign", "redesign", "helpAssistant", "darkMode", "skills", "formative", "indicators", "reflection", "sharedSummary", "alertsTab", "divisions", "sharedClassrooms", "defense", "indicatorLevels", "tutorStop", "structure", "trash", "google"]);
    expect(unseenNews("2026-10-23b").map((i) => i.key)).toEqual(["webDesign", "redesign", "helpAssistant", "darkMode", "skills", "formative", "indicators", "reflection", "sharedSummary", "alertsTab", "divisions", "sharedClassrooms", "defense", "indicatorLevels", "tutorStop", "structure", "trash"]);
    expect(unseenNews("2026-10-23c").map((i) => i.key)).toEqual(["webDesign", "redesign", "helpAssistant", "darkMode", "formative", "indicators", "reflection", "sharedSummary", "alertsTab", "divisions", "sharedClassrooms", "defense", "indicatorLevels", "tutorStop", "structure", "trash"]);
    expect(unseenNews("2026-10-23d").map((i) => i.key)).toEqual(["webDesign", "redesign", "helpAssistant", "darkMode", "formative", "indicators", "reflection", "sharedSummary", "alertsTab", "divisions", "sharedClassrooms", "defense", "indicatorLevels", "tutorStop"]);
    expect(unseenNews("2026-10-24").map((i) => i.key)).toEqual(["webDesign", "redesign", "helpAssistant", "darkMode", "indicators", "reflection", "sharedSummary", "alertsTab", "divisions", "sharedClassrooms", "defense", "indicatorLevels", "tutorStop"]);
    expect(unseenNews("2026-10-24b").map((i) => i.key)).toEqual(["webDesign", "redesign", "helpAssistant", "darkMode", "reflection", "sharedSummary", "alertsTab", "divisions", "sharedClassrooms", "defense", "indicatorLevels", "tutorStop"]);
    expect(unseenNews("2026-10-26").map((i) => i.key)).toEqual(["webDesign", "redesign", "helpAssistant", "darkMode", "sharedSummary", "alertsTab", "divisions", "sharedClassrooms", "defense", "indicatorLevels", "tutorStop"]);
    expect(unseenNews("2026-10-26b").map((i) => i.key)).toEqual(["webDesign", "redesign", "helpAssistant", "darkMode", "alertsTab", "divisions", "sharedClassrooms", "defense", "indicatorLevels", "tutorStop"]);
    expect(unseenNews("2026-10-28").map((i) => i.key)).toEqual(["webDesign", "redesign", "helpAssistant", "darkMode", "divisions", "sharedClassrooms", "defense", "indicatorLevels", "tutorStop"]);
    expect(unseenNews("2026-10-28b").map((i) => i.key)).toEqual(["webDesign", "redesign", "helpAssistant", "darkMode", "sharedClassrooms", "defense", "indicatorLevels", "tutorStop"]);
    expect(unseenNews("2026-10-28c").map((i) => i.key)).toEqual(["webDesign", "redesign", "helpAssistant", "darkMode", "defense", "indicatorLevels", "tutorStop"]);
    expect(unseenNews("2026-10-29").map((i) => i.key)).toEqual(["webDesign", "redesign", "helpAssistant", "darkMode", "indicatorLevels", "tutorStop"]);
    expect(unseenNews("2026-10-29b").map((i) => i.key)).toEqual(["webDesign", "redesign", "helpAssistant", "darkMode", "tutorStop"]);
    expect(unseenNews("2026-10-29c").map((i) => i.key)).toEqual(["webDesign", "redesign", "helpAssistant", "darkMode"]);
    expect(unseenNews("2026-11-02").map((i) => i.key)).toEqual(["webDesign"]);
    expect(unseenNews(NEWS.id)).toEqual([]);
    expect(NEWS.id).toBe(NEWS_RELEASES.at(-1));
  });
});
