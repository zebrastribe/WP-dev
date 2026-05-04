import react from "@vitejs/plugin-react";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { defineConfig } from "vite";

const adminDir = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "../../wordpress/admin",
);

/** Build into repo `wordpress/admin/` for Apache at http://localhost:<WP_PORT>/admin/ */
export default defineConfig({
  plugins: [react()],
  base: "/admin/",
  publicDir: "public",
  build: {
    outDir: adminDir,
    emptyOutDir: true,
  },
  server: {
    port: 5174,
    proxy: {
      "/admin/api.php": {
        target: "http://127.0.0.1:8888",
        changeOrigin: true,
      },
    },
  },
});
