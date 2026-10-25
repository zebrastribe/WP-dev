import react from "@vitejs/plugin-react";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { defineConfig } from "vite";

const root = path.dirname(fileURLToPath(import.meta.url));

export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: {
      "@wpdev/web": path.resolve(root, "../../packages/wpdev-web/src"),
      "@wpdev/web-host": path.resolve(root, "src/webHost.ts"),
    },
  },
  base: "./",
  publicDir: "public",
  server: {
    port: 5174,
    open: true,
    proxy: {
      "/admin/api.php": { target: "http://127.0.0.1:8888", changeOrigin: true },
    },
  },
});
