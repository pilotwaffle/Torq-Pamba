import { and, eq } from "drizzle-orm";
import { z } from "zod";
import { getDb } from "@/db";
import { avatars } from "@/db/schema";
import { writeAudit } from "@/lib/audit";
import { STOCK_AVATARS } from "@/lib/avatars/catalog";
import { listWorkspaceAvatars, saveStockAvatar } from "@/lib/avatars/store";
import { defineTool } from "./types";

export const pickAvatarTool = defineTool({
  name: "pick-avatar",
  description:
    "Choose the avatar (on-screen creator) new scripts and plans use. Pass a name from the workspace's avatars or from the stock catalog; a stock pick is added to the workspace. Without a name it lists both, with the current default marked. Existing plans keep their avatar; use revise-script with avatarName to change one.",
  parameters: z.object({ name: z.string().trim().min(1).max(80).optional() }),
  priority: 40,
  match(text) {
    if (/^(?:list|show)(?: me)?\s+(?:my |our |the )?avatars$/i.test(text)) return {};
    const found =
      text.match(/^(?:use|pick|choose)\s+(?:the\s+)?avatar\s+(.+)$/i) ??
      text.match(/^(?:use|pick|choose)\s+(.+?)\s+as\s+(?:the|my|our)\s+avatar$/i);
    return found?.[1] ? { name: found[1].trim() } : null;
  },
  async run(ctx, args) {
    const owned = await listWorkspaceAvatars(ctx.workspace.id);
    const current = owned.find((avatar) => avatar.isDefault) ?? owned[0];
    if (!args.name) {
      const stock = STOCK_AVATARS.filter((item) => !owned.some((avatar) => avatar.name === item.name));
      const lines = [
        `Your avatars: ${owned.length ? owned.map((avatar) => (avatar.id === current?.id ? `${avatar.name} (default)` : avatar.name)).join(", ") : "none yet"}`,
        `Stock avatars: ${stock.map((item) => item.name).join(", ")}`,
      ];
      await ctx.reply(lines.join("\n"), {
        kind: "avatars",
        avatars: owned.map((avatar) => ({ id: avatar.id, name: avatar.name, look: avatar.look, isDefault: avatar.id === current?.id })),
        stock: stock.map((item) => ({ id: item.id, name: item.name, look: item.look })),
      });
      return;
    }

    const wanted = args.name.toLowerCase();
    const mine = owned.find((avatar) => avatar.name.toLowerCase() === wanted);
    let chosen: { id: string; name: string };
    if (mine) {
      const db = await getDb();
      await db.update(avatars).set({ isDefault: false }).where(eq(avatars.workspaceId, ctx.workspace.id));
      await db
        .update(avatars)
        .set({ isDefault: true })
        .where(and(eq(avatars.id, mine.id), eq(avatars.workspaceId, ctx.workspace.id)));
      await writeAudit({
        workspaceId: ctx.workspace.id,
        actor: ctx.userId,
        action: "avatar.selected",
        data: { avatarId: mine.id, name: mine.name, source: mine.source, via: "chat" },
      });
      chosen = mine;
    } else {
      const stock = STOCK_AVATARS.find((item) => item.name.toLowerCase() === wanted);
      if (!stock) {
        throw new Error(
          `No avatar named ${args.name}. Pick one of: ${[...owned.map((avatar) => avatar.name), ...STOCK_AVATARS.map((item) => item.name)].join(", ")}.`,
        );
      }
      chosen = await saveStockAvatar({ workspaceId: ctx.workspace.id, actorUserId: ctx.userId, avatarId: stock.id });
    }
    await ctx.reply(`${chosen.name} is now the default avatar for new plans.`, {
      kind: "avatar",
      avatarId: chosen.id,
      name: chosen.name,
    });
  },
});
