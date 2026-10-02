import { readFile } from "node:fs/promises";
import path from "node:path";
import { PGlite } from "@electric-sql/pglite";
import { eq, sql } from "drizzle-orm";
import { describe, expect, it } from "vitest";
import { getDb } from "@/db";
import * as schema from "@/db/schema";
import {
  apiKeys,
  creditLedger,
  generationJobs,
  mediaAssets,
  plans,
  sceneTakes,
  videoCaptions,
  videoHooks,
  videoRenders,
  videoScenes,
  videos,
  workspaces,
} from "@/db/schema";
import { signupAccount } from "@/lib/auth/account";

const DRIZZLE = path.join(process.cwd(), "drizzle");

const V2_TABLES = [
  "media_assets",
  "generation_jobs",
  "video_renders",
  "video_scenes",
  "scene_takes",
  "video_captions",
  "video_hooks",
  "conversations",
  "chat_tool_calls",
  "voices",
  "voice_clones",
  "voice_clone_samples",
  "inspiration_accounts",
  "viral_posts",
  "trends",
  "ideas",
  "plans",
  "credit_ledger",
  "credit_top_ups",
  "credit_charges",
  "publishing_connections",
  "publish_attempts",
  "post_analytics_snapshots",
  "knowledge_items",
  "api_keys",
];

type Journal = { entries: { idx: number; tag: string }[] };

async function journal(): Promise<Journal> {
  return JSON.parse(await readFile(path.join(DRIZZLE, "meta", "_journal.json"), "utf8")) as Journal;
}

async function statements(tag: string): Promise<string[]> {
  const text = await readFile(path.join(DRIZZLE, `${tag}.sql`), "utf8");
  return text
    .split("--> statement-breakpoint")
    .map((statement) => statement.trim())
    .filter(Boolean);
}

function email(label: string) {
  return `${label}-${Date.now()}-${Math.random().toString(16).slice(2)}@example.com`;
}

async function expectViolation(run: Promise<unknown>, pattern: RegExp) {
  const error = await run.then(
    () => null,
    (caught: unknown) => caught,
  );
  expect(error, "expected the database to reject the write").toBeTruthy();
  const cause = (error as { cause?: { message?: string } }).cause;
  expect(`${(error as Error).message} ${cause?.message ?? ""}`).toMatch(pattern);
}

async function rows<T>(query: ReturnType<typeof sql>): Promise<T[]> {
  const db = await getDb();
  const result = (await db.execute(query)) as unknown as { rows: T[] };
  return result.rows;
}

