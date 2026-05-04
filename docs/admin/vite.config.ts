import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";

export default defineConfig({
  plugins: [react()],
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
