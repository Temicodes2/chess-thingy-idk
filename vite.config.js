import { fileURLToPath } from "node:url";
import { resolve } from "node:path";
import { defineConfig } from "vite";

const projectRoot = resolve(fileURLToPath(new URL(".", import.meta.url)));

export default defineConfig({
  root: resolve(projectRoot, "templates"),
  publicDir: resolve(projectRoot, "static"),
  server: {
    fs: {
      allow: [projectRoot],
    },
  },
  build: {
    outDir: resolve(projectRoot, "dist"),
    emptyOutDir: true,
  },
});
