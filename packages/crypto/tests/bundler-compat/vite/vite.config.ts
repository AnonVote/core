import { defineConfig } from "vite";
import path from "path";

export default defineConfig({
  build: {
    outDir: __dirname,
    emptyOutDir: false,
    ssr: path.join(__dirname, "app.js"),
    rollupOptions: {
      external: ["crypto", "@anonvote/crypto"],
      output: {
        entryFileNames: "bundle.out.js",
        format: "es",
      },
    },
  },
});