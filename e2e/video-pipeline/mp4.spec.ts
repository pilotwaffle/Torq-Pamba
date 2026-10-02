import { expect, planVideo, test } from "../support";

test("a generated video is a real, playable mp4 in mock mode", async ({ page, account, browser }) => {
  expect(account.email).toMatch(/@example\.com$/);
  await planVideo(page);
  await page.getByRole("button", { name: /^Generate \(est\. \$/ }).click();
  await expect(page.getByRole("heading", { name: "Video ready" })).toBeVisible();
  await page.getByRole("link", { name: "Review & approve" }).click();

  const video = page.getByTestId("final-video");
  await expect(video).toBeVisible();
  await expect(page.getByText("Mock provider — placeholder frames")).toBeVisible();
  const src = await video.getAttribute("src");
  expect(src).toMatch(/^\/api\/media\/[0-9a-f-]{36}$/);

  // The browser decodes it: metadata loads, the length matches the 3 × 10 s plan, and playback advances.
  await expect
    .poll(() => video.evaluate((element: HTMLVideoElement) => element.readyState), { timeout: 20_000 })
    .toBeGreaterThanOrEqual(1);
  const duration = await video.evaluate((element: HTMLVideoElement) => element.duration);
  expect(duration).toBeGreaterThan(29);
  expect(duration).toBeLessThan(31);
  expect(await video.evaluate((element: HTMLVideoElement) => [element.videoWidth, element.videoHeight])).toEqual([360, 640]);
  await video.evaluate(async (element: HTMLVideoElement) => {
    element.muted = true;
    await element.play();
  });
  await expect.poll(() => video.evaluate((element: HTMLVideoElement) => element.currentTime), { timeout: 10_000 }).toBeGreaterThan(0.2);
  expect(await video.evaluate((element: HTMLVideoElement) => element.error)).toBeNull();

  // The file itself: an MP4 container served with byte ranges.
  const response = await page.request.get(src!);
  expect(response.status()).toBe(200);
  expect(response.headers()["content-type"]).toBe("video/mp4");
  const body = await response.body();
  expect(body.subarray(4, 8).toString("latin1")).toBe("ftyp");
  const ranged = await page.request.get(src!, { headers: { range: "bytes=0-99" } });
  expect(ranged.status()).toBe(206);
  expect((await ranged.body()).length).toBe(100);
  await expect(page.getByRole("link", { name: "Download MP4" })).toHaveAttribute("href", src!);

  // Media is private to the workspace.
  const stranger = await browser.newContext();
  const anonymous = await stranger.request.get(new URL(src!, page.url()).toString());
  expect(anonymous.status()).toBe(401);
  await stranger.close();
});
