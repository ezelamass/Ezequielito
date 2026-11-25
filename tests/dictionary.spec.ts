import { test, expect, type Locator, type Page } from "@playwright/test";
import { emitTauri, setTauriResponse, waitForListener } from "./tauriMock";
import { SETTINGS, callsTo, openHome } from "./mainWindow";

interface WordSuggestion {
  word: string;
  count: number;
  heard_as: string[];
}

const ZERNIO: WordSuggestion = {
  word: "Zernio",
  count: 3,
  heard_as: ["sernio", "cernio"],
};
const LAMAS: WordSuggestion = { word: "Lamas", count: 1, heard_as: ["llamas"] };

interface DictionaryOptions {
  suggestions?: WordSuggestion[];
  words?: string[];
  errors?: Record<string, unknown>;
}

async function openDictionary(page: Page, options: DictionaryOptions = {}) {
  await openHome(page, {
    responses: {
      get_app_settings: { ...SETTINGS, custom_words: options.words ?? [] },
      get_dictionary_suggestions: options.suggestions ?? [],
    },
    errors: options.errors,
  });
  await page.getByText("Dictionary", { exact: true }).click();
  await expect(page.getByRole("heading", { name: "Dictionary" })).toBeVisible();
}

const suggestions = (page: Page): Locator =>
  page.getByRole("region", { name: "Suggestions" });

const row = (page: Page, word: string): Locator =>
  suggestions(page).getByRole("listitem").filter({ hasText: word });

/** The dictionary's own word list: each word is a button that removes it. */
const dictionaryWord = (page: Page, word: string): Locator =>
  page.getByRole("button", { name: `Remove ${word}` });

