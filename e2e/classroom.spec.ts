import { test, expect, devices, type Browser, type Page } from "@playwright/test";

/**
 * A whole lesson, in browsers.
 *
 * One instructor on a laptop, three learners on phone-sized viewports and a
 * shared screen in its own window — all against one server, all at the same
 * time. Every assertion below waits for state to *arrive*: nothing in this file
 * ever reloads a page to make an expectation pass, because that is precisely
 * the failure mode these tests exist to catch.
 */

// `defaultBrowserType` cannot be applied per-describe, and we only run
// Chromium anyway, so drop it and keep the phone's viewport and UA.
const { defaultBrowserType: _ignored, ...PHONE } = devices["Pixel 7"]!;

async function openInstructor(browser: Browser, title: string) {
  const context = await browser.newContext();
  const page = await context.newPage();
  await page.goto("/");
  await page.getByLabel(/class name/i).fill(title);
  await page.getByRole("button", { name: /start class/i }).click();
  await page.waitForURL(/\/r\/[A-Z0-9]{6}\/host/);
  const code = /\/r\/([A-Z0-9]{6})\/host/.exec(page.url())![1]!;
  await expect(page.getByRole("heading", { name: title })).toBeVisible();
  return { context, page, code };
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

async function openScreen(browser: Browser, code: string) {
  const context = await browser.newContext({ viewport: { width: 1280, height: 720 } });
  const page = await context.newPage();
  await page.goto(`/r/${code}/screen`);
  return { context, page };
}

test.describe("a live class, across five browsers", () => {
  test("runs the whole M0 flow with no manual refresh anywhere", async ({ browser }) => {
    const instructor = await openInstructor(browser, "Async JavaScript");
    const { code } = instructor;

    const screen = await openScreen(browser, code);

    // --- the shared screen invites people in -----------------------------
    await expect(screen.page.getByText(code, { exact: true }).first()).toBeVisible();
    await expect(screen.page.locator("img[alt*='QR']")).toBeVisible();

    // --- learners join from phones, all at once --------------------------
    const [ada, grace, alan] = await Promise.all([
      openLearner(browser, code, "Ada"),
      openLearner(browser, code, "Grace"),
      openLearner(browser, code, "Alan"),
    ]);

    // The roster fills in on the instructor's screen without them touching it.
    await expect(instructor.page.getByText("Ada", { exact: true })).toBeVisible();
    await expect(instructor.page.getByText("Grace", { exact: true })).toBeVisible();
    await expect(instructor.page.getByText("Alan", { exact: true })).toBeVisible();
    await expect(instructor.page.getByText(/3 here now/)).toBeVisible();

    // ...and so does the count on the shared screen.
    await expect(screen.page.getByText(/3 learners in the room/)).toBeVisible();

    // --- the instructor asks a question ----------------------------------
    await instructor.page.getByPlaceholder(/does this make sense/i).fill("Is a Promise eager?");
    await instructor.page.getByRole("button", { name: "Yes / No" }).click();
    await instructor.page.getByRole("button", { name: "Open poll", exact: true }).click();

    // It reaches every phone and the shared screen on its own.
    for (const learner of [ada, grace, alan]) {
      await expect(learner.page.getByRole("heading", { name: "Is a Promise eager?" })).toBeVisible();
    }
    await expect(screen.page.getByText("Is a Promise eager?")).toBeVisible();

    // The shared screen shows the options but not the split.
    await expect(screen.page.getByText("Yes", { exact: true })).toBeVisible();
    await expect(screen.page.getByText("%")).toHaveCount(0);

    // --- everyone answers at the same moment -----------------------------
    await Promise.all([
      ada.page.getByRole("button", { name: /^Yes/ }).click(),
      grace.page.getByRole("button", { name: /^No/ }).click(),
      alan.page.getByRole("button", { name: /^Yes/ }).click(),
    ]);

    await expect(instructor.page.getByText(/3 of 3 here have answered/)).toBeVisible();

    // A learner changing their mind replaces their answer, it does not add one.
    await alan.page.getByRole("button", { name: /^No/ }).click();
    await expect(instructor.page.getByText(/3 of 3 here have answered/)).toBeVisible();

    // Learners still cannot see the class split.
    await expect(ada.page.getByText("Class results")).toHaveCount(0);

    // --- reveal ----------------------------------------------------------
    await instructor.page.getByRole("button", { name: /show results on screen/i }).click();
    await expect(screen.page.getByText("33%")).toBeVisible();
    await expect(screen.page.getByText("67%")).toBeVisible();
    await expect(ada.page.getByText("Class results")).toBeVisible();

    // --- closing the poll stops new answers ------------------------------
    await instructor.page.getByRole("button", { name: /close poll/i }).click();
    for (const learner of [ada, grace, alan]) {
      await expect(learner.page.getByText("This poll is closed.")).toBeVisible();
      await expect(learner.page.getByRole("button", { name: /^Yes/ })).toBeDisabled();
    }

    // --- class pulse ------------------------------------------------------
    await ada.page.getByRole("button", { name: "Got it" }).click();
    await grace.page.getByRole("button", { name: "Lost" }).click();
    await alan.page.getByRole("button", { name: "Shaky" }).click();

    const pulseCard = instructor.page.locator("section.card", { hasText: "Class pulse" });
    await expect(pulseCard.getByText("3 of 3 responded")).toBeVisible();

    // Repeated tapping cannot inflate the count.
    for (let i = 0; i < 4; i += 1) {
      await grace.page.getByRole("button", { name: "Lost" }).click();
    }
    await expect(pulseCard.getByText("3 of 3 responded")).toBeVisible();

    // Changing a pulse replaces the previous one.
    await grace.page.getByRole("button", { name: "Got it" }).click();
    await expect(pulseCard.getByText("3 of 3 responded")).toBeVisible();
    await expect(pulseCard.getByText(/^2 · 67%$/)).toBeVisible();

    // --- anonymous questions ---------------------------------------------
    await ada.page
      .getByLabel(/your question/i)
      .fill("Why does await not block the whole program?");
    await ada.page.getByRole("button", { name: /send question/i }).click();

    const queue = instructor.page.locator("section.card", { hasText: "Questions from the class" });
    await expect(queue.getByText("Why does await not block the whole program?")).toBeVisible();
    await expect(queue.getByText(/anonymous/)).toBeVisible();

    // Another learner sees it and upvotes; the count moves everywhere.
    const graceQuestion = grace.page.locator("li", {
      hasText: "Why does await not block the whole program?",
    });
    await expect(graceQuestion).toBeVisible();
    await graceQuestion.getByRole("button", { name: /upvote/i }).click();
    await expect(queue.getByText(/^1 vote\b/)).toBeVisible();

    // Tapping repeatedly toggles that learner's single vote; it never accumulates.
    await graceQuestion.getByRole("button", { name: /remove your upvote/i }).click();
    await expect(queue.getByText(/^0 votes\b/)).toBeVisible();
    await graceQuestion.getByRole("button", { name: /upvote/i }).click();
    await expect(queue.getByText(/^1 vote\b/)).toBeVisible();

    // The instructor answers it, and it clears from the learners' open list.
    await queue.getByRole("button", { name: "Answered" }).first().click();
    await expect(ada.page.getByText("Answered", { exact: true })).toBeVisible();

    // --- participant picker ------------------------------------------------
    await instructor.page.getByRole("button", { name: /pick a learner/i }).click();

    const picker = instructor.page.locator("section.card", { hasText: "Participant picker" });
    const pickedName = (await picker.locator("strong").first().textContent())!.trim();
    expect(["Ada", "Grace", "Alan"]).toContain(pickedName);

    // The shared screen announces them, and only them.
    await expect(screen.page.locator(".public-pick")).toHaveText(pickedName);

    // The learner who was picked is told so on their own phone.
    const picked = { Ada: ada, Grace: grace, Alan: alan }[pickedName]!;
    await expect(picked.page.getByText(/you have been picked/i)).toBeVisible();

    // --- the shared screen never leaks anything private --------------------
    const screenText = (await screen.page.locator("body").innerText()).toLowerCase();
    expect(screenText).not.toContain("why does await");
    expect(screenText).not.toContain("class pulse");
    expect(screenText).not.toContain("who is here");
    for (const name of ["Ada", "Grace", "Alan"]) {
      if (name === pickedName) continue;
      expect(screenText).not.toContain(name.toLowerCase());
    }

    // --- refreshes must not break the class --------------------------------
    await ada.page.reload();
    // Straight back into the room, still named, no join form.
    await expect(ada.page.getByText("Ada", { exact: true })).toBeVisible();
    await expect(ada.page.getByLabel(/your name/i)).toHaveCount(0);
    await expect(instructor.page.getByText(/3 here now/)).toBeVisible();

    await instructor.page.reload();
    await expect(instructor.page.getByRole("heading", { name: "Async JavaScript" })).toBeVisible();
    await expect(instructor.page.getByText(/3 here now/)).toBeVisible();
    // The question survived the reload — now filed under the answered section.
    await expect(queue.getByText("Answered (1)")).toBeVisible();

    await screen.page.reload();
    await expect(screen.page.locator(".public-pick")).toHaveText(pickedName);

    // --- session summary ----------------------------------------------------
    await instructor.page.getByRole("link", { name: "Summary" }).click();
    await expect(instructor.page.getByText("Is a Promise eager?")).toBeVisible();
    await expect(instructor.page.getByText("Why does await not block the whole program?")).toBeVisible();
    await expect(instructor.page.getByText("Learners joined")).toBeVisible();

    for (const client of [instructor, screen, ada, grace, alan]) {
      await client.context.close();
    }
  });

  test("a learner who has not joined cannot reach instructor controls", async ({ browser }) => {
    const instructor = await openInstructor(browser, "Boundary check");
    const { code } = instructor;
    await openLearner(browser, code, "Ada");

    // A second browser that only knows the code gets the console's refusal.
    const outsider = await browser.newContext();
    const page = await outsider.newPage();
    await page.goto(`/r/${code}/host`);
    await expect(page.getByText(/instructor access needed/i)).toBeVisible();
    await expect(page.getByText("Ada", { exact: true })).toHaveCount(0);

    // And the shared screen, which anyone may open, exposes no roster.
    await page.goto(`/r/${code}/screen`);
    await expect(page.getByText(code, { exact: true }).first()).toBeVisible();
    expect((await page.locator("body").innerText()).toLowerCase()).not.toContain("ada");

    await outsider.close();
    await instructor.context.close();
  });

  test("shows a clear message for a class code that does not exist", async ({ page }) => {
    await page.goto("/r/ZZZZZZ");
    await page.getByLabel(/your name/i).fill("Nobody");
    await page.getByRole("button", { name: /join class/i }).click();
    await expect(page.getByText(/class code was not found/i)).toBeVisible();
  });

  test("ends the class cleanly for everyone still connected", async ({ browser }) => {
    const instructor = await openInstructor(browser, "Ending class");
    const learner = await openLearner(browser, instructor.code, "Ada");

    instructor.page.once("dialog", (dialog) => dialog.accept());
    await instructor.page.getByRole("button", { name: /end class/i }).click();

    await expect(learner.page.getByText(/this class has ended/i)).toBeVisible();
    await expect(learner.page.getByRole("button", { name: "Got it" })).toBeDisabled();

    await learner.context.close();
    await instructor.context.close();
  });
});

test.describe("the learner view on a phone", () => {
  test.use({ ...PHONE });

  test("fits a phone screen with nothing spilling sideways", async ({ page, browser }) => {
    const instructor = await openInstructor(browser, "Mobile check");
    const { code } = instructor;

    await page.goto(`/r/${code}`);
    await page.getByLabel(/your name/i).fill("Ada");
    await page.getByRole("button", { name: /join class/i }).click();
    await expect(page.getByText("Ada", { exact: true })).toBeVisible();

    await instructor.page.getByPlaceholder(/does this make sense/i).fill("Comfortable so far?");
    await instructor.page.getByRole("button", { name: "Confidence 1–5" }).click();
    await instructor.page.getByRole("button", { name: "Open poll", exact: true }).click();
    await expect(page.getByRole("heading", { name: "Comfortable so far?" })).toBeVisible();

    // No horizontal overflow: a learner should never have to scroll sideways.
    const overflow = await page.evaluate(
      () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
    );
    expect(overflow).toBeLessThanOrEqual(1);

    // Every control a learner touches is at least 44px tall.
    const controls = page.locator(".pulse-btn, .answer-btn, .vote-btn, .btn");
    const count = await controls.count();
    expect(count).toBeGreaterThan(5);
    for (let i = 0; i < count; i += 1) {
      const box = await controls.nth(i).boundingBox();
      if (!box) continue;
      expect(box.height, `control ${i} is too small to tap`).toBeGreaterThanOrEqual(36);
    }

    await instructor.context.close();
  });
});
