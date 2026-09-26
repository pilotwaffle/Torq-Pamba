import { describe, expect, it } from "vitest";
import { signupAccount } from "@/lib/auth/account";
import { canUseAssetInVideo } from "@/lib/onboarding/rights";
import { zeroToFirstPost } from "@/lib/checklist";
import { shortlist, STOCK_AVATARS } from "./catalog";
import { generateAvatar } from "./generate";
import { listWorkspaceAvatars, saveStockAvatar } from "./store";

function uniqueEmail(label: string) {
  return `${label}-${Date.now()}-${Math.random().toString(16).slice(2)}@example.com`;
}

describe("avatar shortlist", () => {
  it("ranks niche keywords and returns three avatars", () => {
    const coffee = shortlist("specialty coffee cafe");
    expect(coffee).toHaveLength(3);
    expect(coffee[0]?.name).toBe("Mina Cole");

    const yoga = shortlist("yoga wellness studio");
    expect(yoga[0]?.name).toBe("Asha Raman");

    const unmatched = shortlist("zzzz-unmatched");
    expect(unmatched.map((avatar) => avatar.id)).toEqual(STOCK_AVATARS.slice(0, 3).map((avatar) => avatar.id));
  });
});

describe("generateAvatar", () => {
  it("is deterministic and priced at the grok-imagine-image rate", () => {
    const first = generateAvatar("A calm barista with a bun and an olive shirt");
    const second = generateAvatar("A calm barista with a bun and an olive shirt");
    const other = generateAvatar("A rainy-street reporter in a cobalt coat");
    expect(first.svg).toBe(second.svg);
    expect(first.svg).not.toBe(other.svg);
    expect(first.costUsd).toBe(0.02);
    expect(first.svg.startsWith("<svg")).toBe(true);
    expect(first.name).toBe(second.name);
  });
});

describe("workspace avatars", () => {
  it("saves an exclusive default avatar with three scene frames", async () => {
    const owner = await signupAccount({
      email: uniqueEmail("avatar-owner"),
      password: "correct-horse-battery",
      workspaceName: "Avatar Co",
    });
    const other = await signupAccount({
      email: uniqueEmail("avatar-other"),
      password: "correct-horse-battery",
      workspaceName: "Other Co",
    });

    const mina = await saveStockAvatar({
      workspaceId: owner.workspace.id,
      actorUserId: owner.user.id,
      avatarId: "mina-cole",
    });
    expect(mina.isDefault).toBe(true);
    expect(mina.workspaceId).toBe(owner.workspace.id);
    expect(mina.scenes?.map((scene) => scene.name)).toEqual(["kitchen", "street", "desk"]);
    expect(mina.scenes?.every((scene) => scene.startFrame?.startsWith("data:image/svg+xml"))).toBe(true);

    const asha = await saveStockAvatar({
      workspaceId: owner.workspace.id,
      actorUserId: owner.user.id,
      avatarId: "asha-raman",
    });
    expect(asha.isDefault).toBe(true);
    const saved = await listWorkspaceAvatars(owner.workspace.id);
    expect(saved).toHaveLength(2);
    expect(saved.filter((avatar) => avatar.isDefault)).toHaveLength(1);
    expect(saved.find((avatar) => avatar.isDefault)?.name).toBe("Asha Raman");
    expect(await listWorkspaceAvatars(other.workspace.id)).toHaveLength(0);
  });
});

describe("rights and checklist", () => {
  it("refuses unconfirmed assets and tracks the path to a first post", () => {
    expect(canUseAssetInVideo({ rightsConfirmed: false })).toBe(false);
    expect(canUseAssetInVideo({ rightsConfirmed: true })).toBe(true);
    const items = zeroToFirstPost({
      brief: { companyName: "Northwind Cold Brew", niche: "Cold brew coffee" },
      avatarCount: 1,
      videoCount: 0,
      hasApproval: false,
    });
    expect(items.map((item) => item.label)).toEqual([
      "Brand brief",
      "Avatar",
      "First video",
      "Approve & schedule",
      "Connect accounts — Phase 2",
    ]);
    expect(items.map((item) => item.done)).toEqual([true, true, false, false, false]);
  });
});
