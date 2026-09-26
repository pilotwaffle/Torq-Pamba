import { spawnSync } from "node:child_process";
import { copyFileSync, existsSync } from "node:fs";

if (!existsSync(".env.local")) {
  copyFileSync(".env.example", ".env.local");
  console.log("Created .env.local from .env.example");
} else {
  console.log(".env.local already exists");
}

const tsx = existsSync("node_modules/.bin/tsx") ? "node_modules/.bin/tsx" : "tsx";
const result = spawnSync(tsx, ["scripts/migrate.ts"], { stdio: "inherit" });
process.exit(result.status ?? 1);
