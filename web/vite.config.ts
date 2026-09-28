import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

const API = process.env.VIRALCYB_API ?? "http://127.0.0.1:8000";

export default defineConfig({
  plugins: [react()],
  worker: { format: "es" },
  server: {
    proxy: { "/api": { target: API, changeOrigin: true } },
  },
  preview: {
    proxy: { "/api": { target: API, changeOrigin: true } },
  },
  build: { target: "es2022", sourcemap: false },
  test: {
    include: ["tests/**/*.test.ts"],
    environment: "node",
    testTimeout: 30000,
  },
});
