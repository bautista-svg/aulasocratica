// Resume el barrido: overflow por pantalla/viewport, axe por pantalla, títulos, objetivos chicos
import fs from "node:fs";
const DATA = "C:/Users/gonib/Downloads/aulasocratica/docs/informes/auditoria-ui/scripts/data";
const r = JSON.parse(fs.readFileSync(DATA + "/barrido-320_375_390_430_768_1024_1440.json", "utf8"));
const keys = [...new Set(r.map((x) => x.key))];
const vws = [...new Set(r.map((x) => x.vw))];
console.log("## Overflow (scrollWidth > clientWidth)");
console.log("| Pantalla | " + vws.join(" | ") + " |");
console.log("|---|" + vws.map(() => "---").join("|") + "|");
for (const k of keys) {
  console.log(`| ${k} | ` + vws.map((v) => { const x = r.find((y) => y.key === k && y.vw === v); return x ? (x.overflow.overflow ? `**${x.overflow.scrollWidth}px**` : "ok") : "-"; }).join(" | ") + " |");
}
console.log("\n## Offenders");
for (const x of r) if (x.overflow.overflow) console.log(x.key, x.vw, JSON.stringify(x.overflow.offenders?.slice(0, 4)));
console.log("\n## Axe");
for (const k of keys) {
  const ax = r.filter((x) => x.key === k && x.axe).flatMap((x) => x.axe.map((a) => `${a.id}(${a.impact},${a.nodes})@${x.vw}`));
  console.log(`| ${k} | ${ax.length ? ax.join(", ") : "sin violaciones"} |`);
}
console.log("\n## Titles generic");
for (const x of r.filter((y) => y.vw === 1440)) if (/un tutor que pregunta/.test(x.title) && x.key !== "landing") console.log(x.key, x.url);
console.log("\n## Logs");
for (const x of r) if (x.log.length) console.log(x.key, x.vw, JSON.stringify(x.log.slice(0, 3)));
console.log("\n## Small targets per screen at 375 (count)");
for (const x of r.filter((y) => y.vw === 375)) console.log(x.key, x.smallTargets.length);
