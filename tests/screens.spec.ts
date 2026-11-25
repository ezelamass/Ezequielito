import { test, expect, type Page } from "@playwright/test";
import { installTauriMock } from "./tauriMock";
import { openHome, SETTINGS } from "./mainWindow";

/**
 * Every top-level screen opens and shows its own content, in English and
 * in Spanish. Also saves a screenshot of each, to look at after a change
 * to the theme.
 */

const SIGNED_IN = {
  signed_in: true,
  email: "person@example.com",
  voice_enabled: true,
  limit_reached: false,
};

const HISTORY = {
  entries: [
    {
      id: 2,
      file_name: "a.wav",
      timestamp: Math.floor(Date.now() / 1000) - 3600,
      saved: false,
      title: "a",
      transcription_text: "le conte que bento ya esta andando",
      post_processed_text: "Le conté que Vento ya está andando.",
      post_process_prompt: "Vento · casual",
      post_process_requested: true,
      duration_ms: 42000,
      app_name: "whatsapp",
    },
    {
      id: 1,
      file_name: "b.wav",
      timestamp: Math.floor(Date.now() / 1000) - 90000,
      saved: false,
      title: "b",
      transcription_text: "subi el video a bento",
      post_processed_text: "Subí el video a Vento.",
      post_process_prompt: "Vento · formal",
      post_process_requested: true,
      duration_ms: 31000,
      app_name: "outlook",
    },
  ],
  has_more: false,
};

const SECTIONS = [
  "Insights",
  "Dictionary",
  "Snippets",
  "Style",
  "Transforms",
  "Scratchpad",
  "Settings",
];

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

test.describe("screens", () => {
  test("Home shows the brand, the account and no leftover names", async ({
    page,
  }, testInfo) => {
    await openHome(page, {
      account: SIGNED_IN,
      responses: { get_history_entries: HISTORY },
    });

    await expect(page.getByRole("img", { name: "Vento Voice" })).toBeVisible();
    await expect(page.getByText("person@example.com")).toBeVisible();
    const body = await page.locator("body").innerText();
    expect(body).not.toContain("Ezequielito");
    expect(body).not.toContain("Handy");
    await capture(page, testInfo.outputPath("home.png"));
  });

  for (const section of SECTIONS) {
    test(`${section} opens from the sidebar`, async ({ page }, testInfo) => {
      const errors: string[] = [];
      page.on("pageerror", (error) => errors.push(error.message));

      await openHome(page, {
        account: SIGNED_IN,
        responses: {
          get_history_entries: HISTORY,
          get_dictionary_suggestions: [
            { word: "Vento", count: 2, heard_as: ["bento"] },
          ],
        },
      });
      await page.getByRole("button", { name: section, exact: true }).click();

      // Settings has a nested menu instead of a title of its own.
      const landmark =
        section === "Settings"
          ? page.getByText("Account", { exact: true }).first()
          : page.getByRole("heading", { name: section }).first();
      await expect(landmark).toBeVisible();
      const body = await page.locator("body").innerText();
      expect(body).not.toContain("Ezequielito");
      expect(body).not.toContain("Handy");
      expect(errors).toEqual([]);
      await capture(page, testInfo.outputPath(`${section.toLowerCase()}.png`));
    });
  }

  test("the first run offers one recommended model and hides the rest", async ({
    page,
  }, testInfo) => {
    const model = (id: string, recommended: boolean) => ({
      id,
      name: id,
      description: "",
      filename: id,
      url: null,
      sha256: null,
      size_mb: 456,
      is_downloaded: false,
      is_downloading: false,
      partial_size: 0,
      is_directory: true,
      engine_type: "Parakeet",
      accuracy_score: 0.9,
      speed_score: 0.9,
      supports_translation: false,
      is_recommended: recommended,
      supported_languages: ["es", "en"],
      supports_language_selection: false,
      is_custom: false,
    });
    await installTauriMock(page, {
      platform: "linux",
      responses: {
        has_any_models_available: false,
        get_app_settings: SETTINGS,
        get_default_settings: SETTINGS,
        check_custom_sounds: { start: false, stop: false },
        get_available_models: [
          model("parakeet-tdt-0.6b-v3", true),
          model("small", false),
          model("turbo", false),
        ],
        get_current_model: "",
        get_available_microphones: [],
        get_available_output_devices: [],
      },
    });
    await page.setViewportSize({ width: 1100, height: 760 });
    await page.goto("/");

    await expect(
      page.getByRole("heading", { name: "Dictate anywhere" }),
    ).toBeVisible();
    await expect(page.getByText("Parakeet V3")).toBeVisible();
    await expect(page.getByText("Whisper Small")).toHaveCount(0);
    await capture(page, testInfo.outputPath("first-run.png"));

    await page.getByRole("button", { name: "See 2 other models" }).click();
    await expect(page.getByText("Whisper Small")).toBeVisible();
  });
});
