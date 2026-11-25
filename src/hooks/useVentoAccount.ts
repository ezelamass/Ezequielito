import { useCallback, useEffect, useRef, useState } from "react";
import { listen, type UnlistenFn } from "@tauri-apps/api/event";
import { commands, type AccountStatus, type Result } from "@/bindings";

/** How long to wait before asking again whether Vento Voice is enabled. */
const VOICE_RECHECK_DELAY_MS = 3000;

/**
 * Emitted by the backend when the account changed on its own: the session
 * ended, or today's cleanup allowance ran out while dictating.
 */
const ACCOUNT_CHANGED_EVENT = "vento-account-changed";

/** Code reported when the command itself could not run. */
const UNAVAILABLE = "unavailable";

type AccountResult = Result<AccountStatus, string>;

interface UseVentoAccountReturn {
  /** `null` until the first load comes back, or when it failed. */
  status: AccountStatus | null;
  /** True until the first status load finishes. */
  loading: boolean;
  /** True while a sign-in, sign-out or refresh is running. */
  busy: boolean;
  /**
   * Code of the last action that failed (`invalid_credentials`, `network`,
   * `server`, `not_signed_in`, `unavailable`). Cleared when the next one
   * starts.
   */
  error: string | null;
  /** Each action resolves to what the backend answered. */
  signIn: (email: string, password: string) => Promise<AccountResult>;
  signOut: () => Promise<AccountResult>;
  /** Re-checks the account and syncs dictionary, snippets and styles now. */
  refresh: () => Promise<AccountResult>;
}

/** Runs an account command, turning a thrown error into an error result. */
async function settle(
  call: () => Promise<AccountResult>,
): Promise<AccountResult> {
  try {
    return await call();
  } catch {
    return { status: "error", error: UNAVAILABLE };
  }
}

/**
 * The Vento account as the UI sees it: who is signed in, whether Vento
 * Voice is enabled for them, and the actions to change that.
 */
export const useVentoAccount = (): UseVentoAccountReturn => {
  const [status, setStatus] = useState<AccountStatus | null>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const mounted = useRef(true);
  // Bumped when an action starts and again when it ends, so a status read
  // that overlapped one cannot overwrite what the action returned.
  const actions = useRef(0);
  // The "is Vento Voice enabled?" answer is re-read once per session.
  const rechecked = useRef(false);

  const readStatus = useCallback(async () => {
    const seen = actions.current;
    const result = await settle(commands.ventoStatus);
    if (!mounted.current || seen !== actions.current) return;
    if (result.status === "ok") setStatus(result.data);
  }, []);

  useEffect(() => {
    mounted.current = true;
    readStatus().finally(() => {
      if (mounted.current) setLoading(false);
    });
    return () => {
      mounted.current = false;
    };
  }, [readStatus]);

  // The backend says when the account changed without the UI asking for it.
  useEffect(() => {
    let cancelled = false;
    let unlisten: UnlistenFn | undefined;
    listen(ACCOUNT_CHANGED_EVENT, () => {
      void readStatus();
    })
      .then((stop) => {
        if (cancelled) stop();
        else unlisten = stop;
      })
      .catch(() => {
        // No event bridge (outside Tauri): the status is still read on mount.
      });
    return () => {
      cancelled = true;
      unlisten?.();
    };
  }, [readStatus]);

  // Right after start-up or sign-in the backend may still be asking Vento
  // whether the account has Vento Voice. Look once more, then stop.
  const awaitingVoice =
    status?.signed_in === true && status.voice_enabled === null;
  useEffect(() => {
    if (!awaitingVoice || rechecked.current) return;
    const timer = setTimeout(() => {
      rechecked.current = true;
      readStatus();
    }, VOICE_RECHECK_DELAY_MS);
    return () => clearTimeout(timer);
  }, [awaitingVoice, readStatus]);

  const run = useCallback(
    async (call: () => Promise<AccountResult>): Promise<AccountResult> => {
      actions.current += 1;
      setBusy(true);
      setError(null);
      const result = await settle(call);
      actions.current += 1;
      if (mounted.current) {
        if (result.status === "ok") setStatus(result.data);
        else setError(result.error);
        setBusy(false);
      }
      return result;
    },
    [],
  );

  const signIn = useCallback(
    (email: string, password: string) => {
      rechecked.current = false;
      return run(() => commands.ventoSignIn(email, password));
    },
    [run],
  );

  const signOut = useCallback(() => run(commands.ventoSignOut), [run]);

  const refresh = useCallback(async () => {
    const result = await run(commands.ventoRefresh);
    // A failed refresh can mean the session is gone: show what is true now.
    if (result.status === "error") await readStatus();
    return result;
  }, [run, readStatus]);

  return { status, loading, busy, error, signIn, signOut, refresh };
};
