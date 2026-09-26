import { and, asc, desc, eq } from "drizzle-orm";
import { getDb } from "@/db";
import { avatars, type AvatarScene } from "@/db/schema";
import { writeAudit } from "@/lib/audit";
import { getStockAvatar } from "./catalog";
import { generateAvatar } from "./generate";
import { sceneFrames, svgDataUrl } from "./portrait";

export class AvatarError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "AvatarError";
  }
}

export async function listWorkspaceAvatars(workspaceId: string) {
  const db = await getDb();
  return db
    .select()
    .from(avatars)
    .where(eq(avatars.workspaceId, workspaceId))
    .orderBy(desc(avatars.isDefault), asc(avatars.createdAt));
}

export async function saveStockAvatar(input: {
  workspaceId: string;
  actorUserId: string;
  avatarId: string;
}) {
  const stock = getStockAvatar(input.avatarId);
  if (!stock) throw new AvatarError("Unknown avatar");
  return upsertAvatar({
    workspaceId: input.workspaceId,
    actorUserId: input.actorUserId,
    name: stock.name,
    look: stock.look,
    voiceId: stock.voiceId,
    source: "stock",
    image: svgDataUrl(stock.svg),
    scenes: sceneFrames(stock.spec, stock.name, stock.id),
  });
}

export async function saveGeneratedAvatar(input: {
  workspaceId: string;
  actorUserId: string;
  description: string;
}) {
  let generated: ReturnType<typeof generateAvatar>;
  try {
    generated = generateAvatar(input.description);
  } catch {
    throw new AvatarError("Describe your avatar");
  }
  return upsertAvatar({
    workspaceId: input.workspaceId,
    actorUserId: input.actorUserId,
    name: generated.name,
    look: generated.look,
    voiceId: generated.voiceId,
    source: "generated",
    image: svgDataUrl(generated.svg),
    scenes: sceneFrames(generated.spec, generated.name, generated.seed),
  });
}

async function upsertAvatar(input: {
  workspaceId: string;
  actorUserId: string;
  name: string;
  look: string;
  voiceId: string;
  source: string;
  image: string;
  scenes: AvatarScene[];
}) {
  const db = await getDb();
  const [existing] = await db
    .select()
    .from(avatars)
    .where(
      and(
        eq(avatars.workspaceId, input.workspaceId),
        eq(avatars.source, input.source),
        eq(avatars.name, input.name),
      ),
    )
    .limit(1);

  let avatarId = existing?.id;
  if (avatarId) {
    await db
      .update(avatars)
      .set({
        look: input.look,
        voiceId: input.voiceId,
        scenes: input.scenes,
        image: input.image,
      })
      .where(and(eq(avatars.id, avatarId), eq(avatars.workspaceId, input.workspaceId)));
  } else {
    const [created] = await db
      .insert(avatars)
      .values({
        workspaceId: input.workspaceId,
        name: input.name,
        look: input.look,
        voiceId: input.voiceId,
        scenes: input.scenes,
        source: input.source,
        image: input.image,
        isDefault: false,
      })
      .returning();
    if (!created) throw new AvatarError("Could not save the avatar");
    avatarId = created.id;
  }

  await db.update(avatars).set({ isDefault: false }).where(eq(avatars.workspaceId, input.workspaceId));
  await db
    .update(avatars)
    .set({ isDefault: true })
    .where(and(eq(avatars.id, avatarId), eq(avatars.workspaceId, input.workspaceId)));

  await writeAudit({
    workspaceId: input.workspaceId,
    actor: input.actorUserId,
    action: "avatar.selected",
    data: { avatarId, name: input.name, source: input.source },
  });

  const [saved] = await db.select().from(avatars).where(eq(avatars.id, avatarId)).limit(1);
  if (!saved) throw new AvatarError("Could not save the avatar");
  return saved;
}
