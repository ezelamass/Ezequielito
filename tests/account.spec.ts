import { test, expect, type Locator, type Page } from "@playwright/test";
import {
  emitTauri,
  installTauriMock,
  setTauriError,
  setTauriResponse,
  tauriCalls,
  waitForListener,
  type TauriCall,
} from "./tauriMock";

interface AccountStatus {
  signed_in: boolean;
  email: string | null;
  voice_enabled: boolean | null;
}

const EMAIL = "ana@example.com";
const PASSWORD = "correct horse battery";

const SIGNED_OUT: AccountStatus = {
  signed_in: false,
  email: null,
  voice_enabled: null,
};

const signedIn = (voice_enabled: boolean | null): AccountStatus => ({
  signed_in: true,
  email: EMAIL,
  voice_enabled,
});

const SETTINGS = {
  bindings: {},
  push_to_talk: true,
  audio_feedback: false,
  external_script_path: null,
  app_language: "en",
  vento_cleanup: true,
};

interface OpenOptions {
  account?: AccountStatus;
  responses?: Record<string, unknown>;
  errors?: Record<string, unknown>;
}

/**
 * Opens the main window on the Home screen. These are the answers it needs
 * at start-up to skip onboarding (a model is already downloaded, and Linux
 * has no permission step) and to render the sidebar, the footer and Home.
 */
async function openHome(page: Page, options: OpenOptions = {}) {
  await installTauriMock(page, {
    platform: "linux",
    responses: {
      has_any_models_available: true,
      get_app_settings: SETTINGS,
      get_default_settings: SETTINGS,
      check_custom_sounds: { start: false, stop: false },
      get_available_models: [],
      get_current_model: "",
      get_available_microphones: [],
      get_available_output_devices: [],
      get_history_entries: { entries: [], has_more: false },
      vento_status: options.account ?? SIGNED_OUT,
      ...options.responses,
    },
    errors: options.errors,
  });
  await page.setViewportSize({ width: 1100, height: 760 });
  await page.goto("/");
  await expect(
    page.getByRole("heading", { name: "Ezequielito" }),
  ).toBeVisible();
}

const card = (page: Page): Locator =>
  page.getByRole("region", { name: "Vento account" });

const statusLine = (page: Page): Locator => card(page).getByRole("status");

async function callsTo(page: Page, cmd: string): Promise<TauriCall[]> {
  return (await tauriCalls(page)).filter((call) => call.cmd === cmd);
}

