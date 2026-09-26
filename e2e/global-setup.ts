import { rm } from "node:fs/promises";
import path from "node:path";

/**
 * Wipe the e2e PGlite directory before tests talk to it.
 * The production server is already listening, but it opens the database
 * lazily on the first request that needs it (the readiness check is `/`).
 */
export default async function globalSetup(): Promise<void> {
  await rm(path.join(process.cwd(), ".data", "e2e-pglite"), { recursive: true, force: true });
}