describe("migrations", () => {
  it("adds every v2 table in one migration after 0000_init, with later migrations after it", async () => {
    const { entries } = await journal();
    // Ported feature migrations (phase 2+) follow the foundation, numbered in order.
    expect(entries.slice(0, 2).map((entry) => entry.tag)).toEqual(["0000_init", "0001_v2_foundation"]);
    entries.forEach((entry, index) => expect(entry.tag.startsWith(String(index).padStart(4, "0") + "_")).toBe(true));
    const init = (await statements("0000_init")).join("\n");
    const v2 = (await statements("0001_v2_foundation")).join("\n");
    const later = (await Promise.all(entries.slice(2).map((entry) => statements(entry.tag)))).flat().join("\n");
    for (const table of V2_TABLES) {
      expect(init).not.toContain(`CREATE TABLE "${table}"`);
      expect(v2).toContain(`CREATE TABLE "${table}"`);
      expect(later).not.toContain(`CREATE TABLE "${table}"`);
    }
  });

  it("matches src/db/schema exactly (run npm run db:generate after a schema change)", async () => {
    const { generateDrizzleJson, generateMigration } = await import("drizzle-kit/api");
    const { entries } = await journal();
    const latest = entries.at(-1)!;
    const snapshotFile = `${String(latest.idx).padStart(4, "0")}_snapshot.json`;
    const snapshot = JSON.parse(await readFile(path.join(DRIZZLE, "meta", snapshotFile), "utf8"));
    const current = generateDrizzleJson(schema as unknown as Record<string, unknown>, snapshot.id);
    expect(await generateMigration(snapshot, current)).toEqual([]);
  });

  it("creates every table in the live database", async () => {
    const found = await rows<{ table_name: string }>(
      sql`select table_name from information_schema.tables where table_schema = 'public'`,
    );
    const names = new Set(found.map((row) => row.table_name));
    for (const table of V2_TABLES) expect(names, table).toContain(table);
  });

  it("consolidates the phase 2-4 tables onto the foundation tables (0005 adds columns, 0006 drops the duplicates)", async () => {
    const { entries } = await journal();
    expect(entries.map((entry) => entry.tag)).toEqual(expect.arrayContaining(["0005_consolidate_foundation", "0006_drop_phase_duplicates"]));
    const consolidate = (await statements("0005_consolidate_foundation")).join("\n");
    expect(consolidate).not.toMatch(/DROP TABLE/);
    const drops = await statements("0006_drop_phase_duplicates");
    expect(drops.every((statement) => /^DROP (TABLE|TYPE) /.test(statement))).toBe(true);
    const found = await rows<{ table_name: string }>(
      sql`select table_name from information_schema.tables where table_schema = 'public'`,
    );
    const names = new Set(found.map((row) => row.table_name));
    for (const gone of ["social_accounts", "publish_jobs", "post_metrics", "knowledge_tiles", "api_credentials"]) {
      expect(names, gone).not.toContain(gone);
    }
    const added = await rows<{ table_name: string; column_name: string }>(sql`
      select table_name, column_name from information_schema.columns
      where table_schema = 'public' and (table_name, column_name) in (
        ('publishing_connections', 'mode'), ('publish_attempts', 'mode'), ('publish_attempts', 'privacy'),
        ('post_analytics_snapshots', 'reach'), ('knowledge_items', 'score'),
        ('api_keys', 'kind'), ('api_keys', 'grant_id'), ('api_keys', 'client_id'))
    `);
    expect(added).toHaveLength(8);
  });

  it("upgrades a database that already holds main's data", async () => {
    const client = new PGlite();
    try {
      for (const statement of await statements("0000_init")) await client.exec(statement);
      await client.exec(`
        insert into workspaces (name, plan) values ('Free Co', 'free'), ('Creator Co', 'creator'), ('Studio Co', 'studio');
        insert into videos (workspace_id, title, status)
          select id, 'Old clip', 'ready' from workspaces where name = 'Creator Co';
      `);
      for (const statement of await statements("0001_v2_foundation")) await client.exec(statement);

      const upgraded = await client.query<{ name: string; plan_id: string; credit_balance: number }>(
        "select name, plan_id, credit_balance from workspaces order by name",
      );
      expect(upgraded.rows).toEqual([
        { name: "Creator Co", plan_id: "hobby", credit_balance: 0 },
        { name: "Free Co", plan_id: "free", credit_balance: 0 },
        { name: "Studio Co", plan_id: "pro", credit_balance: 0 },
      ]);
      const old = await client.query<{ credits_charged: number; current_render_id: string | null }>(
        "select credits_charged, current_render_id from videos",
      );
      expect(old.rows).toEqual([{ credits_charged: 0, current_render_id: null }]);
    } finally {
      await client.close();
    }
  });
});