test.describe("Vento account: signed out", () => {
  test("shows what signing in gives you and the sign-in form", async ({
    page,
  }, testInfo) => {
    await openHome(page);

    await expect(card(page)).toContainText("your dictations come out clean");
    await expect(card(page)).toContainText("no API key");

    const email = card(page).getByLabel("Email");
    const password = card(page).getByLabel("Password");
    await expect(email).toBeVisible();
    await expect(password).toHaveAttribute("type", "password");
    await expect(password).toHaveAttribute("autocomplete", "current-password");

    const submit = card(page).getByRole("button", { name: "Sign in" });
    await expect(submit).toBeDisabled();
    await email.fill(EMAIL);
    await password.fill(PASSWORD);
    await expect(submit).toBeEnabled();

    await card(page).screenshot({
      path: testInfo.outputPath("signed-out.png"),
    });
  });

  test("signing in sends the typed email and password and shows the account", async ({
    page,
  }) => {
    await openHome(page, { responses: { vento_sign_in: signedIn(true) } });

    await card(page).getByLabel("Email").fill(`  ${EMAIL} `);
    await card(page).getByLabel("Password").fill(PASSWORD);
    await card(page).getByLabel("Password").press("Enter");

    await expect(card(page)).toContainText(EMAIL);
    await expect(statusLine(page)).toHaveText("Cleanup is active");
    await expect(card(page).getByLabel("Password")).toHaveCount(0);

    const signIns = await callsTo(page, "vento_sign_in");
    expect(signIns).toHaveLength(1);
    expect(signIns[0].args).toEqual({ email: EMAIL, password: PASSWORD });
  });

  test("a wrong password says so and clears the password", async ({ page }) => {
    await openHome(page, { errors: { vento_sign_in: "invalid_credentials" } });

    const email = card(page).getByLabel("Email");
    const password = card(page).getByLabel("Password");
    await email.fill(EMAIL);
    await password.fill("not my password");
    await card(page).getByRole("button", { name: "Sign in" }).click();

    await expect(card(page).getByRole("alert")).toHaveText(
      "Wrong email or password.",
    );
    await expect(password).toHaveValue("");
    await expect(password).toBeEnabled();
    await expect(email).toHaveValue(EMAIL);
  });

  for (const [code, message] of [
    ["network", "No connection. Check your internet and try again."],
    ["server", "Vento had a problem. Try again in a moment."],
  ]) {
    test(`a "${code}" failure shows its own message`, async ({ page }) => {
      await openHome(page, { errors: { vento_sign_in: code } });

      await card(page).getByLabel("Email").fill(EMAIL);
      await card(page).getByLabel("Password").fill(PASSWORD);
      await card(page).getByLabel("Password").press("Enter");

      await expect(card(page).getByRole("alert")).toHaveText(message);
      await expect(card(page).getByLabel("Password")).toHaveValue("");
    });
  }

  test("the next attempt clears the previous error", async ({ page }) => {
    await openHome(page, { errors: { vento_sign_in: "invalid_credentials" } });

    await card(page).getByLabel("Email").fill(EMAIL);
    await card(page).getByLabel("Password").fill("not my password");
    await card(page).getByLabel("Password").press("Enter");
    await expect(card(page).getByRole("alert")).toBeVisible();

    await setTauriResponse(page, "vento_sign_in", signedIn(true));
    await card(page).getByLabel("Password").fill(PASSWORD);
    await card(page).getByLabel("Password").press("Enter");

    await expect(card(page)).toContainText(EMAIL);
    await expect(card(page).getByRole("alert")).toHaveCount(0);
  });
});

