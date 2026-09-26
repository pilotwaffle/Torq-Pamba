import { mkdirSync } from "node:fs";
import path from "node:path";
import { PGlite } from "@electric-sql/pglite";
import { drizzle as drizzlePg } from "drizzle-orm/node-postgres";
import { migrate as migratePg } from "drizzle-orm/node-postgres/migrator";
import { drizzle as drizzlePglite, type PgliteDatabase } from "drizzle-orm/pglite";
import { migrate as migratePglite } from "drizzle-orm/pglite/migrator";
import { Pool } from "pg";
import * as schema from "./schema";

export type AppDb = PgliteDatabase<typeof schema>;

type DbState = {
  ready: Promise<AppDb>;
};

const globalForDb = globalThis as typeof globalThis & {
  __torqPambaDb?: DbState;
};

async function openAndMigrate(): Promise<AppDb> {
  const folder = path.join(process.cwd(), "drizzle");
  const databaseUrl = process.env.DATABASE_URL?.trim();

  if (databaseUrl) {
    const pool = new Pool({ connectionString: databaseUrl });
    const db = drizzlePg(pool, { schema });
    try {
      await migratePg(db, { migrationsFolder: folder });
    } catch (error) {
      await pool.end();
      throw error;
    }
    return db as unknown as AppDb;
  }

  const dir = process.env.PGLITE_DIR?.trim() || "./.data/pglite";
  // PGlite does not create missing parent directories.
  if (dir !== "memory") mkdirSync(dir, { recursive: true });
  const client = dir === "memory" ? new PGlite() : new PGlite(dir);
  await client.waitReady;
  const db = drizzlePglite(client, { schema });
  await migratePglite(db, { migrationsFolder: folder });
  return db;
}

export function getDb(): Promise<AppDb> {
  if (!globalForDb.__torqPambaDb) {
    const state = {} as DbState;
    state.ready = openAndMigrate().catch((error: unknown) => {
      if (globalForDb.__torqPambaDb === state) {
        globalForDb.__torqPambaDb = undefined;
      }
      throw error;
    });
    globalForDb.__torqPambaDb = state;
  }
  return globalForDb.__torqPambaDb.ready;
}
