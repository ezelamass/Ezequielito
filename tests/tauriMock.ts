import type { Page } from "@playwright/test";

/**
 * Stand-in for the Tauri runtime so a window's frontend can be loaded from
 * the Vite dev server and driven like the real app: commands return canned
 * values, and tests can emit backend events and read which commands ran.
 */
export interface TauriMockOptions {
  /** Return value per command name. Missing commands resolve to `null`. */
  responses?: Record<string, unknown>;
  /**
   * Commands that fail, with the value they reject with (what a Rust
   * command returns in its `Err`). Takes precedence over `responses`.
   */
  errors?: Record<string, unknown>;
  /** Platform the OS plugin reports. Defaults to `linux`. */
  platform?: "linux" | "macos" | "windows";
}

export interface TauriCall {
  cmd: string;
  args: Record<string, unknown>;
}

export async function installTauriMock(
  page: Page,
  options: TauriMockOptions = {},
): Promise<void> {
  const config = {
    responses: options.responses ?? {},
    errors: options.errors ?? {},
    platform: options.platform ?? "linux",
  };
  await page.addInitScript(({ responses, errors, platform }: typeof config) => {
    const callbacks = new Map<number, (payload: unknown) => void>();
    const listeners = new Map<string, number[]>();
    const calls: { cmd: string; args: Record<string, unknown> }[] = [];
    let nextId = 1;

    const w = window as unknown as Record<string, unknown>;

    w.__TAURI_INTERNALS__ = {
      metadata: {
        currentWindow: { label: "main" },
        currentWebview: { label: "main", windowLabel: "main" },
      },
      transformCallback(callback: (payload: unknown) => void) {
        const id = nextId++;
        callbacks.set(id, callback);
        return id;
      },
      unregisterCallback(id: number) {
        callbacks.delete(id);
      },
      convertFileSrc: (path: string) => path,
      async invoke(cmd: string, args: Record<string, unknown> = {}) {
        if (cmd === "plugin:event|listen") {
          const event = args.event as string;
          const handler = args.handler as number;
          listeners.set(event, [...(listeners.get(event) ?? []), handler]);
          return handler;
        }
        if (cmd === "plugin:event|unlisten") {
          const event = args.event as string;
          const eventId = args.eventId as number;
          listeners.set(
            event,
            (listeners.get(event) ?? []).filter((id) => id !== eventId),
          );
          return null;
        }
        calls.push({ cmd, args });
        if (cmd in errors) throw errors[cmd];
        return cmd in responses ? responses[cmd] : null;
      },
    };

    // `@tauri-apps/plugin-os` reads these synchronously, without a command.
    w.__TAURI_OS_PLUGIN_INTERNALS__ = {
      platform,
      os_type: platform,
      family: platform === "windows" ? "windows" : "unix",
      version: "0.0.0",
      arch: "x86_64",
      exe_extension: platform === "windows" ? "exe" : "",
      eol: platform === "windows" ? "\r\n" : "\n",
    };

    w.__TAURI_EVENT_PLUGIN_INTERNALS__ = {
      unregisterListener() {},
    };

    w.__tauriEmit = (event: string, payload: unknown) => {
      for (const id of listeners.get(event) ?? []) {
        callbacks.get(id)?.({ event, id, payload });
      }
    };
    w.__tauriCalls = calls;
    w.__tauriSetResponse = (cmd: string, value: unknown) => {
      delete errors[cmd];
      responses[cmd] = value;
    };
    w.__tauriSetError = (cmd: string, error: unknown) => {
      errors[cmd] = error;
    };
    w.__tauriListening = (event: string) =>
      (listeners.get(event) ?? []).length > 0;
  }, config);
}

/** From now on, `cmd` resolves to `value`. */
export async function setTauriResponse(
  page: Page,
  cmd: string,
  value: unknown,
): Promise<void> {
  await page.evaluate(
    ([name, data]) => {
      const set = (window as unknown as Record<string, unknown>)
        .__tauriSetResponse as (cmd: string, value: unknown) => void;
      set(name as string, data);
    },
    [cmd, value],
  );
}

/** From now on, `cmd` fails with `error`, until a response is set for it. */
export async function setTauriError(
  page: Page,
  cmd: string,
  error: unknown,
): Promise<void> {
  await page.evaluate(
    ([name, data]) => {
      const set = (window as unknown as Record<string, unknown>)
        .__tauriSetError as (cmd: string, error: unknown) => void;
      set(name as string, data);
    },
    [cmd, error],
  );
}

/** Emits a backend event into the page. */
export async function emitTauri(
  page: Page,
  event: string,
  payload?: unknown,
): Promise<void> {
  await page.evaluate(
    ([name, data]) => {
      const emit = (window as unknown as Record<string, unknown>)
        .__tauriEmit as (event: string, payload: unknown) => void;
      emit(name as string, data);
    },
    [event, payload ?? null],
  );
}

/** Commands the page has invoked so far (event plumbing excluded). */
export async function tauriCalls(page: Page): Promise<TauriCall[]> {
  return page.evaluate(
    () =>
      (window as unknown as Record<string, unknown>)
        .__tauriCalls as TauriCall[],
  );
}

/** Resolves once the page is listening for `event`. */
export async function waitForListener(
  page: Page,
  event: string,
): Promise<void> {
  await page.waitForFunction((name) => {
    const listening = (window as unknown as Record<string, unknown>)
      .__tauriListening as ((event: string) => boolean) | undefined;
    return listening?.(name) === true;
  }, event);
}
