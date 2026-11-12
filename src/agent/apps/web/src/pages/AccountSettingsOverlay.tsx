import { AppearanceExtras, ConversationExtras, AppBehaviorPanel, DevicePrivacySettings, ExternalLinksPreference } from "./settings/GeneralPreferences";
import { Trans, useLingui } from "@lingui/react/macro";
import type { AccountSecurity } from "@rakazo/contracts";
import {
  accountDisplay,
  displayName,
  MAX_PASSWORD_LENGTH,
  MIN_PASSWORD_LENGTH,
} from "@rakazo/core";
import {
  Button,
  Field,
  FieldLabel,
  Input,
  Label,
  OptionSelect,
  Switch,
  ToggleGroup,
  ToggleGroupItem,
} from "@rakazo/ui-web";
import { Disclosure } from "@rakazo/ui-web/components/ui/disclosure";

import type { RefObject, ReactNode } from "react";
import { useSignOut } from "../lib/sign-out";
import { appPath } from "../lib/app-path";
import { MobileSessions } from "./settings/MobileSessions";
import { useEffect, useId, useRef, useState, useSyncExternalStore } from "react";
import { AccountAccess } from "../components/AccountAccess";
import { SuccessPop } from "../components/ai/primitives";
import { DesktopUpdateSection } from "../components/DesktopUpdates";
import { PasskeySettings } from "../components/PasskeySettings";
import { SettingsGroup, SettingsLabel, SettingsRow } from "../components/SettingsRows";
import { AgentUsageSettings } from "./AgentUsageSettings";
import { SkillLibrarySettings } from "./SkillLibrarySettings";
import { authClient } from "../lib/auth";
import { useDeveloperMode } from "../lib/developer-mode";
import type { BotsSidebarDensity } from "../lib/bots-sidebar-density-pref";
import {
  getBotsSidebarDensity,
  setBotsSidebarDensity,
  subscribeBotsSidebarDensity,
} from "../lib/bots-sidebar-density-pref";
import {
  getComposerEnterToSend,
  setComposerEnterToSend,
  subscribeComposerEnterToSend,
} from "../lib/composer-enter-to-send-pref";
import { setUiLocale } from "../lib/i18n";
import { getInterfaceSize, INTERFACE_SIZES, setInterfaceSize } from "../lib/interface-size";
import { localTimezone, sameTimeZone, timezoneOptions } from "../lib/local-timezone";
import { usePasskeysSupported } from "../lib/passkeys";
import {
  getRemoteImagesPreference,
  setRemoteImagesPreference,
} from "../lib/remote-images-preference";
import {
  getResponseStreamingPreference,
  setResponseStreamingPreference,
} from "../lib/response-streaming";
import {
  getToolActivityPreference,
  setToolActivityPreference,
  subscribeToolActivity,
} from "../lib/tool-activity-preference";
import type { AppearancePreference } from "../lib/ui-appearance";
import { getUiAppearancePreference, setUiAppearance } from "../lib/ui-appearance";
import type { UiLocalePreference } from "../lib/ui-locale";
import { readUiLocalePreference, UI_LOCALE_LABELS, UI_LOCALES } from "../lib/ui-locale";
import { authErrorText } from "../lib/user-error";

export type SettingsGeneralProps = {
  profileOverview?: (onEdit: () => void, busy: boolean) => ReactNode;
  accountId?: string;
  mode?: "all" | "general" | "profile";
  onFormStateChange?: (state: { busy: boolean; dirty: boolean }) => void;
  email?: string | null;
  name: string;
  onNameSaved?: () => Promise<void>;
  /** The user's saved IANA timezone, or null before one is set. */
  timezone?: string | null;
  onTimezoneChange?: (timezone: string) => Promise<void>;
  messagingEnabled?: boolean;
  onOpenMessaging?: () => void;
  onOpenSkills?:()=>void;
};

