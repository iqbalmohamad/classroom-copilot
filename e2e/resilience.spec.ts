import { test, expect, devices, type Browser } from "@playwright/test";

/**
 * What happens when the network misbehaves.
 *
 * A real class runs on a venue network nobody controls. These tests break the
 * connection in the two ways that actually happen — the event stream never
 * establishing, and the device dropping offline mid-lesson — and assert that
 * the classroom keeps working and recovers on its own.
 */

const { defaultBrowserType: _ignored, ...PHONE } = devices["Pixel 7"]!;

async function startClass(browser: Browser, title = "Resilience") {
  const context = await browser.newContext();
  const page = await context.newPage();
  await page.goto("/");
  await page.getByLabel(/class name/i).fill(title);
  await page.getByRole("button", { name: /start class/i }).click();
  await page.waitForURL(/\/r\/[A-Z0-9]{6}\/host/);
  return { context, page, code: /\/r\/([A-Z0-9]{6})\/host/.exec(page.url())![1]! };
}

test("keeps the class running when the event stream is blocked entirely", async ({ browser }) => {
  const instructor = await startClass(browser, "Blocked stream");
  const { code } = instructor;

  // A proxy that swallows server-sent events is a real thing on venue and
  // corporate networks. The learner must fall back to polling, not break.
  const context = await browser.newContext({ ...PHONE });
  await context.route("**/api/rooms/*/stream*", (route) => route.abort());
  const learner = await context.newPage();

  await learner.goto(`/r/${code}`);
  await learner.getByLabel(/your name/i).fill("Ada");
  await learner.getByRole("button", { name: /join class/i }).click();
  await expect(learner.getByText("Ada", { exact: true })).toBeVisible();

  // The badge tells the truth about which transport is in use.
  await expect(learner.getByText("Syncing")).toBeVisible();

  // The instructor still sees them arrive...
  await expect(instructor.page.getByText("Ada", { exact: true })).toBeVisible();

  // ...and a poll opened by the instructor still reaches the phone, unaided.
  await instructor.page.getByPlaceholder(/does this make sense/i).fill("Still working?");
  await instructor.page.getByRole("button", { name: "Open poll", exact: true }).click();
  await expect(learner.getByRole("heading", { name: "Still working?" })).toBeVisible();

  // And their answer still lands.
  await learner.getByRole("button", { name: /^Yes/ }).click();
  await expect(instructor.page.getByText(/1 answer · 1 here now/)).toBeVisible();

  await context.close();
  await instructor.context.close();
});

test("recovers on its own after the learner's device drops offline", async ({ browser }) => {
  const instructor = await startClass(browser, "Offline recovery");
  const { code } = instructor;

  const context = await browser.newContext({ ...PHONE });
  const learner = await context.newPage();
  await learner.goto(`/r/${code}`);
  await learner.getByLabel(/your name/i).fill("Grace");
  await learner.getByRole("button", { name: /join class/i }).click();
  await expect(learner.getByText("Grace", { exact: true })).toBeVisible();

  // The phone loses signal.
  await context.setOffline(true);

  // The instructor asks something while the learner is unreachable.
  await instructor.page.getByPlaceholder(/does this make sense/i).fill("Did you miss this?");
  await instructor.page.getByRole("button", { name: "Open poll", exact: true }).click();

  // Signal comes back. Nobody touches the phone.
  await context.setOffline(false);

  // The question the learner missed arrives without a reload.
  await expect(learner.getByRole("heading", { name: "Did you miss this?" })).toBeVisible({
    timeout: 30_000,
  });
  await expect(learner.getByText(/^(Live|Syncing)$/)).toBeVisible();

  // And they can take part again immediately.
  await learner.getByRole("button", { name: /^No/ }).click();
  await expect(instructor.page.getByText(/1 answer · 1 here now/)).toBeVisible();

  await context.close();
  await instructor.context.close();
});

test("a learner returning from a backgrounded tab is not left looking at stale state", async ({
  browser,
}) => {
  const instructor = await startClass(browser, "Backgrounded");
  const { code } = instructor;

  const context = await browser.newContext({ ...PHONE });
  const learner = await context.newPage();
  await learner.goto(`/r/${code}`);
  await learner.getByLabel(/your name/i).fill("Alan");
  await learner.getByRole("button", { name: /join class/i }).click();
  await expect(learner.getByText("Alan", { exact: true })).toBeVisible();

  // Simulate the tab being hidden, the way a phone screen locking does.
  await learner.evaluate(() => {
    Object.defineProperty(document, "visibilityState", {
      configurable: true,
      get: () => "hidden",
    });
    document.dispatchEvent(new Event("visibilitychange"));
  });

  await instructor.page.getByPlaceholder(/does this make sense/i).fill("Question while hidden");
  await instructor.page.getByRole("button", { name: "Open poll", exact: true }).click();
  await instructor.page.waitForTimeout(500);

  // The tab comes back to the foreground: the app must re-sync at once.
  await learner.evaluate(() => {
    Object.defineProperty(document, "visibilityState", {
      configurable: true,
      get: () => "visible",
    });
    document.dispatchEvent(new Event("visibilitychange"));
  });

  await expect(learner.getByRole("heading", { name: "Question while hidden" })).toBeVisible();

  await context.close();
  await instructor.context.close();
});

test("the shared screen reconnects by itself after losing the network", async ({ browser }) => {
  const instructor = await startClass(browser, "Screen recovery");
  const { code } = instructor;

  const context = await browser.newContext({ viewport: { width: 1280, height: 720 } });
  const screen = await context.newPage();
  await screen.goto(`/r/${code}/screen`);
  await expect(screen.getByText(code, { exact: true }).first()).toBeVisible();

  await context.setOffline(true);
  await instructor.page.getByPlaceholder(/does this make sense/i).fill("Back on screen?");
  await instructor.page.getByRole("button", { name: "Open poll", exact: true }).click();
  await context.setOffline(false);

  await expect(screen.getByText("Back on screen?")).toBeVisible({ timeout: 30_000 });

  await context.close();
  await instructor.context.close();
});
