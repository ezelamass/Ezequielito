import { test, expect, type Locator, type Page } from "@playwright/test";
import {
  emitTauri,
  setTauriError,
  setTauriResponse,
  waitForListener,
} from "./tauriMock";
import { SETTINGS, callsTo, openHome } from "./mainWindow";

const UPDATE = {
  version: "9.4.0",
  url: "https://example.com/releases/v9.4.0",
};

interface FooterOptions {
  update?: typeof UPDATE | null;
  errors?: Record<string, unknown>;
  enabled?: boolean;
}

async function openWithChecks(page: Page, options: FooterOptions = {}) {
  await openHome(page, {
    responses: {
      get_app_settings: {
        ...SETTINGS,
        update_checks_enabled: options.enabled ?? true,
      },
      check_for_update: options.update ?? null,
    },
    errors: options.errors,
  });
}

/** The footer row that holds the model selector, the notice and the version. */
const footer = (page: Page): Locator =>
  page.locator("div.border-t").filter({ hasText: "•" }).last();

async function checks(page: Page): Promise<number> {
  return (await callsTo(page, "check_for_update")).length;
}

/** Start-up asked once and the tray's event is being listened for. */
async function startUpCheckDone(page: Page) {
  await waitForListener(page, "check-for-updates");
  await expect.poll(() => checks(page)).toBeGreaterThan(0);
  await expect(footer(page)).not.toContainText("Checking for updates...");
}

test.describe("update notice", () => {
  test("a newer version shows which one and a button to its download page", async ({
    page,
  }, testInfo) => {
    await openWithChecks(page, { update: UPDATE });

    await expect(footer(page)).toContainText("Update available: 9.4.0");
    const download = footer(page).getByRole("button", {
      name: "Download Update",
    });
    await expect(download).toBeVisible();
    await footer(page).screenshot({
      path: testInfo.outputPath("update-available.png"),
    });

    await download.click();

    await expect
      .poll(async () => (await callsTo(page, "plugin:opener|open_url")).length)
      .toBe(1);
    const [opened] = await callsTo(page, "plugin:opener|open_url");
    expect(opened.args.url).toBe(UPDATE.url);
  });

  test("up to date at start-up: says nothing about it", async ({ page }) => {
    await openWithChecks(page, { update: null });
    await startUpCheckDone(page);

    await expect(footer(page)).not.toContainText("Up to date");
    await expect(footer(page)).not.toContainText("Update available");
    await expect(
      footer(page).getByRole("button", { name: "Download Update" }),
    ).toHaveCount(0);
    // Only the resting link to look again.
    await expect(
      footer(page).getByRole("button", { name: "Check for updates" }),
    ).toBeVisible();
  });

  test("up to date when asked from the tray menu: says so, for a moment", async ({
    page,
  }) => {
    await page.clock.install();
    await openWithChecks(page, { update: null });
    await startUpCheckDone(page);
    const before = await checks(page);

    await emitTauri(page, "check-for-updates");

    await expect(footer(page)).toContainText("Up to date");
    expect(await checks(page)).toBe(before + 1);

    await page.clock.fastForward(3500);
    await expect(footer(page)).not.toContainText("Up to date");
    await expect(
      footer(page).getByRole("button", { name: "Check for updates" }),
    ).toBeVisible();
  });

  test("asked from the tray menu and there is one: shows the update", async ({
    page,
  }) => {
    await openWithChecks(page, { update: null });
    await startUpCheckDone(page);

    await setTauriResponse(page, "check_for_update", UPDATE);
    await emitTauri(page, "check-for-updates");

    await expect(footer(page)).toContainText("Update available: 9.4.0");
    await expect(footer(page)).not.toContainText("Up to date");
  });

  test("a check that fails at start-up says nothing", async ({ page }) => {
    await openWithChecks(page, { errors: { check_for_update: "network" } });
    await startUpCheckDone(page);

    await expect(footer(page)).not.toContainText("Couldn't check for updates");
    await expect(
      footer(page).getByRole("button", { name: "Check for updates" }),
    ).toBeVisible();
  });

  test("a check that fails when asked for says it could not be done", async ({
    page,
  }) => {
    await openWithChecks(page, { update: null });
    await startUpCheckDone(page);

    await setTauriError(page, "check_for_update", "network");
    await footer(page)
      .getByRole("button", { name: "Check for updates" })
      .click();

    await expect(footer(page)).toContainText("Couldn't check for updates");
    await expect(footer(page)).not.toContainText("Up to date");
  });

  test("with update checks turned off, nothing is checked", async ({
    page,
  }) => {
    await openWithChecks(page, { update: UPDATE, enabled: false });

    await expect(footer(page)).toContainText("Update Checking Disabled");
    await expect(footer(page)).not.toContainText("Update available");
    await page.waitForTimeout(300);
    expect(await checks(page)).toBe(0);
  });
});