export function GeneralSettingsPanels({
  profileOverview,
  accountId,
  mode = "all",
  onFormStateChange,
  email,
  name,
  onNameSaved,
  timezone = null,
  onTimezoneChange,
  messagingEnabled = false,
  onOpenMessaging,
}: SettingsGeneralProps) {
  const { t } = useLingui();
  const account = accountDisplay({ name, email }, t`You`);
  const [editingName, setEditingName] = useState(false);
  const [nameDraft, setNameDraft] = useState("");
  const [namePending, setNamePending] = useState(false);
  const [signOutError, setSignOutError] = useState("");
  const { signingOut, logOut } = useSignOut(() => window.location.assign(appPath("/sign-in")), setSignOutError);
  const [nameError, setNameError] = useState<string | null>(null);
  const nameId = useId();

  async function saveName() {
    const nextName = nameDraft.trim();
    if (namePending || !nextName || nextName.length > 80) return;
    if (!displayName(nextName, "")) {
      setNameError(t`Could not update name`);
      return;
    }
    // Nothing to save, so close without a request that could only fail.
    if (nextName === (account.label === email ? "" : displayName(name, ""))) {
      setNameError(null);
      setEditingName(false);
      return;
    }
    setNamePending(true);
    setNameError(null);
    try {
      const result = await authClient.updateUser({ name: nextName });
      if (result.error) {
        setNameError(authErrorText(result.error, t`Could not update name`));
        return;
      }
      setEditingName(false);
      void Promise.resolve()
        .then(() => onNameSaved?.())
        .catch(() => undefined);
    } catch {
      setNameError(t`Could not update name`);
    } finally {
      setNamePending(false);
    }
  }

  const [accountSecurity, setAccountSecurity] = useState<AccountSecurity | null>(null);
  const [developerMode, setDeveloperMode] = useDeveloperMode();
  const developerModeId = useId();
  const [locale, setLocale] = useState<UiLocalePreference>(() => readUiLocalePreference());
  const localeRequestRef = useRef(0);
  const [appearance, setAppearance] = useState<AppearancePreference>(() =>
    getUiAppearancePreference(),
  );
  const sidebarDensity = useSyncExternalStore(
    subscribeBotsSidebarDensity,
    getBotsSidebarDensity,
    () => "comfortable",
  );
  const sidebarDensityLabelId = useId();
  const [streamReplies, setStreamReplies] = useState(
    () => getResponseStreamingPreference() === "on",
  );
  const streamRepliesId = useId();
  const [interfaceSize, updateInterfaceSize] = useState(getInterfaceSize);
  const interfaceSizeId = useId();
  const toolActivity = useSyncExternalStore(
    subscribeToolActivity,
    getToolActivityPreference,
    () => "off" as const,
  );
  const showToolActivityId = useId();
  const enterToSend = useSyncExternalStore(
    subscribeComposerEnterToSend,
    getComposerEnterToSend,
    () => false,
  );
  const enterToSendId = useId();
  const [loadRemoteImages, setLoadRemoteImages] = useState(
    () => getRemoteImagesPreference() === "on",
  );
  const loadRemoteImagesId = useId();
  const timezoneId = useId();
  const showPassword = Boolean(
    accountSecurity?.hasPassword && accountSecurity.passwordChangeEnabled !== false,
  );
  const passkeysSupported = usePasskeysSupported();
  const [timezonePending, setTimezonePending] = useState(false);
  const [nativePending, setNativePending] = useState(false);
  const [externalLinksPending, setExternalLinksPending] = useState(false);
  const [timezoneError, setTimezoneError] = useState<string | null>(null);
  const deviceTimezone = localTimezone();
  const dirtyName = editingName && nameDraft.trim() !== displayName(name, "");
  useEffect(() => {
    onFormStateChange?.({ busy: namePending || timezonePending || nativePending || externalLinksPending || signingOut, dirty: dirtyName });
  }, [onFormStateChange, namePending, timezonePending, nativePending, externalLinksPending, dirtyName, signingOut]);
  useEffect(() => () => onFormStateChange?.({ busy: false, dirty: false }), [onFormStateChange]);

  function chooseLocale(next: UiLocalePreference) {
    if (next === locale) return;
    const requestId = ++localeRequestRef.current;
    setLocale(next);
    void setUiLocale(next).then((activated) => {
      if (requestId !== localeRequestRef.current) return;
      setLocale(next === "system" ? "system" : activated);
    });
  }

  async function chooseTimezone(next: string) {
    if (!onTimezoneChange || timezonePending || next === timezone) return;
    setTimezonePending(true);
    setTimezoneError(null);
    try {
      await onTimezoneChange(next);
    } catch {
      setTimezoneError(t`Couldn't update your timezone`);
    } finally {
      setTimezonePending(false);
    }
  }

  return (
    <div className={mode === "profile" ? "space-y-8" : "rk-general-settings space-y-6"}>
      {mode === "profile" && profileOverview?.(() => {
        setNameDraft(account.label === email ? "" : displayName(name, "")); setNameError(null); setEditingName(true);
      }, namePending || signingOut)}
      {mode !== "general" ? <SettingsGroup title={<Trans>Account</Trans>} data-testid="account-card">
        {editingName ? (
          <form
            className="space-y-3 px-4 py-4"
            onSubmit={(event) => {
              event.preventDefault();
              void saveName();
            }}
            onKeyDown={(event) => {
              if (event.key === "Escape") {
                event.stopPropagation();
                if (!namePending) setEditingName(false);
              }
            }}
          >
            <Field>
              <FieldLabel htmlFor={nameId}>
                <Trans>Name</Trans>
              </FieldLabel>
              <Input
                id={nameId}
                autoComplete="name"
                autoFocus
                maxLength={80}
                value={nameDraft}
                disabled={namePending}
                onChange={(event) => {
                  setNameDraft(event.target.value);
                  setNameError(null);
                }}
              />
            </Field>
            {nameError ? (
              <p role="alert" className="text-[12.5px] text-destructive">
                {nameError}
              </p>
            ) : null}
            <div className="flex items-center gap-3">
              <Button type="submit" disabled={namePending || !nameDraft.trim()}>
                <Trans>Save</Trans>
              </Button>
              <Button
                type="button"
                variant="ghost"
                disabled={namePending}
                onClick={() => setEditingName(false)}
              >
                <Trans>Cancel</Trans>
              </Button>
            </div>
          </form>
        ) : (
          <SettingsRow
            label={
              <>
                <p className="break-words">{mode === "profile" ? t`Email address` : account.label}</p>
                {email && (mode === "profile" || account.label !== email) ? (
                  <p className="mt-0.5 break-words text-[13px] text-muted-foreground">{email}</p>
                ) : null}
              </>
            }
            control={
              mode === "profile" ? <Button variant="outline" size="sm" disabled={signingOut} onClick={() => void logOut()}>{signingOut ? t`Signing out…` : t`Sign out`}</Button> : <Button
                variant="ghost"
                size="sm"
                onClick={() => {
                  setNameDraft(account.label === email ? "" : displayName(name, ""));
                  setNameError(null);
                  setEditingName(true);
                }}
              >
                <Trans>Edit</Trans>
              </Button>
            }
          />
        )}
        {messagingEnabled && onOpenMessaging ? (
          <SettingsRow
            label={<Trans>Messaging</Trans>}
            control={
              <Button variant="secondary" size="sm" onClick={onOpenMessaging}>
                <Trans>Manage</Trans>
              </Button>
            }
          />
        ) : null}
      </SettingsGroup> : null}
      {mode === "profile" && signOutError && <p role="alert" className="text-sm text-destructive">{signOutError}</p>}
      {mode === "profile" && accountId && <MobileSessions key={accountId} accountId={accountId} allDevices />}

      {mode !== "profile" ? <><SettingsGroup title={<Trans>Appearance</Trans>}>
        <SettingsRow
          label={<Trans>Theme</Trans>}
          description={t`Light or dark colors. System follows your device.`}
          control={
            <AppearancePicker
              value={appearance}
              onChange={(next) => {
                setAppearance(next);
                setUiAppearance(next);
              }}
            />
          }
        />
        <SettingsRow
          label={<Trans>Language</Trans>}
          description={t`Menus, buttons and messages use this language.`}
          control={<UiLocalePicker value={locale} onChange={chooseLocale} />}
        />
        <SettingsRow
          label={<Label htmlFor={interfaceSizeId}>{t`Interface size`}</Label>}
          description={t`The size of text and controls in Mycellios.`}
          control={
            <OptionSelect
              id={interfaceSizeId}
              value={interfaceSize}
              options={INTERFACE_SIZES.map((value) => ({ value, label: `${value} %` }))}
              onValueChange={(value) => {
                updateInterfaceSize(value);
                setInterfaceSize(value);
              }}
            />
          }
        />
        <AppearanceExtras />
      </SettingsGroup>

      <SettingsGroup title={t`Conversations`}>
          <SettingsRow
            label={<Label htmlFor={enterToSendId}>{t`Send shortcut`}</Label>}
            control={
              <OptionSelect
                id={enterToSendId}
                data-testid="composer-send-shortcut"
                value={enterToSend ? "enter" : "modified"}
                options={[
                  { value: "enter", label: t`Enter to send` },
                  { value: "modified", label: t`Ctrl/⌘ + Enter to send` },
                ]}
                onValueChange={(value) => setComposerEnterToSend(value === "enter")}
              />
            }
          />
        <SettingsRow label={<Label htmlFor={showToolActivityId}>{t`Show agent steps`}</Label>}
          description={t`Open the available steps and details of each turn by default.`}
          control={<Switch id={showToolActivityId} data-testid="tool-activity-toggle" checked={toolActivity === "expanded"}
            onCheckedChange={checked => setToolActivityPreference(checked ? "expanded" : "on")} />} />
        <ConversationExtras />
        <ExternalLinksPreference onBusyChange={setExternalLinksPending} />
      </SettingsGroup>
      <AppBehaviorPanel onBusyChange={setNativePending} />
      <DevicePrivacySettings />

      <Disclosure alwaysVisible
        data-testid="advanced-settings"
        className="rk-settings-advanced"
        summary={<Trans>Advanced</Trans>}
        summaryClassName="w-full flex items-center justify-between gap-4 px-1 py-3 text-[14px] text-foreground"
      >
        <SettingsGroup data-testid="advanced-settings-content">
        <SettingsRow
          label={
            <span id={sidebarDensityLabelId}>
              <Trans>Sidebar density</Trans>
            </span>
          }
          help={{ label: t`Sidebar density`, description: t`Compact fits more conversations in the sidebar. Comfortable leaves more space between them. Your conversations stay the same.` }}
          control={
            <ToggleGroup
              aria-labelledby={sidebarDensityLabelId}
              data-testid="bots-sidebar-density-select"
              value={[sidebarDensity]}
              onValueChange={([next]) => {
                if (next) setBotsSidebarDensity(next as BotsSidebarDensity);
              }}
              spacing={1}
              className="grid min-w-0 grid-cols-2 rounded-lg bg-muted p-1"
            >
              <ToggleGroupItem
                value="comfortable"
                data-testid="bots-sidebar-density-comfortable"
                className="text-[13px] aria-pressed:bg-background aria-pressed:shadow-sm"
              >
                <Trans>Comfortable</Trans>
              </ToggleGroupItem>
              <ToggleGroupItem
                value="compact"
                data-testid="bots-sidebar-density-compact"
                className="text-[13px] aria-pressed:bg-background aria-pressed:shadow-sm"
              >
                <Trans>Compact</Trans>
              </ToggleGroupItem>
            </ToggleGroup>
          }
        />
        {onTimezoneChange ? (
          <div data-testid="timezone-settings">
            <SettingsRow
              label={
                <span id={timezoneId}>
                  <Trans>Timezone</Trans>
                </span>
              }
              help={{ label: t`Timezone`, description: t`Controls how dates and times are shown and which time zone is used for scheduled tasks.` }}
              control={
                <OptionSelect
                  aria-label={t`Timezone`}
                  data-testid="timezone-select"
                  value={timezone ?? deviceTimezone}
                  disabled={timezonePending}
                  onValueChange={(zone) => void chooseTimezone(zone)}
                  className="w-56 max-w-full"
                  options={timezoneOptions(timezone ?? deviceTimezone).map((zone) => ({
                    value: zone,
                    label: zone.replaceAll("_", " "),
                  }))}
                />
              }
            >
              {!timezone || !sameTimeZone(timezone, deviceTimezone) ? (
                <div className="mt-2 flex justify-end">
                  <Button
                    variant="outline"
                    size="sm"
                    className="h-auto max-w-full py-1.5 text-left whitespace-normal"
                    disabled={timezonePending}
                    data-testid="timezone-use-device"
                    onClick={() => void chooseTimezone(deviceTimezone)}
                  >
                    <Trans comment="Switches the saved timezone to this device's, e.g. 'Use Pacific/Auckland'">
                      Use {deviceTimezone.replaceAll("_", " ")}
                    </Trans>
                  </Button>
                </div>
              ) : null}
              {timezoneError ? (
                <p role="alert" className="mt-2 text-right text-[12.5px] text-destructive">
                  {timezoneError}
                </p>
              ) : null}
            </SettingsRow>
          </div>
        ) : null}

          <SettingsRow
            label={
              <Label htmlFor={developerModeId}>
                <Trans>Developer mode</Trans>
              </Label>
            }
            help={{ label: t`Developer mode`, description: t`Shows technical execution logs on this browser. It does not change permissions or enable extra tools.` }}
            control={
              <Switch
                id={developerModeId}
                checked={developerMode}
                onCheckedChange={setDeveloperMode}
              />
            }
          >
            <p className="text-xs text-muted-foreground">
              <Trans>Show execution logs on this browser.</Trans>
            </p>
          </SettingsRow>
          <SettingsRow
            label={
              <Label htmlFor={streamRepliesId} className="text-[14px] font-normal text-foreground">
                <Trans>Stream replies</Trans>
              </Label>
            }
            help={{ label: t`Stream replies`, description: t`Shows the answer as the model writes it. When disabled, the text appears after the reply is ready. This changes how you see the reply, not its quality.` }}
            control={
              <Switch
                id={streamRepliesId}
                data-testid="response-streaming-toggle"
                checked={streamReplies}
                onCheckedChange={(checked) => {
                  setStreamReplies(checked);
                  setResponseStreamingPreference(checked ? "on" : "off");
                }}
              />
            }
          />
          <SettingsRow
            label={
              <Label
                htmlFor={loadRemoteImagesId}
                className="text-[14px] font-normal text-foreground"
              >
                <Trans>Load web images automatically</Trans>
              </Label>
            }
            help={{ label: t`Load web images automatically`, description: t`Loads images from websites in the conversation. Turn this off if you prefer to load them only when you choose.` }}
            control={
              <Switch
                id={loadRemoteImagesId}
                data-testid="remote-images-toggle"
                checked={loadRemoteImages}
                onCheckedChange={(checked) => {
                  setLoadRemoteImages(checked);
                  setRemoteImagesPreference(checked ? "on" : "off");
                }}
              />
            }
          />
        </SettingsGroup>
      </Disclosure>
      </> : null}

      {mode !== "general" && (showPassword || passkeysSupported) ? (
        <SettingsGroup title={<Trans>Security</Trans>}>
          {showPassword ? <ChangePasswordRow email={email} /> : null}
          <PasskeySettings />
        </SettingsGroup>
      ) : null}

      {mode === "all" ? <SkillLibrarySettings /> : null}
      {mode !== "general" ? <Disclosure alwaysVisible summary={t`Account access`} className="rk-settings-details" summaryClassName="w-full py-2 text-sm text-muted-foreground"><AccountAccess onSecurity={setAccountSecurity} /></Disclosure> : null}
    </div>
  );
}

