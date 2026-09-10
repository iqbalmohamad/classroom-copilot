import { test, expect, devices, type Browser, type Locator, type Page } from "@playwright/test";

/**
 * Live state before preparation, in a browser, at the sizes people teach on.
 *
 * The desktop audit found the instructor scrolling past forms to reach the
 * poll the class was already answering, the exercise they were already
 * running, and the clock and the pulse — because preparation and invitation
 * content sat above all three. That is a reading-order fault, so it is checked
 * as one: `compareDocumentPosition` on the real console, not a screenshot
 * diff, because a CSS-only reshuffle would look fixed and still read wrong to
 * a screen reader and to the Tab key.
 *
 * The four viewports are the ones the audit reproduced the problem at. They
 * are checked one by one on purpose: a hierarchy that holds at 1920 says
 * nothing about a 1366 laptop, which is where the consequence was worst.
 */
const { defaultBrowserType: _ignored, ...PHONE } = devices["Pixel 7"]!;

const DESKTOP = [
  { width: 1280, height: 720 },
  { width: 1366, height: 768 },
  { width: 1440, height: 900 },
  { width: 1920, height: 1080 },
];

async function openInstructor(browser: Browser, title: string) {
  const context = await browser.newContext({ viewport: DESKTOP[0] });
  const page = await context.newPage();
  await page.goto("/");
  await page.getByLabel(/class name/i).fill(title);
  await page.getByRole("button", { name: /start class/i }).click();
  await page.waitForURL(/\/r\/[A-Z0-9]{6}\/host/);
  return { context, page, code: /\/r\/([A-Z0-9]{6})\/host/.exec(page.url())![1]! };
}

async function openLearner(browser: Browser, code: string, name: string) {
  const context = await browser.newContext({ ...PHONE });
  const page = await context.newPage();
  await page.goto(`/r/${code}`);
  await page.getByLabel(/your name/i).fill(name);
  await page.getByRole("button", { name: /join class/i }).click();
  await expect(page.getByText(name, { exact: true })).toBeVisible();
  return { context, page };
}

const card = (page: Page, title: string) =>
  page.locator("section.card").filter({ has: page.getByText(title, { exact: true }) });

/** Document order — what a screen reader announces and what Tab follows. */
async function readsBefore(page: Page, first: Locator, second: Locator): Promise<boolean> {
  const [a, b] = [await first.elementHandle(), await second.elementHandle()];
  expect(a, "the earlier element is not in the page").not.toBeNull();
  expect(b, "the later element is not in the page").not.toBeNull();
  return page.evaluate(
    ([one, two]) =>
      (one!.compareDocumentPosition(two!) & Node.DOCUMENT_POSITION_FOLLOWING) !== 0,
    [a, b],
  );
}

/** Where it actually landed on the page, so DOM order and paint order agree. */
async function topOf(locator: Locator, what: string): Promise<number> {
  const box = await locator.boundingBox();
  expect(box, `${what} has no box`).not.toBeNull();
  return box!.y;
}

