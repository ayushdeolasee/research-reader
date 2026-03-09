import { resolve } from "node:path";
import { defineConfig } from "vite";

export default defineConfig({
  root: resolve(__dirname),
  base: "./",
  server: {
    port: 4174,
  },
  build: {
    outDir: "dist",
    emptyOutDir: true,
  },
});
