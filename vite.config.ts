import path from "node:path";
import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";
import { tanstackRouter } from "@tanstack/router-plugin/vite";
import { compressAssets } from "./scripts/vite-compress";
import { preloadFonts, routePreloads } from "./scripts/vite-preloads";

export default defineConfig({
  root: "src/client",
  publicDir: path.resolve(__dirname, "public"),
  plugins: [
    tanstackRouter({
      target: "react",
      autoCodeSplitting: true,
      routesDirectory: path.resolve(__dirname, "src/client/routes"),
      generatedRouteTree: path.resolve(__dirname, "src/client/routeTree.gen.ts"),
      quoteStyle: "double",
    }),
    react(),
    tailwindcss(),
    preloadFonts(),
    routePreloads(),
    compressAssets(),
  ],
  resolve: {
    alias: {
      "@shared": path.resolve(__dirname, "src/shared"),
      "@client": path.resolve(__dirname, "src/client"),
    },
  },
  build: {
    outDir: path.resolve(__dirname, "dist/client"),
    emptyOutDir: true,
    target: "es2022",
    sourcemap: false,
    assetsInlineLimit: 2048,
    rollupOptions: {
      output: {
        manualChunks(id) {
          if (id.includes("node_modules/react-dom") || id.includes("node_modules/react/") || id.includes("node_modules/scheduler")) return "react";
          if (id.includes("node_modules/@tanstack")) return "tanstack";
          return undefined;
        },
      },
    },
  },
  server: {
    port: 5173,
    strictPort: true,
    proxy: { "/api": { target: "http://127.0.0.1:3000", changeOrigin: false } },
  },
  preview: { port: 4173 },
});
