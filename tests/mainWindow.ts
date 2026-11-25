import { expect, type Page } from "@playwright/test";
import { installTauriMock, tauriCalls, type TauriCall } from "./tauriMock";

export interface AccountStatus {
  signed_in: boolean;
  email: string | null;
  voice_enabled: boolean | null;
  limit_reached: boolean;
}

export const SIGNED_OUT: AccountStatus = {
  signed_in: false,
  email: null,
  voice_enabled: null,
  limit_reached: false,
};

export const SETTINGS = {
  bindings: {},
  push_to_talk: true,
  audio_feedback: false,
  external_script_path: null,
  app_language: "en",
  vento_cleanup: true,
};

export interface OpenOptions {
  account?: AccountStatus;
  responses?: Record<string, unknown>;
  errors?: Record<string, unknown>;
}

/**
 * Opens the main window on the Home screen. These are the answers it needs
 * at start-up to skip onboarding (a model is already downloaded, and Linux
 * has no permission step) and to render the sidebar, the footer and Home.
 */
export async function openHome(page: Page, options: OpenOptions = {}) {
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

/** The calls the page has made to one command so far. */
export async function callsTo(page: Page, cmd: string): Promise<TauriCall[]> {
  return (await tauriCalls(page)).filter((call) => call.cmd === cmd);
}
