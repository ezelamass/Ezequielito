import type { Page } from "@playwright/test";

/**
 * Stand-in for the Tauri runtime so a window's frontend can be loaded from
 * the Vite dev server and driven like the real app: commands return canned
 * values, and tests can emit backend events and read which commands ran.
 */
export interface TauriMockOptions {
  /** Return value per command name. Missing commands resolve to `null`. */
  responses?: Record<string, unknown>;
}

export interface TauriCall {
  cmd: string;
  args: Record<string, unknown>;
}

export async function installTauriMock(
  page: Page,
  options: TauriMockOptions = {},
): Promise<void> {
  await page.addInitScript((responses: Record<string, unknown>) => {
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
        return cmd in responses ? responses[cmd] : null;
      },
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
    w.__tauriListening = (event: string) =>
      (listeners.get(event) ?? []).length > 0;
  }, options.responses ?? {});
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