export function UsageSettingsPanel({
  panelRef,
}: {
  usage?: {
    runs: number;
    inputTokens: number | null;
    outputTokens: number | null;
    totalTokens?: number | null;
  } | null;
  panelRef?: RefObject<HTMLDivElement | null>;
}) {
  return <AgentUsageSettings panelRef={panelRef} />;
}

export { ComputerSettingsPanel } from "./settings/ComputerUseSettings";

export function UpdatesSettingsPanel() {
  return (
    <div className="space-y-5">
      <DesktopUpdateSection />
    </div>
  );
}

function ChangePasswordRow({ email }: { email?: string | null }) {
  const { t } = useLingui();
  const [open, setOpen] = useState(false);
  const [currentPassword, setCurrentPassword] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [confirmation, setConfirmation] = useState("");
  const [pending, setPending] = useState(false);
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function changePassword() {
    if (pending) return;
    if (newPassword !== confirmation) {
      setError(t`Passwords do not match`);
      return;
    }
    setPending(true);
    setSaved(false);
    setError(null);
    try {
      const result = await authClient.changePassword({
        currentPassword,
        newPassword,
        revokeOtherSessions: true,
      });
      if (result.error) {
        setError(authErrorText(result.error, t`Could not change password`));
        return;
      }
      setCurrentPassword("");
      setNewPassword("");
      setConfirmation("");
      setOpen(false);
      setSaved(true);
    } catch {
      setError(t`Could not reach the server`);
    } finally {
      setPending(false);
    }
  }

  function close() {
    setOpen(false);
    setCurrentPassword("");
    setNewPassword("");
    setConfirmation("");
    setError(null);
  }

  return (
    <SettingsRow
      label={<Trans>Password</Trans>}
      control={
        open ? null : (
          <>
            {saved ? <SuccessPop label={t`Password updated`} /> : null}
            <Button
              variant="secondary"
              size="sm"
              onClick={() => {
                setSaved(false);
                setOpen(true);
              }}
            >
              <Trans>Change password</Trans>
            </Button>
          </>
        )
      }
    >
      {open ? (
        <form
          className="mt-3"
          onSubmit={(event) => {
            event.preventDefault();
            void changePassword();
          }}
          onKeyDown={(event) => {
            if (event.key === "Escape" && !pending) {
              event.stopPropagation();
              close();
            }
          }}
        >
          <div className="grid gap-3">
            <input
              type="text"
              name="username"
              autoComplete="username"
              value={email ?? ""}
              readOnly
              tabIndex={-1}
              aria-hidden="true"
              className="sr-only"
            />
            <SettingsPasswordInput
              label={t`Current password`}
              autoComplete="current-password"
              autoFocus
              value={currentPassword}
              onChange={setCurrentPassword}
            />
            <SettingsPasswordInput
              label={t`New password`}
              autoComplete="new-password"
              value={newPassword}
              onChange={setNewPassword}
            />
            <SettingsPasswordInput
              label={t`Confirm password`}
              autoComplete="new-password"
              value={confirmation}
              onChange={setConfirmation}
            />
          </div>
          {error ? (
            <p role="alert" className="mt-3 text-[12.5px] text-destructive">
              {error}
            </p>
          ) : null}
          <div className="mt-4 flex items-center gap-3">
            <Button type="submit" disabled={pending || !currentPassword || !newPassword}>
              {pending ? <Trans>Changing…</Trans> : <Trans>Save</Trans>}
            </Button>
            <Button type="button" variant="ghost" disabled={pending} onClick={close}>
              <Trans>Cancel</Trans>
            </Button>
          </div>
        </form>
      ) : null}
    </SettingsRow>
  );
}

