import path from "node:path";
import { configDefaults, defineConfig } from "vitest/config";

// `npm test` clears DATABASE_URL and uses in-memory PGlite.
// A postgres:// URL (the CI postgres job) is passed through to getDb().
const databaseUrl = process.env.DATABASE_URL?.trim() ?? "";

export default defineConfig({
  test: {
    environment: "node",
    exclude: [...configDefaults.exclude, "e2e/**"],
    env: {
      PGLITE_DIR: databaseUrl ? process.env.PGLITE_DIR?.trim() || "memory" : "memory",
      DATABASE_URL: databaseUrl,
    },
    testTimeout: 30000,
    hookTimeout: 30000,
    fileParallelism: false,
  },
  resolve: {
    alias: {
      "@": path.resolve(process.cwd(), "src"),
    },
  },
});
