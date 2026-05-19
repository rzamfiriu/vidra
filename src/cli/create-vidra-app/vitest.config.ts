import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    environment: "node",
    globals: false,
    include: ["src/__tests__/**/*.test.ts"],
    testTimeout: 20_000,
  },
});
