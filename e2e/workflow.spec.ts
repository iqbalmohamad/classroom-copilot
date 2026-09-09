import { test, expect, devices, type Browser, type Page } from "@playwright/test";

/**
 * A taught session, in browsers.
 *
 * The Day 30 SQL lesson as it is actually run: named sections, an open-ended
 * exercise answered on phones, a timer the whole room can see, review and
 * feedback, one answer put on the projector, and a pulse asked twice around an
 * explanation. One instructor, three learners on phone-sized viewports, and the
 * shared screen — all live at once, with nothing reloaded to make an
 * expectation pass.
 */
const { defaultBrowserType: _ignored, ...PHONE } = devices["Pixel 7"]!;

async function openInstructor(browser: Browser, title: string) {
  const context = await browser.newContext({ viewport: { width: 1280, height: 1000 } });
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

async function openScreen(browser: Browser, code: string) {
  const context = await browser.newContext({ viewport: { width: 1280, height: 720 } });
  const page = await context.newPage();
  await page.goto(`/r/${code}/screen`);
  return { context, page };
}

const panel = (page: Page, title: string) =>
  page.locator("section.card").filter({ has: page.getByText(title, { exact: true }) });

test.describe("a taught session", () => {
  test("runs sections, an activity, review and a second pulse round", async ({ browser }) => {
    const instructor = await openInstructor(browser, "Day 30 — Introduction to SQL");
    const { code } = instructor;
    const screen = await openScreen(browser, code);

    const [ada, grace, alan] = await Promise.all([
      openLearner(browser, code, "Ada"),
      openLearner(browser, code, "Grace"),
      openLearner(browser, code, "Alan"),
    ]);

    // --- sections, prepared in the middle of class -------------------------
    const sectionBar = instructor.page.locator("section.section-bar");
    await expect(sectionBar.locator(".section-bar-title")).toHaveText("Section 1");

    await sectionBar.getByRole("button", { name: "Plan sections" }).click();
    await sectionBar.getByLabel("New section name").fill("Database Structure");
    await sectionBar.getByRole("button", { name: "Add", exact: true }).click();
    await expect(sectionBar.getByText("2. Database Structure")).toBeVisible();

    await sectionBar.getByRole("button", { name: "Rename" }).first().click();
    await sectionBar.getByLabel("New name for Section 1").fill("Why SQL Exists");
    await sectionBar.getByRole("button", { name: "Save" }).click();
    await expect(sectionBar.getByText("1. Why SQL Exists")).toBeVisible();
    await expect(sectionBar.locator(".section-bar-title")).toHaveText("Why SQL Exists");
    await sectionBar.getByRole("button", { name: "Done" }).click();

    // The learners' phones follow along without anyone reloading.
    await expect(ada.page.getByText(/Why SQL Exists/).first()).toBeVisible();

    // --- the pulse, before the explanation ---------------------------------
    const pulse = panel(instructor.page, "Class pulse");
    for (const learner of [ada, grace, alan]) {
      await learner.page.getByRole("button", { name: "Lost" }).click();
    }
    await expect(pulse.getByText("3 of 3 responded")).toBeVisible();

    // Ask again after re-explaining. The first round must survive.
    await pulse.getByRole("button", { name: "Ask again" }).click();
    await expect(pulse.getByText("0 of 3 responded")).toBeVisible();

    for (const learner of [ada, grace, alan]) {
      // Wait for the phone to know the round has changed before tapping. A tap
      // aimed at the round that has just closed is refused on purpose — it must
      // not be counted against a question the class has not been asked yet — so
      // tapping instantly here would be testing the guard, not the round.
      await expect(learner.page.getByRole("button", { name: "Lost" })).toHaveAttribute(
        "data-active",
        "false",
      );
      await learner.page.getByRole("button", { name: "Got it" }).click();
    }
    await expect(pulse.getByText("3 of 3 responded")).toBeVisible();

    await pulse.getByRole("button", { name: /Earlier rounds/ }).click();
    // The "before" is still readable next to the "after" — the whole point of
    // asking twice, and what the old destructive reset threw away.
    await expect(pulse.getByText(/Round 1/)).toBeVisible();
    await expect(pulse.getByText("3 · 100%").first()).toBeVisible();

    // --- an open-ended activity -------------------------------------------
    const activities = panel(instructor.page, "Activities");
    await activities
      .getByPlaceholder("Where does the quantity ordered belong?")
      .fill("Where does the quantity ordered belong?");
    await activities.getByRole("button", { name: "More options" }).click();
    await activities.getByLabel("Field 1 label").fill("Table");
    await activities.getByLabel("Field 1 type").selectOption("choice");
    await activities
      .getByLabel("Field 1 options")
      .fill("products\norders\norder_items");
    await activities.getByRole("button", { name: "Add a field" }).click();
    await activities.getByLabel("Field 2 label").fill("Why, in one sentence");
    await activities.getByLabel("Field 2 type").selectOption("long_text");
    await activities.getByRole("button", { name: "Ask now" }).click();

    // It reaches every phone and the shared screen on its own.
    for (const learner of [ada, grace, alan]) {
      await expect(
        learner.page.getByRole("heading", { name: "Where does the quantity ordered belong?" }),
      ).toBeVisible();
    }
    await expect(screen.page.getByText("Where does the quantity ordered belong?")).toBeVisible();

    // --- a timer everyone can see -----------------------------------------
    const timer = panel(instructor.page, "Timer");
    await timer.getByLabel("Count down for").selectOption({ label: "Where does the quantity ordered belong?" });
    await timer.getByRole("button", { name: "3 min" }).click();

    await expect(instructor.page.locator(".timer-chip").first()).toBeVisible();
    await expect(ada.page.locator(".timer-chip")).toBeVisible();
    await expect(screen.page.locator(".timer-chip")).toBeVisible();

    await timer.getByRole("button", { name: "Pause" }).click();
    await expect(ada.page.getByText("paused")).toBeVisible();
    await timer.getByRole("button", { name: "Resume" }).click();

    // --- learners answer, in their own words -------------------------------
    const adaActivity = panel(ada.page, "Activity");
    await adaActivity.getByRole("button", { name: "order_items" }).click();
    await adaActivity
      .getByLabel("Why, in one sentence")
      .fill("One product inside one order, so the quantity belongs on the bridge table.");
    await adaActivity.getByRole("button", { name: "Send my answer" }).click();
    await expect(adaActivity.getByText(/Sent/)).toBeVisible();

    const graceActivity = panel(grace.page, "Activity");
    await graceActivity.getByRole("button", { name: "orders" }).click();
    await graceActivity.getByLabel("Why, in one sentence").fill("Because an order has a quantity.");
    await graceActivity.getByRole("button", { name: "Send my answer" }).click();

    await expect(activities.getByText(/2 answers/)).toBeVisible();

    // Editing replaces rather than adding a second submission.
    await graceActivity.getByRole("button", { name: "Change my answer" }).click();
    await graceActivity.getByRole("button", { name: "order_items" }).click();
    await graceActivity.getByRole("button", { name: "Update my answer" }).click();
    await expect(activities.getByText(/2 answers/)).toBeVisible();

    // --- review, feedback and discussion -----------------------------------
    await activities.getByRole("button", { name: /Review 2/ }).click();
    const answers = instructor.page
      .locator("section.card")
      .filter({ hasText: "Answers · Where does the quantity ordered belong?" });

    await expect(answers.getByText("Ada").first()).toBeVisible();
    await expect(answers.getByText("bridge table")).toBeVisible();

    const adaCard = answers.locator(".response-card").filter({ hasText: "Ada" });
    await adaCard.getByLabel("Private feedback for Ada").fill("Exactly right — say bridge table.");
    await adaCard.getByRole("button", { name: "Send" }).click();

    // Only Ada sees it.
    await expect(ada.page.getByText("Exactly right — say bridge table.")).toBeVisible();
    await expect(grace.page.getByText("Exactly right")).toHaveCount(0);

    // Put the answer on the projector, anonymously first.
    await adaCard.getByRole("button", { name: "Show on screen" }).click();
    await expect(screen.page.getByText("One answer from the room")).toBeVisible();
    await expect(screen.page.getByText(/bridge table/)).toBeVisible();
    await expect(screen.page.getByText("Ada", { exact: true })).toHaveCount(0);

    await adaCard.getByRole("button", { name: "Name the author" }).click();
    await expect(screen.page.getByText("Ada's answer")).toBeVisible();

    // Invite the author to explain: their own phone says so.
    await adaCard.getByRole("button", { name: "Invite to explain" }).click();
    await expect(ada.page.getByText(/you have been picked/i)).toBeVisible();

    await adaCard.getByRole("button", { name: "Take off the screen" }).click();
    await expect(screen.page.getByText(/bridge table/)).toHaveCount(0);

    // --- materials and a question in context -------------------------------
    const materials = panel(instructor.page, "Materials");
    await materials.getByRole("button", { name: "Add a link" }).click();
    await materials.getByLabel("Material title").fill("PostgreSQL download");
    await materials.getByLabel("Material link").fill("https://www.postgresql.org/download/");
    await materials.getByRole("button", { name: "Add link" }).click();
    await expect(alan.page.getByRole("link", { name: /PostgreSQL download/ })).toBeVisible();

    const alanQuestions = panel(alan.page, "Ask a question");
    await alanQuestions.getByLabel(/your question/i).fill("Does SERIAL imply NOT NULL?");
    await alanQuestions.getByRole("button", { name: /About Where does the quantity/ }).click();
    await alanQuestions.getByRole("button", { name: /send question/i }).click();

    const queue = panel(instructor.page, "Questions from the class");
    await expect(queue.getByText("Does SERIAL imply NOT NULL?")).toBeVisible();
    await expect(queue.getByText(/Where does the quantity ordered belong\?$/)).toBeVisible();

    // --- close the activity, then check a refresh loses nothing ------------
    await activities.getByRole("button", { name: "Close answers" }).click();

    // Ada answered, so her own work stays on her phone with the feedback on it;
    // what goes away is the ability to change it.
    await expect(adaActivity.getByText("Closed")).toBeVisible();
    await expect(adaActivity.getByRole("button", { name: "Change my answer" })).toHaveCount(0);
    await expect(adaActivity.getByText(/bridge table/).first()).toBeVisible();

    // Alan never answered, so the closed exercise simply leaves his screen.
    await expect(
      alan.page.getByRole("heading", { name: "Where does the quantity ordered belong?" }),
    ).toHaveCount(0);

    await ada.page.reload();
    await expect(ada.page.getByText(/Why SQL Exists|Database Structure/).first()).toBeVisible();
    await expect(ada.page.getByText("Exactly right — say bridge table.")).toBeVisible();

    await screen.page.reload();
    await expect(screen.page.getByText(/Day 30/)).toBeVisible();

    // --- the summary ties it together --------------------------------------
    await instructor.page.getByRole("link", { name: "Summary" }).click();
    await expect(instructor.page.getByText("Class pulse by section and round")).toBeVisible();
    await expect(instructor.page.getByText("Activities and answers")).toBeVisible();
    await expect(instructor.page.getByText(/bridge table/).first()).toBeVisible();
    await expect(instructor.page.getByText("Exactly right — say bridge table.")).toBeVisible();
    await expect(instructor.page.getByRole("link", { name: "Download CSV" })).toBeVisible();

    for (const context of [instructor.context, screen.context, ada.context, grace.context, alan.context]) {
      await context.close();
    }
  });

  test("a learner's phone shows an activity without spilling sideways", async ({ browser }) => {
    const instructor = await openInstructor(browser, "Mobile activity");
    const { code } = instructor;
    const learner = await openLearner(browser, code, "Ada");

    const activities = panel(instructor.page, "Activities");
    await activities
      .getByPlaceholder("Where does the quantity ordered belong?")
      .fill("Paste the first line of SELECT version();");
    await activities.getByRole("button", { name: "More options" }).click();
    await activities.getByLabel("Field 1 label").fill("The result");
    await activities.getByLabel("Field 1 type").selectOption("sql");
    await activities.getByRole("button", { name: "Ask now" }).click();

    await expect(
      learner.page.getByRole("heading", { name: "Paste the first line of SELECT version();" }),
    ).toBeVisible();
    await learner.page
      .getByLabel("The result")
      .fill("PostgreSQL 17.0 on x86_64-pc-linux-gnu, compiled by gcc, 64-bit");
    await learner.page.getByRole("button", { name: "Send my answer" }).click();
    await expect(learner.page.getByText(/Sent/)).toBeVisible();

    const overflow = await learner.page.evaluate(
      () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
    );
    expect(overflow).toBeLessThanOrEqual(1);

    await instructor.context.close();
    await learner.context.close();
  });
});

/**
 * Saved plans, when there is more than one of them.
 *
 * The first version of this panel kept a single list of exercises and rendered
 * it under every saved plan, while the import beside it used the enclosing
 * row's credentials — so "Add here" under one plan could create an exercise
 * from another. Two plans with different exercises is the smallest case that
 * catches it.
 */
test.describe("saved plans", () => {
  test("imports the exercise that was chosen, from the plan it belongs to", async ({ browser }) => {
    // One browser: host cookies are per-room and the plan list is per-origin,
    // so all three classes and both plans live together the way they would for
    // a real instructor.
    const context = await browser.newContext({ viewport: { width: 1280, height: 1000 } });
    const page = await context.newPage();

    const startClass = async (title: string) => {
      await page.goto("/");
      await page.getByLabel(/class name/i).fill(title);
      await page.getByRole("button", { name: /start class/i }).click();
      await page.waitForURL(/\/r\/[A-Z0-9]{6}\/host/);
    };

    const savePlanWithExercise = async (title: string, exercise: string) => {
      await startClass(title);
      const activities = panel(page, "Activities");
      await activities
        .getByPlaceholder("Where does the quantity ordered belong?")
        .fill(exercise);
      await activities.getByRole("button", { name: "Save for later" }).click();
      await expect(activities.getByText(exercise)).toBeVisible();

      const plans = panel(page, "Prepare & reuse");
      await plans.getByRole("button", { name: "Open" }).click();
      await plans.getByRole("button", { name: "Save this session as a plan" }).click();
      await expect(plans.getByText(/Saved as/)).toBeVisible();
    };

    await savePlanWithExercise("Plan source A", "Exercise A");
    await savePlanWithExercise("Plan source B", "Exercise B");

    // A third class, importing from each plan in turn.
    await startClass("Day 31");
    const list = panel(page, "Prepare & reuse");
    await list.getByRole("button", { name: "Open" }).click();

    const rowA = list.locator("li").filter({ hasText: "Plan source A" }).first();
    const rowB = list.locator("li").filter({ hasText: "Plan source B" }).first();

    // Browse both. Each row shows only its own exercises.
    await rowA.getByRole("button", { name: "Reuse an exercise" }).click();
    await expect(rowA.getByText("Exercise A")).toBeVisible();
    await rowB.getByRole("button", { name: "Reuse an exercise" }).click();
    await expect(rowB.getByText("Exercise B")).toBeVisible();
    await expect(rowB.getByText("Exercise A")).toHaveCount(0);
    await expect(rowA.getByText("Exercise B")).toHaveCount(0);

    // Import from the second row: the exercise created must be B's.
    await rowB.getByRole("button", { name: "Add here" }).click();
    const targetActivities = panel(page, "Activities");
    await expect(targetActivities.getByText("Exercise B")).toBeVisible();
    await expect(targetActivities.getByText("Exercise A")).toHaveCount(0);

    // ...and then from the first, which must not have been disturbed.
    await rowA.getByRole("button", { name: "Add here" }).click();
    await expect(targetActivities.getByText("Exercise A")).toBeVisible();
    await expect(targetActivities.getByText("Exercise B")).toBeVisible();

    await context.close();
  });
});

/**
 * Preparation the instructor does with a mouse: putting exercises in order,
 * changing one after writing it, and getting back into last week's class.
 */
test.describe("preparation and continuity", () => {
  test("reorders and edits activities, and reopens an earlier class", async ({ browser }) => {
    const context = await browser.newContext({ viewport: { width: 1280, height: 1000 } });
    const page = await context.newPage();

    const startClass = async (title: string) => {
      await page.goto("/");
      await page.getByLabel(/class name/i).fill(title);
      await page.getByRole("button", { name: /start class/i }).click();
      await page.waitForURL(/\/r\/[A-Z0-9]{6}\/host/);
      return /\/r\/([A-Z0-9]{6})\/host/.exec(page.url())![1]!;
    };

    // --- Day 30: an answer worth coming back to, and a kept class ----------
    const dayThirty = await startClass("Day 30 — Introduction to SQL");
    const activities = panel(page, "Activities");
    await activities
      .getByPlaceholder("Where does the quantity ordered belong?")
      .fill("Write one business question");
    await activities.getByRole("button", { name: "Ask now" }).click();

    const learnerContext = await browser.newContext({ ...PHONE });
    const learner = await learnerContext.newPage();
    await learner.goto(`/r/${dayThirty}`);
    await learner.getByLabel(/your name/i).fill("Ada");
    await learner.getByRole("button", { name: /join class/i }).click();
    await learner.getByLabel("Your answer").fill("Which city buys the most?");
    await learner.getByRole("button", { name: "Send my answer" }).click();
    await expect(activities.getByText(/1 answer/)).toBeVisible();

    const invite = panel(page, "Invite learners");
    await invite.getByRole("checkbox", { name: /Keep this class on this device/ }).check();

    // --- Day 31: prepare three exercises, order and edit them --------------
    await startClass("Day 31 — Basic and Intermediate SQL");
    const prep = panel(page, "Activities");
    for (const title of ["First", "Second", "Third"]) {
      await prep.getByPlaceholder("Where does the quantity ordered belong?").fill(title);
      await prep.getByRole("button", { name: "Save for later" }).click();
      await expect(prep.getByText(title, { exact: true })).toBeVisible();
    }

    const titlesInOrder = async () =>
      (await prep.locator(".activity-row strong").allInnerTexts()).map((t) => t.trim());
    expect(await titlesInOrder()).toEqual(["First", "Second", "Third"]);

    await prep.getByRole("button", { name: "Move Third earlier" }).click();
    await expect
      .poll(titlesInOrder)
      .toEqual(["First", "Third", "Second"]);
    await prep.getByRole("button", { name: "Move First later" }).click();
    await expect.poll(titlesInOrder).toEqual(["Third", "First", "Second"]);

    // Edit the middle one, changing every preparation field it offers.
    const middle = prep.locator(".activity-row").filter({ hasText: "First" }).first();
    await middle.getByRole("button", { name: "Edit" }).click();
    await middle.getByLabel("Prompt").fill("Submit a row count and the largest order total");
    await middle.getByLabel("Extra instructions").fill("Two numbers, from your own query.");
    await middle.getByLabel("Edit field 1 label").fill("Row count");
    await middle.getByLabel("Edit field 1 type").selectOption("number");
    await middle.getByRole("button", { name: "Add a field" }).click();
    await middle.getByLabel("Edit field 2 label").fill("Largest order total");
    await middle.getByLabel("Edit field 2 type").selectOption("number");
    await middle.getByLabel("Your own answer (private)").fill("Depends on the seed data.");
    await middle.getByLabel("Suggested minutes").fill("5");
    await middle.getByRole("button", { name: "Save changes" }).click();

    await expect(
      prep.getByText("Submit a row count and the largest order total"),
    ).toBeVisible();
    // The edit did not disturb the order.
    await expect.poll(titlesInOrder).toEqual([
      "Third",
      "Submit a row count and the largest order total",
      "Second",
    ]);

    // --- back to Day 30's answers, from inside Day 31 ---------------------
    const reuse = panel(page, "Prepare & reuse");
    await reuse.getByRole("button", { name: "Open" }).click();
    const earlier = reuse.locator("li").filter({ hasText: "Day 30" }).first();
    await earlier.getByRole("link", { name: "Open the answers" }).click();

    await page.waitForURL(/\/r\/[A-Z0-9]{6}\/summary/);
    await expect(page.getByText("Which city buys the most?")).toBeVisible();
    await expect(page.getByText("Ada")).toBeVisible();

    await learnerContext.close();
    await context.close();
  });
});
