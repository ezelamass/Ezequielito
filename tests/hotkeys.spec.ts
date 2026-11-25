import { test, expect } from "@playwright/test";
import { SETTINGS, openHome } from "./mainWindow";

/** A binding as the settings file keeps it: with the text it was saved with. */
const binding = (
  id: string,
  name: string,
  description: string,
  current_binding: string,
) => ({ id, name, description, default_binding: "", current_binding });

const BINDINGS = {
  transform_polish: binding(
    "transform_polish",
    "Transform: Polish",
    "Read clipboard, polish for clarity and concision, paste replacement.",
    "ctrl+alt+p",
  ),
  add_selection_to_dictionary: binding(
    "add_selection_to_dictionary",
    "A name saved by an older version",
    "A description saved by an older version",
    "ctrl+alt+d",
  ),
  from_the_future: binding(
    "from_the_future",
    "Not translated yet",
    "Its own description",
    "ctrl+alt+f",
  ),
};

test.describe("hotkey names", () => {
  test("Home shows the translated name and description, not the saved ones", async ({
    page,
  }) => {
    await openHome(page, {
      responses: { get_app_settings: { ...SETTINGS, bindings: BINDINGS } },
    });

    const added = page.getByText("Add Selection to Dictionary", {
      exact: true,
    });
    await expect(added).toHaveAttribute(
      "title",
      "Select a word or a name in any app and press the key: it is added to your dictionary.",
    );
    await expect(
      page.getByText("A name saved by an older version"),
    ).toHaveCount(0);

    // The app reads the selection by itself: no "clipboard" in the text.
    await expect(
      page.getByText("Transform: Polish", { exact: true }),
    ).toHaveAttribute(
      "title",
      "Select text and press the key: it is rewritten in place, clearer and more concise.",
    );
  });

  test("a binding without a translation keeps the text it came with", async ({
    page,
  }) => {
    await openHome(page, {
      responses: { get_app_settings: { ...SETTINGS, bindings: BINDINGS } },
    });

    await expect(
      page.getByText("Not translated yet", { exact: true }),
    ).toHaveAttribute("title", "Its own description");
  });

  test("Home follows the app language", async ({ page }) => {
    await openHome(page, {
      responses: {
        get_app_settings: {
          ...SETTINGS,
          app_language: "es",
          bindings: BINDINGS,
        },
      },
    });

    await expect(
      page.getByText("Agregar la selección al diccionario", { exact: true }),
    ).toBeVisible();
  });

  test("the add-to-dictionary hotkey can be set in Settings → General", async ({
    page,
  }) => {
    await openHome(page, {
      responses: { get_app_settings: { ...SETTINGS, bindings: BINDINGS } },
    });

    await page.getByText("Settings", { exact: true }).click();
    await page
      .locator("nav")
      .filter({ hasText: "General" })
      .getByRole("button", { name: "General" })
      .click();

    await expect(
      page.getByText("Add Selection to Dictionary", { exact: true }),
    ).toBeVisible();
  });
});