describe("v2 schema", () => {
  it("seeds the credit plans: Hobby $16 for 1,600 credits and Pro $100 for 10,000", async () => {
    const db = await getDb();
    const seeded = await db
      .select({
        id: plans.id,
        monthlyPriceCents: plans.monthlyPriceCents,
        monthlyCredits: plans.monthlyCredits,
      })
      .from(plans)
      .orderBy(plans.sortOrder);
    expect(seeded).toEqual([
      { id: "free", monthlyPriceCents: 0, monthlyCredits: 0 },
      { id: "hobby", monthlyPriceCents: 1600, monthlyCredits: 1600 },
      { id: "pro", monthlyPriceCents: 10000, monthlyCredits: 10000 },
    ]);
  });

  it("puts new workspaces on the free plan with a zero balance", async () => {
    const { workspace } = await signupAccount({
      email: email("plan"),
      password: "correct-horse-battery",
      workspaceName: "Plan Co",
    });
    expect(workspace.planId).toBe("free");
    expect(workspace.creditBalance).toBe(0);
    const db = await getDb();
    await expectViolation(
      db.update(workspaces).set({ planId: "enterprise" }).where(eq(workspaces.id, workspace.id)),
      /foreign key/i,
    );
  });

  it("ties every workspace-scoped table to workspaces with ON DELETE CASCADE", async () => {
    const scoped = await rows<{ table_name: string }>(sql`
      select table_name from information_schema.columns
      where table_schema = 'public' and column_name = 'workspace_id'
    `);
    const cascading = await rows<{ table_name: string }>(sql`
      select rel.relname as table_name
      from pg_constraint con
      join pg_class rel on rel.oid = con.conrelid
      join pg_class ref on ref.oid = con.confrelid
      join pg_attribute att on att.attrelid = con.conrelid and att.attnum = any(con.conkey)
      where con.contype = 'f' and ref.relname = 'workspaces'
        and att.attname = 'workspace_id' and con.confdeltype = 'c'
    `);
    const withCascade = new Set(cascading.map((row) => row.table_name));
    expect(scoped.length).toBeGreaterThan(20);
    for (const { table_name } of scoped) expect(withCascade, table_name).toContain(table_name);
  });

  it("links scenes, takes, renders, captions and hooks, then cascades a workspace delete", async () => {
    const db = await getDb();
    const { workspace } = await signupAccount({
      email: email("editor"),
      password: "correct-horse-battery",
      workspaceName: "Editor Co",
    });
    const [video] = await db
      .insert(videos)
      .values({ workspaceId: workspace.id, title: "Takes", status: "ready" })
      .returning();
    const [clip] = await db
      .insert(mediaAssets)
      .values({
        workspaceId: workspace.id,
        kind: "video",
        source: "generated",
        storage: "s3",
        storageKey: `clips/${video!.id}/0.mp4`,
        url: "https://media.example.test/clip.mp4",
        mimeType: "video/mp4",
        sizeBytes: 1_234_567,
        durationMs: 10_000,
      })
      .returning();
    const [job] = await db
      .insert(generationJobs)
      .values({
        workspaceId: workspace.id,
        videoId: video!.id,
        kind: "clip",
        provider: "omni-flash",
        providerJobId: `op-${video!.id}`,
        status: "succeeded",
        outputAssetId: clip!.id,
      })
      .returning();
    const [scene] = await db
      .insert(videoScenes)
      .values({ videoId: video!.id, position: 0, visual: "kitchen", line: "Hi", durationMs: 10_000 })
      .returning();
    const takes = await db
      .insert(sceneTakes)
      .values([
        { sceneId: scene!.id, number: 1, status: "ready", jobId: job!.id, clipAssetId: clip!.id },
        { sceneId: scene!.id, number: 2, status: "failed" },
      ])
      .returning();
    await db.update(videoScenes).set({ selectedTakeId: takes[0]!.id }).where(eq(videoScenes.id, scene!.id));
    const [render] = await db
      .insert(videoRenders)
      .values({ videoId: video!.id, status: "ready", outputAssetId: clip!.id, durationMs: 10_000 })
      .returning();
    await db.update(videos).set({ currentRenderId: render!.id }).where(eq(videos.id, video!.id));
    await db.insert(videoCaptions).values({ videoId: video!.id, sceneId: scene!.id, position: 0, startMs: 0, endMs: 10_000, text: "Hi" });
    await db.insert(videoHooks).values([
      { videoId: video!.id, position: 0, text: "Hook A", isSelected: true },
      { videoId: video!.id, position: 1, text: "Hook B" },
    ]);

    await expectViolation(
      db.update(videoHooks).set({ isSelected: true }).where(eq(videoHooks.text, "Hook B")),
      /unique|duplicate/i,
    );
    await expectViolation(
      db.insert(sceneTakes).values({ sceneId: scene!.id, number: 1 }),
      /unique|duplicate/i,
    );
    await expectViolation(
      db.insert(videoCaptions).values({ videoId: video!.id, position: 1, startMs: 5000, endMs: 1000, text: "x" }),
      /check/i,
    );

    await db.delete(workspaces).where(eq(workspaces.id, workspace.id));
    const leftover = await rows<{ count: number }>(sql`
      select (select count(*) from video_scenes where video_id = ${video!.id})::int
           + (select count(*) from scene_takes where scene_id = ${scene!.id})::int
           + (select count(*) from media_assets where workspace_id = ${workspace.id})::int
           + (select count(*) from generation_jobs where workspace_id = ${workspace.id})::int
           + (select count(*) from video_hooks where video_id = ${video!.id})::int as count
    `);
    expect(leftover[0]?.count).toBe(0);
  });

  it("rejects orphans, duplicate key hashes, zero ledger rows and replayed idempotency keys", async () => {
    const db = await getDb();
    const { workspace } = await signupAccount({
      email: email("ledger"),
      password: "correct-horse-battery",
      workspaceName: "Ledger Co",
    });
    await expectViolation(
      db.insert(sceneTakes).values({ sceneId: "00000000-0000-4000-8000-000000000000", number: 1 }),
      /foreign key/i,
    );

    const keyHash = `sha256-${workspace.id}`;
    await db.insert(apiKeys).values({ workspaceId: workspace.id, name: "CI", prefix: "tp_test_ab", keyHash });
    await expectViolation(
      db.insert(apiKeys).values({ workspaceId: workspace.id, name: "Copy", prefix: "tp_test_ab", keyHash }),
      /unique|duplicate/i,
    );

    await expectViolation(
      db.insert(creditLedger).values({ workspaceId: workspace.id, kind: "adjustment", delta: 0, balanceAfter: 0 }),
      /check/i,
    );
    const grant = {
      workspaceId: workspace.id,
      kind: "plan_grant" as const,
      delta: 1600,
      balanceAfter: 1600,
      planId: "hobby",
      idempotencyKey: `grant:${workspace.id}:2026-10`,
    };
    await db.insert(creditLedger).values(grant);
    await expectViolation(db.insert(creditLedger).values(grant), /unique|duplicate/i);
  });
});
