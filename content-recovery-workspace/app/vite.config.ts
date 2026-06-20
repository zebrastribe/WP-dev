import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";

export default defineConfig({
  plugins: [react()],
  base: "/import/",
  server: {
    port: 5175,
    proxy: {
      "/import/api": {
        target: "http://127.0.0.1:8889",
        changeOrigin: true,
      },
    },
  },
});
