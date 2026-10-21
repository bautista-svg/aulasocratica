import { defineConfig, mergeConfig } from "vite";
import base from "../../vite.config";
import fs from "node:fs";

export default mergeConfig(
  base,
  defineConfig({
    build: { outDir: process.env.ANALYZE_OUT!, emptyOutDir: true },
    plugins: [
      {
        name: "analyze",
        generateBundle(_o, bundle) {
          const out: Record<string, unknown> = {};
          for (const [f, ch] of Object.entries(bundle)) {
            if (ch.type !== "chunk") continue;
            out[f] = {
              size: ch.code.length,
              isEntry: ch.isEntry,
              imports: ch.imports,
              dynamicImports: ch.dynamicImports,
              modules: Object.entries(ch.modules)
                .map(([id, m]) => [
                  id
                    .replace(/\\/g, "/")
                    .replace(/.*node_modules\//, "nm:")
                    .replace(/.*src\/client\//, "client:")
                    .replace(/.*src\/shared\//, "shared:"),
                  m.renderedLength,
                ])
                .sort((a, b) => (b[1] as number) - (a[1] as number)),
            };
          }
          fs.writeFileSync(process.env.ANALYZE_JSON!, JSON.stringify(out, null, 1));
        },
      },
    ],
  }),
);
