// Driver interactivo: mantiene un navegador abierto y ejecuta fragmentos JS enviados por HTTP (solo localhost).
// Uso: node driver.mjs  ->  POST http://127.0.0.1:9333/run  (body = cuerpo de función async con S y L)
import http from "node:http";
import * as L from "./lib.mjs";

process.on("unhandledRejection", (e) => console.log("unhandledRejection", String(e).slice(0, 300)));
process.on("uncaughtException", (e) => console.log("uncaughtException", String(e).slice(0, 300)));
const browser = await L.launch();
const S = { browser, ctx: {}, page: {}, log: [], data: {} };
S.open = async (name, opts = {}) => {
  if (S.ctx[name]) await S.ctx[name].close().catch(() => {});
  S.ctx[name] = await L.context(browser, opts);
  S.page[name] = await S.ctx[name].newPage();
  L.instrument(S.page[name], name, S.log);
  return name;
};
S.newPage = async (name, ctxName) => {
  S.page[name] = await S.ctx[ctxName].newPage();
  L.instrument(S.page[name], name, S.log);
  return name;
};
const AsyncFunction = Object.getPrototypeOf(async function () {}).constructor;

http.createServer(async (req, res) => {
  let body = "";
  req.on("data", (c) => (body += c));
  req.on("end", async () => {
    const started = S.log.length;
    let out;
    try {
      const fn = new AsyncFunction("S", "L", body);
      const r = await Promise.race([fn(S, L), new Promise((_, rej) => setTimeout(() => rej(new Error("driver timeout 280s")), 280000))]);
      out = { ok: true, result: r };
    } catch (e) {
      out = { ok: false, error: String(e && e.stack ? e.stack.split("\n").slice(0, 6).join("\n") : e) };
    }
    out.newLog = S.log.slice(started);
    res.writeHead(200, { "content-type": "application/json" });
    res.end(JSON.stringify(out, null, 1));
  });
}).listen(9333, "127.0.0.1", () => console.log("driver listo en 9333"));
