import react from "@vitejs/plugin-react";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { defineConfig } from "vite";

const outDir = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "../../wordpress/import",
);

export default defineConfig({
  plugins: [react()],
  base: "/import/",
  build: {
    outDir,
    emptyOutDir: true,
  },
});
