import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

export default defineConfig({
  root: fileURLToPath(new URL("../..", import.meta.url)),
  test: {
    include: ["scripts/eval-structure/*.eval.ts"],
    environment: "node",
    testTimeout: 3_600_000,
  },
});
