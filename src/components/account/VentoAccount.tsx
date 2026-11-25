import React, { useId, useState } from "react";
import { toast } from "sonner";
import { useTranslation } from "react-i18next";
import { Button } from "../ui/Button";
import { Input } from "../ui/Input";
import { SettingContainer } from "../ui/SettingContainer";
import { SettingsGroup } from "../ui/SettingsGroup";
import { ToggleSwitch } from "../ui/ToggleSwitch";
import { useSettings } from "../../hooks/useSettings";
import { useVentoAccount } from "../../hooks/useVentoAccount";

interface VentoAccountProps {
  /**
   * `card`: a compact bordered block for the Home screen.
   * `settings`: a group like the rest of the settings.
   */
  variant?: "card" | "settings";
}

/** Error codes from the backend that have a message of their own. */
const ERROR_KEYS: Record<string, string> = {
  invalid_credentials: "account.errors.invalidCredentials",
  network: "account.errors.network",
  not_signed_in: "account.errors.notSignedIn",
};

const errorKey = (code: string): string =>
  ERROR_KEYS[code] ?? "account.errors.generic";

/**
 * The Vento account: sign in with email and password, see whether
 * dictations are being cleaned up, turn that off, sync and sign out.
 */
export const VentoAccount: React.FC<VentoAccountProps> = ({
  variant = "card",
}) => {
  const { t } = useTranslation();
  const account = useVentoAccount();

  // Nothing to show until the app knows whether someone is signed in.
  if (account.loading) return null;

  const signedIn = account.status?.signed_in === true;
  const rows = signedIn ? (
    <SignedIn account={account} showTitle={variant === "card"} />
  ) : (
    <SignInForm account={account} showTitle={variant === "card"} />
  );

  if (variant === "settings") {
    return <SettingsGroup title={t("account.title")}>{rows}</SettingsGroup>;
  }

  return (
    <section
      aria-label={t("account.title")}
      className="border border-mid-gray/20 rounded-xl divide-y divide-mid-gray/20"
    >
      {rows}
    </section>
  );
};

interface PartProps {
  account: ReturnType<typeof useVentoAccount>;
  /** The card carries its own title; in settings the group has it. */
  showTitle: boolean;
}

const SignInForm: React.FC<PartProps> = ({ account, showTitle }) => {
  const { t } = useTranslation();
  const { busy, error, signIn } = account;
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const emailId = useId();
  const passwordId = useId();

  const ready = email.trim() !== "" && password !== "";

  const handleSubmit = async (event: React.FormEvent) => {
    event.preventDefault();
    if (!ready || busy) return;
    const typed = password;
    // The password is only needed for this one call: drop it right away,
    // whatever the answer turns out to be.
    setPassword("");
    await signIn(email.trim(), typed);
  };

  return (
    <div className="p-4 space-y-3">
      <div className="space-y-1">
        {showTitle && (
          <h2 className="font-serif italic text-2xl">{t("account.title")}</h2>
        )}
        <p className="text-sm text-mid-gray">
          {t("account.signIn.description")}
        </p>
      </div>
      <form
        noValidate
        onSubmit={handleSubmit}
        className="flex flex-wrap items-end gap-3"
      >
        <div className="flex-1 min-w-48 flex flex-col gap-1">
          <label htmlFor={emailId} className="text-xs text-mid-gray">
            {t("account.signIn.email")}
          </label>
          <Input
            id={emailId}
            type="email"
            name="email"
            autoComplete="username"
            autoCapitalize="none"
            spellCheck={false}
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            disabled={busy}
            className="w-full"
          />
        </div>
        <div className="flex-1 min-w-48 flex flex-col gap-1">
          <label htmlFor={passwordId} className="text-xs text-mid-gray">
            {t("account.signIn.password")}
          </label>
          <Input
            id={passwordId}
            type="password"
            name="password"
            autoComplete="current-password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            disabled={busy}
            className="w-full"
          />
        </div>
        <Button
          type="submit"
          variant="primary-soft"
          size="lg"
          disabled={busy || !ready}
        >
          {busy ? t("account.signIn.submitting") : t("account.signIn.submit")}
        </Button>
      </form>
      {error && (
        <p role="alert" className="text-sm text-red-400">
          {t(errorKey(error))}
        </p>
      )}
    </div>
  );
};

