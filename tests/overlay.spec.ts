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

/** Window sizes, as set in src-tauri/src/overlay.rs. */
const ACTIVE = { width: 232, height: 38 };
const IDLE = { width: 136, height: 28 };

async function openOverlay(page: Page, size = ACTIVE) {
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
    await openOverlay(page, IDLE);
    await emitTauri(page, "show-overlay", "idle");

    const pill = page.locator(".ez-pill--idle");
    await expect(pill).toBeVisible();
    await expect(pill).toHaveCSS("height", "6px");
    await expect(page.locator(".ez-pill__idle-label")).toHaveText(
      "Ctrl + Space",
    );
    await capture(page, testInfo.outputPath("idle.png"));

    await pill.hover();
    await expect(pill).toHaveCSS("height", "20px");
    // A modest growth: wide enough for the hotkey, never the full window.
    const hovered = await pill.boundingBox();
    expect(hovered!.width).toBeGreaterThan(60);
    expect(hovered!.width).toBeLessThanOrEqual(128);
    await capture(page, testInfo.outputPath("idle-hover.png"));

    await pill.click();
    await expect
      .poll(() => commandNames(page))
      .toContain("start_dictation_from_overlay");
  });

  test("the idle bar grows into the recording pill instead of being replaced", async ({
    page,
  }) => {
    await openOverlay(page);
    await emitTauri(page, "show-overlay", "idle");
    const pill = page.locator(".ez-pill");
    await expect(pill).toHaveCSS("width", "40px");
    await pill.evaluate((el) => el.setAttribute("data-same", "yes"));

    await emitTauri(page, "show-overlay", "recording");

    // Still the same element, so its size is animated rather than swapped.
    await expect(pill).toHaveAttribute("data-same", "yes");
    await expect(pill).toHaveClass(/ez-pill--recording/);
    await expect(pill).toHaveCSS("width", "124px");
    await expect(pill).toHaveCSS("height", "26px");
    const transition = await pill.evaluate(
      (el) => getComputedStyle(el).transitionProperty,
    );
    expect(transition).toContain("width");
    expect(transition).toContain("height");

    await emitTauri(page, "show-overlay", "idle");
    await expect(pill).toHaveAttribute("data-same", "yes");
    await expect(pill).toHaveCSS("width", "40px");
  });

  for (const [name, size, state] of [
    ["idle", IDLE, "idle"],
    ["recording", ACTIVE, "recording"],
    ["error", ACTIVE, "error"],
  ] as const) {
    test(`${name}: the border is never cut off by the window`, async ({
      page,
    }) => {
      await openOverlay(page, size);
      await emitTauri(page, "show-overlay", state);
      const pill = page.locator(".ez-pill");
      await expect(pill).toHaveClass(new RegExp(`ez-pill--${state}`));
      await page.evaluate(() =>
        Promise.all(document.getAnimations().map((a) => a.finished)),
      );

      const box = (await pill.boundingBox())!;
      expect(box.x).toBeGreaterThanOrEqual(3);
      expect(box.y).toBeGreaterThanOrEqual(3);
      expect(box.x + box.width).toBeLessThanOrEqual(size.width - 3);
      expect(box.y + box.height).toBeLessThanOrEqual(size.height - 3);
    });
  }

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
    await expect(page.locator(".ez-pill")).toHaveClass(/ez-pill--locked/);
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

  for (const [code, message] of [
    ["word_added", "Added to your dictionary"],
    ["word_known", "Already in your dictionary"],
  ]) {
    test(`"${code}" is a notice, not an error`, async ({ page }, testInfo) => {
      await openOverlay(page);
      await emitTauri(page, "overlay-error", code);
      await emitTauri(page, "show-overlay", "error");

      const pill = page.locator(".ez-pill");
      await expect(page.getByRole("status")).toHaveText(message);
      await expect(page.getByRole("alert")).toHaveCount(0);
      await expect(pill).toHaveClass(/ez-pill--notice/);
      await expect(pill).not.toHaveClass(/ez-pill--error/);
      await capture(page, testInfo.outputPath(`${code}.png`));

      // Lime border (the accent), not the warm one errors get.
      const border = await pill.evaluate((el) => {
        const [r, g, b] = getComputedStyle(el)
          .borderTopColor.match(/[\d.]+/g)!
          .map(Number);
        return { r, g, b };
      });
      expect(border.g).toBeGreaterThan(border.r);
      expect(border.g).toBeGreaterThan(border.b);
    });
  }

  test("an error after a notice looks like an error again", async ({
    page,
  }) => {
    await openOverlay(page);
    await emitTauri(page, "overlay-error", "word_added");
    await emitTauri(page, "show-overlay", "error");
    await expect(page.locator(".ez-pill")).toHaveClass(/ez-pill--notice/);

    await emitTauri(page, "overlay-error", "no_selection");
    await emitTauri(page, "show-overlay", "error");

    const pill = page.locator(".ez-pill");
    await expect(page.getByRole("alert")).toHaveText("No text selected");
    await expect(pill).toHaveClass(/ez-pill--error/);
    await expect(pill).not.toHaveClass(/ez-pill--notice/);
    await expect
      .poll(() =>
        pill.evaluate((el) => {
          const [r, g] = getComputedStyle(el)
            .borderTopColor.match(/[\d.]+/g)!
            .map(Number);
          return r > g;
        }),
      )
      .toBe(true);
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