function SettingsPasswordInput({
  label,
  autoComplete,
  autoFocus,
  value,
  onChange,
}: {
  label: string;
  autoComplete: "current-password" | "new-password";
  autoFocus?: boolean;
  value: string;
  onChange: (value: string) => void;
}) {
  const id = useId();
  return (
    <Field>
      <FieldLabel htmlFor={id}>{label}</FieldLabel>
      <Input
        id={id}
        type="password"
        autoComplete={autoComplete}
        autoFocus={autoFocus}
        minLength={autoComplete === "new-password" ? MIN_PASSWORD_LENGTH : undefined}
        maxLength={MAX_PASSWORD_LENGTH}
        value={value}
        onChange={(event) => onChange(event.target.value)}
      />
    </Field>
  );
}

function AppearancePicker({ value, onChange }: { value: AppearancePreference; onChange: (next: AppearancePreference) => void }) {
  const { t } = useLingui();
  return <OptionSelect aria-label={t`Theme`} data-testid="ui-appearance-select" value={value} className="w-44 max-w-full"
    options={[{ value: "system", label: t`System` }, { value: "light", label: t`Light` }, { value: "dark", label: t`Dark` }]}
    onValueChange={value => onChange(value as AppearancePreference)} />;
}

function UiLocalePicker({
  value,
  onChange,
}: {
  value: UiLocalePreference;
  onChange: (locale: UiLocalePreference) => void;
}) {
  const { t } = useLingui();
  return (
    <OptionSelect
      className="w-56 max-w-full"
      data-testid="ui-locale-select"
      aria-label={t`Language`}
      options={[{ value: "system", label: t`System default` }, ...UI_LOCALES.map((code) => ({ value: code, label: UI_LOCALE_LABELS[code] }))]}
      value={value}
      onValueChange={onChange}
    />
  );
}