const SignedIn: React.FC<PartProps> = ({ account, showTitle }) => {
  const { t } = useTranslation();
  const { getSetting, updateSetting, isUpdating } = useSettings();
  const { status, busy, signOut, refresh } = account;
  const [syncing, setSyncing] = useState(false);

  const cleanup = getSetting("vento_cleanup") ?? true;
  const voiceEnabled = status?.voice_enabled ?? null;
  const limitReached = status?.limit_reached === true;

  const handleSync = async () => {
    setSyncing(true);
    const result = await refresh();
    setSyncing(false);
    if (result.status === "ok") {
      toast.success(t("account.sync.success"));
    } else {
      toast.error(t(errorKey(result.error)));
    }
  };

  const handleSignOut = async () => {
    const result = await signOut();
    if (result.status === "error") toast.error(t(errorKey(result.error)));
  };

  return (
    <>
      <div className="flex items-center justify-between gap-4 px-4 py-3">
        <div className="min-w-0">
          {showTitle && (
            <div className="text-xs uppercase tracking-wider text-mid-gray mb-1">
              {t("account.title")}
            </div>
          )}
          <div className="text-sm font-medium truncate select-text">
            {status?.email}
          </div>
          <VoiceStatus
            voiceEnabled={voiceEnabled}
            cleanup={cleanup}
            limitReached={limitReached}
          />
        </div>
        <Button
          variant="secondary"
          size="sm"
          onClick={handleSignOut}
          disabled={busy}
          className="shrink-0"
        >
          {t("account.signOut")}
        </Button>
      </div>
      <ToggleSwitch
        checked={cleanup}
        onChange={(value) => updateSetting("vento_cleanup", value)}
        isUpdating={isUpdating("vento_cleanup")}
        disabled={voiceEnabled === false}
        label={t("account.cleanup.title")}
        description={t("account.cleanup.description")}
        descriptionMode="tooltip"
        grouped={true}
      />
      <SettingContainer
        title={t("account.sync.title")}
        description={t("account.sync.description")}
        descriptionMode="tooltip"
        grouped={true}
      >
        <Button
          variant="secondary"
          size="sm"
          onClick={handleSync}
          disabled={busy}
        >
          {syncing ? t("account.sync.syncing") : t("account.sync.button")}
        </Button>
      </SettingContainer>
    </>
  );
};

/** One line saying what Vento is doing for this account right now. */
const VoiceStatus: React.FC<{
  voiceEnabled: boolean | null;
  cleanup: boolean;
  /** Today's cleanup allowance is used up. */
  limitReached: boolean;
}> = ({ voiceEnabled, cleanup, limitReached }) => {
  const { t } = useTranslation();

  let state: "active" | "limitReached" | "paused" | "notEnabled" | "checking";
  if (voiceEnabled === null) state = "checking";
  else if (!voiceEnabled) state = "notEnabled";
  else if (!cleanup) state = "paused";
  else state = limitReached ? "limitReached" : "active";

  return (
    <div
      role="status"
      data-state={state}
      className="flex items-center gap-2 text-sm text-mid-gray"
    >
      <span
        aria-hidden="true"
        className={`w-2 h-2 rounded-full shrink-0 ${
          state === "active"
            ? "bg-logo-primary"
            : state === "checking"
              ? "bg-mid-gray/60 animate-pulse"
              : "bg-mid-gray/60"
        }`}
      />
      <span>{t(`account.status.${state}`)}</span>
    </div>
  );
};
