import { defineConfig, type Plugin } from "vite";
import react from "@vitejs/plugin-react";

const nativeAppCompat = (): Plugin => {
  return {
    name: "native-app-compat",
    apply: "build",
    transformIndexHtml: (html) => {
      return html
        .replace(/ crossorigin/g, "")
        .replace(/<script (?:type="module" )?/g, "<script defer ");
    },
  };
};

export default defineConfig({
  plugins: [react(), nativeAppCompat()],
  base: "./",
  server: {
    port: 5173,
    strictPort: true,
  },
  build: {
    outDir: "dist",
    emptyOutDir: true,
    rollupOptions: {
      output: {
        format: "iife",
        inlineDynamicImports: true,
      },
    },
  },
});
