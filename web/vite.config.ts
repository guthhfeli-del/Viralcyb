import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

const API = process.env.VIRALCYB_API ?? "http://127.0.0.1:8000";

// Cross-origin isolation enables SharedArrayBuffer, i.e. multi-threaded
// WASM for the in-browser models (Demucs). "credentialless" keeps
// cross-origin model downloads working without CORP headers.
const ISOLATION = {
  "Cross-Origin-Opener-Policy": "same-origin",
  "Cross-Origin-Embedder-Policy": "credentialless",
};

export default defineConfig({
  plugins: [react()],
  worker: { format: "es" },
  optimizeDeps: { exclude: ["onnxruntime-web"] },
  server: {
    headers: ISOLATION,
    proxy: { "/api": { target: API, changeOrigin: true } },
  },
  preview: {
    headers: ISOLATION,
    proxy: { "/api": { target: API, changeOrigin: true } },
  },
  build: { target: "es2022", sourcemap: false },
  test: {
    include: ["tests/**/*.test.ts"],
    environment: "node",
    testTimeout: 30000,
  },
});
