import { defineConfig } from "vite";
import path from "node:path";

const ROOT_DIR = process.cwd();

export default defineConfig(({ command }) => ({
  root: "site",
  publicDir: "public",
  base: "/",
  build: {
    assetsDir: "site-assets",
    emptyOutDir: true,
    outDir: path.resolve(ROOT_DIR, "dist"),
  },
}));
