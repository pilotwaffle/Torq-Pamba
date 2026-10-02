// Polls generation jobs outside any web request: `npm run worker`.
// Uses the same DATABASE_URL / PGLITE_DIR as the app. Ctrl+C to stop.
import { processJobs } from "@/lib/jobs/worker";

const intervalMs = Number(process.env.WORKER_INTERVAL_MS ?? 2000);
let stopping = false;
process.on("SIGINT", () => (stopping = true));
process.on("SIGTERM", () => (stopping = true));

async function main() {
  console.log(`worker: polling every ${intervalMs} ms`);
  while (!stopping) {
    try {
      const result = await processJobs();
      if (result.processed > 0) console.log(`worker: ${result.clips} clip, ${result.renders} render, ${result.errors} errors`);
    } catch (error) {
      console.error("worker: pass failed", error);
    }
    await new Promise((resolve) => setTimeout(resolve, intervalMs));
  }
}

void main();