test.describe("dictionary suggestions", () => {
  test("shows each suggested word with what was heard and how often", async ({
    page,
  }, testInfo) => {
    await openDictionary(page, {
      suggestions: [ZERNIO, LAMAS],
      words: ["Vento"],
    });

    await expect(suggestions(page).getByRole("listitem")).toHaveCount(2);
    await expect(row(page, "Zernio")).toContainText("Heard as: sernio, cernio");
    await expect(row(page, "Zernio")).toContainText(
      "Corrected in 3 dictations",
    );
    await expect(row(page, "Lamas")).toContainText("Heard as: llamas");
    await expect(row(page, "Lamas")).toContainText("Corrected in 1 dictation");
    await expect(row(page, "Lamas")).not.toContainText("dictations");
    await expect(
      row(page, "Zernio").getByRole("button", { name: "Add Zernio" }),
    ).toBeVisible();
    await expect(
      row(page, "Zernio").getByRole("button", { name: "Dismiss Zernio" }),
    ).toBeVisible();

    // Above the word list, which is still there.
    await expect(dictionaryWord(page, "Vento")).toBeVisible();
    const blockBox = await suggestions(page).boundingBox();
    const wordBox = await dictionaryWord(page, "Vento").boundingBox();
    expect(blockBox!.y).toBeLessThan(wordBox!.y);

    await page.screenshot({ path: testInfo.outputPath("suggestions.png") });
  });

  test("adding a suggestion saves it and the word reaches the list", async ({
    page,
  }) => {
    await openDictionary(page, { suggestions: [ZERNIO, LAMAS] });
    await expect(row(page, "Zernio")).toBeVisible();
    await expect(dictionaryWord(page, "Zernio")).toHaveCount(0);
    const loadsBefore = (await callsTo(page, "get_dictionary_suggestions"))
      .length;

    // What the backend answers once the word is in the dictionary.
    await setTauriResponse(page, "get_app_settings", {
      ...SETTINGS,
      custom_words: ["Zernio"],
    });
    await setTauriResponse(page, "get_dictionary_suggestions", [LAMAS]);
    await row(page, "Zernio")
      .getByRole("button", { name: "Add Zernio" })
      .click();

    await expect(dictionaryWord(page, "Zernio")).toBeVisible();
    await expect(row(page, "Zernio")).toHaveCount(0);
    await expect(row(page, "Lamas")).toBeVisible();

    const accepted = await callsTo(page, "accept_dictionary_suggestion");
    expect(accepted).toHaveLength(1);
    expect(accepted[0].args).toEqual({ word: "Zernio" });
    expect(await callsTo(page, "dismiss_dictionary_suggestion")).toHaveLength(
      0,
    );
    expect(await callsTo(page, "get_dictionary_suggestions")).toHaveLength(
      loadsBefore + 1,
    );
  });

  test("dismissing a suggestion saves that and takes it away", async ({
    page,
  }) => {
    await openDictionary(page, { suggestions: [ZERNIO, LAMAS] });
    await expect(row(page, "Lamas")).toBeVisible();
    const loadsBefore = (await callsTo(page, "get_dictionary_suggestions"))
      .length;

    await setTauriResponse(page, "get_dictionary_suggestions", [ZERNIO]);
    await row(page, "Lamas")
      .getByRole("button", { name: "Dismiss Lamas" })
      .click();

    await expect(row(page, "Lamas")).toHaveCount(0);
    await expect(row(page, "Zernio")).toBeVisible();
    await expect(dictionaryWord(page, "Lamas")).toHaveCount(0);

    const dismissed = await callsTo(page, "dismiss_dictionary_suggestion");
    expect(dismissed).toHaveLength(1);
    expect(dismissed[0].args).toEqual({ word: "Lamas" });
    expect(await callsTo(page, "accept_dictionary_suggestion")).toHaveLength(0);
    expect(await callsTo(page, "get_dictionary_suggestions")).toHaveLength(
      loadsBefore + 1,
    );
  });

  test("a suggestion that could not be saved stays and says so", async ({
    page,
  }) => {
    await openDictionary(page, {
      suggestions: [ZERNIO],
      errors: { accept_dictionary_suggestion: "disk full" },
    });

    await row(page, "Zernio")
      .getByRole("button", { name: "Add Zernio" })
      .click();

    await expect(
      page.getByText("Couldn't save that. Try again."),
    ).toBeVisible();
    await expect(row(page, "Zernio")).toBeVisible();
    await expect(
      row(page, "Zernio").getByRole("button", { name: "Add Zernio" }),
    ).toBeEnabled();
  });

  test("with no suggestions, explains when they show up", async ({ page }) => {
    await openDictionary(page, { suggestions: [], words: ["Vento"] });

    await expect(suggestions(page)).toContainText(
      "Suggestions show up here when the same name gets corrected in two or more cleaned-up dictations.",
    );
    await expect(suggestions(page).getByRole("listitem")).toHaveCount(0);
    await expect(dictionaryWord(page, "Vento")).toBeVisible();
  });

  test("when suggestions cannot be loaded, the dictionary still works", async ({
    page,
  }) => {
    await openDictionary(page, {
      words: ["Vento"],
      errors: { get_dictionary_suggestions: "history unavailable" },
    });

    await expect(dictionaryWord(page, "Vento")).toBeVisible();
    await expect
      .poll(
        async () => (await callsTo(page, "get_dictionary_suggestions")).length,
      )
      .toBeGreaterThan(0);
    await expect(suggestions(page)).toHaveCount(0);

    // Adding a word by hand is unaffected.
    await setTauriResponse(page, "get_app_settings", {
      ...SETTINGS,
      custom_words: ["Vento", "Zernio"],
    });
    await page.getByPlaceholder("Add a word").fill("Zernio");
    await page.getByRole("button", { name: "Add", exact: true }).click();

    await expect(dictionaryWord(page, "Zernio")).toBeVisible();
    const saved = await callsTo(page, "update_custom_words");
    expect(saved).toHaveLength(1);
    expect(saved[0].args).toEqual({ words: ["Vento", "Zernio"] });
  });

  test("a word added with the global hotkey shows up in the list", async ({
    page,
  }) => {
    await openDictionary(page, { words: ["Vento"] });
    await expect(dictionaryWord(page, "Vento")).toBeVisible();
    await waitForListener(page, "dictionary-changed");
    const before = (await callsTo(page, "get_app_settings")).length;

    await setTauriResponse(page, "get_app_settings", {
      ...SETTINGS,
      custom_words: ["Vento", "Zernio"],
    });
    await emitTauri(page, "dictionary-changed");

    await expect(dictionaryWord(page, "Zernio")).toBeVisible();
    // One event, one reload: the listener is registered once.
    await page.waitForTimeout(300);
    expect(await callsTo(page, "get_app_settings")).toHaveLength(before + 1);
  });
});