test.describe("Vento account: signed in", () => {
  test("Vento Voice enabled: says cleanup is active", async ({
    page,
  }, testInfo) => {
    await openHome(page, { account: signedIn(true) });

    await expect(card(page)).toContainText(EMAIL);
    await expect(statusLine(page)).toHaveText("Cleanup is active");

    await card(page).screenshot({ path: testInfo.outputPath("signed-in.png") });
  });

  test("Vento Voice not enabled: says the account does not have it yet", async ({
    page,
  }) => {
    await openHome(page, { account: signedIn(false) });

    await expect(statusLine(page)).toHaveText(
      "This account doesn't have Vento Voice enabled yet",
    );
  });

  test("Vento Voice unknown: says it is checking and looks again once", async ({
    page,
  }) => {
    await page.clock.install();
    await openHome(page, { account: signedIn(null) });

    await expect(statusLine(page)).toHaveText("Checking your account...");
    const before = (await callsTo(page, "vento_status")).length;

    await page.clock.fastForward(3500);
    await expect
      .poll(async () => (await callsTo(page, "vento_status")).length)
      .toBe(before + 1);

    // Still unknown: it does not keep asking.
    await page.clock.fastForward(30_000);
    await expect(statusLine(page)).toHaveText("Checking your account...");
    expect(await callsTo(page, "vento_status")).toHaveLength(before + 1);
  });

  test("the second look picks up the answer", async ({ page }) => {
    await page.clock.install();
    await openHome(page, { account: signedIn(null) });
    await expect(statusLine(page)).toHaveText("Checking your account...");

    await setTauriResponse(page, "vento_status", signedIn(true));
    await page.clock.fastForward(3500);

    await expect(statusLine(page)).toHaveText("Cleanup is active");
  });

  test("signing out goes back to the form", async ({ page }) => {
    await openHome(page, {
      account: signedIn(true),
      responses: { vento_sign_out: SIGNED_OUT },
    });

    await card(page).getByRole("button", { name: "Sign out" }).click();

    await expect(card(page).getByLabel("Email")).toBeVisible();
    await expect(card(page).getByLabel("Password")).toHaveValue("");
    await expect(card(page)).not.toContainText(EMAIL);
    expect(await callsTo(page, "vento_sign_out")).toHaveLength(1);
  });

  test("the cleanup toggle saves the setting", async ({ page }) => {
    await openHome(page, { account: signedIn(true) });

    const toggle = card(page).getByRole("checkbox");
    await expect(toggle).toBeChecked();
    await card(page)
      .locator("label")
      .filter({ has: page.getByRole("checkbox") })
      .click();

    await expect(toggle).not.toBeChecked();
    await expect(statusLine(page)).toHaveText("Cleanup is off");
    const changes = await callsTo(page, "change_vento_cleanup_setting");
    expect(changes).toHaveLength(1);
    expect(changes[0].args).toEqual({ enabled: false });
  });

  test("the cleanup toggle follows the saved setting", async ({ page }) => {
    await openHome(page, {
      account: signedIn(true),
      responses: { get_app_settings: { ...SETTINGS, vento_cleanup: false } },
    });

    await expect(card(page).getByRole("checkbox")).not.toBeChecked();
    await expect(statusLine(page)).toHaveText("Cleanup is off");
  });

  test("Sync now refreshes the account and confirms it", async ({ page }) => {
    await openHome(page, {
      account: signedIn(false),
      responses: { vento_refresh: signedIn(true) },
    });

    await card(page).getByRole("button", { name: "Sync now" }).click();

    await expect(page.getByText("Everything is in sync")).toBeVisible();
    await expect(statusLine(page)).toHaveText("Cleanup is active");
    expect(await callsTo(page, "vento_refresh")).toHaveLength(1);
  });

  test("Sync now says why it failed", async ({ page }) => {
    await openHome(page, { account: signedIn(true) });
    await setTauriError(page, "vento_refresh", "network");

    await card(page).getByRole("button", { name: "Sync now" }).click();

    await expect(
      page.getByText("No connection. Check your internet and try again."),
    ).toBeVisible();
    await expect(card(page)).toContainText(EMAIL);
  });
});

test.describe("Vento account: around the app", () => {
  test("Account is the first section inside Settings", async ({
    page,
  }, testInfo) => {
    await openHome(page, { account: signedIn(true) });

    await page.getByText("Settings", { exact: true }).click();
    const nav = page.locator("nav").filter({ hasText: "General" });
    await expect(nav.getByRole("button").first()).toHaveText("Account");

    await nav.getByRole("button", { name: "Account" }).click();
    await expect(
      page.getByRole("heading", { name: "Vento account" }),
    ).toBeVisible();
    await expect(page.getByText(EMAIL)).toBeVisible();
    await expect(page.getByRole("status")).toHaveText("Cleanup is active");

    await page.screenshot({ path: testInfo.outputPath("settings.png") });
  });

  test("settings reload once when the account replaces the profile", async ({
    page,
  }) => {
    await openHome(page, { account: signedIn(true) });
    await waitForListener(page, "vento-profile-synced");
    // Start-up is over once the audio devices were asked for.
    await expect
      .poll(
        async () => (await callsTo(page, "get_available_microphones")).length,
      )
      .toBeGreaterThan(0);
    const before = (await callsTo(page, "get_app_settings")).length;

    await emitTauri(page, "vento-profile-synced");

    await expect
      .poll(async () => (await callsTo(page, "get_app_settings")).length)
      .toBe(before + 1);
    await page.waitForTimeout(300);
    expect(await callsTo(page, "get_app_settings")).toHaveLength(before + 1);
  });
});
