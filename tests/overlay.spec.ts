import { test, expect, type Page } from "@playwright/test";
import {
  emitTauri,
  installTauriMock,
  tauriCalls,
  waitForListener,
} from "./tauriMock";

const SETTINGS = {
  bindings: {
    transcribe: { id: "transcribe", current_binding: "ctrl+space" },
  },
  overlay_position: "bottom",
  app_language: "en",
};

async function openOverlay(page: Page, size = { width: 280, height: 64 }) {
  await installTauriMock(page, {
    responses: { get_app_settings: SETTINGS },
  });
  await page.setViewportSize(size);
  await page.goto("/src/overlay/index.html");
  // The real window is transparent over the desktop; give screenshots a
  // backdrop so the pill's own colors are what shows.
  await page.addStyleTag({ content: "html { background: #3b4252; }" });
  await waitForListener(page, "hands-free-locked");
}

/** Waits for finite animations and transitions to end, then saves a screenshot. */
async function capture(page: Page, path: string) {
  await page.evaluate(() =>
    Promise.all(
      document
        .getAnimations()
        .filter((a) => a.effect?.getComputedTiming().iterations !== Infinity)
        .map((a) => a.finished.catch(() => {})),
    ),
  );
  await page.screenshot({ path });
}

async function commandNames(page: Page): Promise<string[]> {
  return (await tauriCalls(page)).map((call) => call.cmd);
}

test.describe("overlay pill", () => {
  test("asks the backend for its resting state once it is listening", async ({
    page,
  }) => {
    await openOverlay(page);
    await expect.poll(() => commandNames(page)).toContain("overlay_ready");
  });

  test("idle: shows the hotkey on hover and starts dictation on click", async ({
    page,
  }, testInfo) => {
    await openOverlay(page, { width: 140, height: 34 });
    await emitTauri(page, "show-overlay", "idle");

    const pill = page.locator(".ez-idle__pill");
    await expect(pill).toBeVisible();
    await expect(page.locator(".ez-idle__label")).toHaveText("Ctrl + Space");
    await capture(page, testInfo.outputPath("idle.png"));

    await pill.hover();
    await expect(pill).toHaveCSS("width", "132px");
    await capture(page, testInfo.outputPath("idle-hover.png"));

    await pill.click();
    await expect
      .poll(() => commandNames(page))
      .toContain("start_dictation_from_overlay");
  });

  test("recording: ✕ cancels and there is no ✓ until locked", async ({
    page,
  }, testInfo) => {
    await openOverlay(page);
    await emitTauri(page, "show-overlay", "recording");
    await emitTauri(page, "mic-level", Array(16).fill(0.6));

    await expect(page.locator(".ez-pill__waveform")).toBeVisible();
    await expect(page.locator(".ez-pill__btn--confirm")).toHaveCount(0);
    await capture(page, testInfo.outputPath("recording.png"));

    await page.locator(".ez-pill__btn--cancel").click();
    await expect.poll(() => commandNames(page)).toContain("cancel_operation");
  });

  test("hands-free: ✓ finishes the dictation instead of cancelling it", async ({
    page,
  }, testInfo) => {
    await openOverlay(page);
    await emitTauri(page, "show-overlay", "recording");
    await emitTauri(page, "hands-free-locked", true);

    const confirm = page.locator(".ez-pill__btn--confirm");
    await expect(confirm).toBeVisible();
    await expect(page.locator(".ez-pill__lock-badge")).toBeVisible();
    await capture(page, testInfo.outputPath("locked.png"));

    await confirm.click();
    await expect.poll(() => commandNames(page)).toContain("confirm_recording");
    expect(await commandNames(page)).not.toContain("cancel_operation");
  });

  test("processing: shows the spinner without buttons", async ({
    page,
  }, testInfo) => {
    await openOverlay(page);
    await emitTauri(page, "show-overlay", "transcribing");

    await expect(page.locator(".ez-pill__spinner")).toBeVisible();
    await expect(page.locator(".ez-pill__btn")).toHaveCount(0);
    await capture(page, testInfo.outputPath("transcribing.png"));
  });

  test("error: shows the message for the code it was given", async ({
    page,
  }, testInfo) => {
    await openOverlay(page);
    await emitTauri(page, "overlay-error", "no_speech");
    await emitTauri(page, "show-overlay", "error");

    const message = page.locator(".ez-pill__error");
    await expect(message).toBeVisible();
    await expect(message).not.toBeEmpty();
    await expect(message).not.toContainText("overlay.errors");
    await capture(page, testInfo.outputPath("error.png"));
  });

  test("an unknown error code falls back to the generic message", async ({
    page,
  }) => {
    await openOverlay(page);
    await emitTauri(page, "overlay-error", "something_new");
    await emitTauri(page, "show-overlay", "error");

    await expect(page.locator(".ez-pill__error")).not.toContainText(
      "overlay.errors",
    );
  });
});
