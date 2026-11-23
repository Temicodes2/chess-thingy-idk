import { fileURLToPath } from "node:url";
import { resolve } from "node:path";
import { defineConfig } from "vite";

const projectRoot = resolve(fileURLToPath(new URL(".", import.meta.url)));

export default defineConfig({
  root: resolve(projectRoot, "templates"),
  publicDir: resolve(projectRoot, "static"),
  plugins: [
    {
      name: "chesscom-api-dev",
      configureServer(server) {
        server.middlewares.use(async (req, res, next) => {
          const url = new URL(req.url, "http://localhost");
          if (url.pathname === "/api/chesscom") {
            try {
              const { default: handler } = await import("./api/chesscom.js");
              await handler(req, res);
            } catch (err) {
              res.statusCode = 500;
              res.setHeader("Content-Type", "application/json");
              res.end(JSON.stringify({ error: err.message }));
            }
          } else {
            next();
          }
        });
      },
    },
  ],
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