test.describe("the host console reads live-state first", () => {
  test("at every size the desktop audit used, and on a narrow host", async ({ browser }) => {
    test.setTimeout(180_000);

    const instructor = await openInstructor(browser, "Hierarchy check");
    const { code, page } = { ...instructor, page: instructor.page };

    const [ada, grace] = await Promise.all([
      openLearner(browser, code, "Ada"),
      openLearner(browser, code, "Grace"),
    ]);

    // --- a poll the class is answering right now ---------------------------
    await page.getByPlaceholder(/does this make sense/i).fill("Is a Promise eager?");
    await page.getByRole("button", { name: "Yes / No" }).click();
    await page.getByRole("button", { name: "Open poll", exact: true }).click();
    await Promise.all([
      ada.page.getByRole("button", { name: /^Yes/ }).click(),
      grace.page.getByRole("button", { name: /^No/ }).click(),
    ]);
    await expect(page.getByText(/2 answers · 2 here now/)).toBeVisible();

    // --- an exercise that is running, with an answer to review -------------
    const activities = card(page, "Activities");
    await activities
      .getByPlaceholder("Where does the quantity ordered belong?")
      .fill("Where does the quantity ordered belong?");
    await activities.getByRole("button", { name: "Ask now" }).click();

    const adaActivity = card(ada.page, "Activity");
    await adaActivity.getByLabel("Your answer").fill("On the bridge table.");
    await adaActivity.getByRole("button", { name: "Send my answer" }).click();
    await expect(activities.getByRole("button", { name: /Review 1/ })).toBeVisible();

    // The audit's own case: a composer left expanded, and by now empty, after
    // the activity it created is already running.
    await activities.getByRole("button", { name: "More options" }).click();
    await expect(activities.getByLabel("Field 1 label")).toBeVisible();

    // --- a running timer ---------------------------------------------------
    const timer = card(page, "Timer");
    await timer.getByRole("button", { name: "5 min" }).click();
    await expect(timer.getByRole("button", { name: "Pause" })).toBeVisible();

    // --- a pulse the class has answered ------------------------------------
    await ada.page.getByRole("button", { name: "Got it" }).click();
    await grace.page.getByRole("button", { name: "Shaky" }).click();
    const pulse = card(page, "Class pulse");
    await expect(pulse.getByText("2 of 2 responded")).toBeVisible();

    const livePoll = card(page, "Live poll");
    const pollComposer = page.locator("section.card").filter({ has: page.locator("#poll-prompt") });
    const activityRow = activities.locator(".activity-row").first();
    const activityComposer = page.locator("#activity-title");
    const invite = card(page, "Invite learners");

    for (const viewport of [...DESKTOP, { width: 390, height: 844 }]) {
      const at = `${viewport.width}×${viewport.height}`;
      await page.setViewportSize(viewport);
      await expect(livePoll).toBeVisible();
      await expect(invite).toBeVisible();

      // 1. The poll being run comes before the form for the next one.
      expect(await readsBefore(page, livePoll, pollComposer), `live poll reads before the composer at ${at}`).toBe(true);
      expect(await topOf(livePoll, "the live poll"), `the live poll is painted above the composer at ${at}`)
        .toBeLessThan(await topOf(pollComposer, "the poll composer"));
      await expect(livePoll.getByRole("button", { name: "Close poll" })).toBeVisible();

      // 2. The exercise being run — and its way into the answers — comes
      //    before the composer, expanded or not.
      expect(await readsBefore(page, activityRow, activityComposer), `the running activity reads before the composer at ${at}`).toBe(true);
      expect(await topOf(activityRow, "the running activity"), `the running activity is painted above the composer at ${at}`)
        .toBeLessThan(await topOf(activityComposer, "the activity composer"));
      await expect(activityRow.getByRole("button", { name: /Review 1/ })).toBeVisible();

      // 3. The clock and the room's mood come before the joining instructions.
      for (const [live, what] of [[timer, "the timer"], [pulse, "the pulse"]] as const) {
        expect(await readsBefore(page, live, invite), `${what} reads before the invitation at ${at}`).toBe(true);
        expect(await topOf(live, what), `${what} is painted above the invitation at ${at}`)
          .toBeLessThan(await topOf(invite, "the invitation panel"));
      }

      // Invitation and instructor access stay whole and usable.
      await expect(invite.getByText(code, { exact: true })).toBeVisible();
      await expect(invite.getByRole("button", { name: "Copy join link" })).toBeEnabled();
      await expect(invite.getByRole("button", { name: "Show instructor link" })).toBeEnabled();

      // Nothing was pushed off the side by the reordering.
      const overflow = await page.evaluate(
        () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
      );
      expect(overflow, `nothing spills sideways at ${at}`).toBeLessThanOrEqual(1);

      await page.screenshot({
        path: `test-results/host-hierarchy-${viewport.width}x${viewport.height}.png`,
        fullPage: true,
      });
    }

    await Promise.all([ada.context.close(), grace.context.close(), instructor.context.close()]);
  });
});
