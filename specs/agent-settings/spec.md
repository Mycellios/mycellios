# Unified settings

Combine OpenBot's searchable navigation and section rows with the existing
Mycellios settings implementation. Preserve the original paper/stone palette,
shared Base UI controls, encrypted connections and server authorization. The
shared dialog is 1080px wide with a 232px sidebar; mobile keeps search and a
scrollable section strip. Search includes field aliases in English/Spanish,
ignores accents and supports Enter for a unique result. Escape clears a query
before requesting close.

| Section | Owner / persistence | Flow |
| --- | --- | --- |
| General | Device UI preferences; account timezone | Existing appearance, density, language, timezone and advanced conversation controls |
| Profile/security | Signed-in account | Existing name, password, passkey, SSO and account-removal flows |
| Micos | Selected owned Space | Open the canonical Mico editor; shared skills use the canonical editor |
| Models | Account; Space overrides remain in Space | Existing encrypted credentials, providers, OAuth, defaults/backups and limits |
| Notifications | Device policy per member; Mico settings in their Space | Reply enablement, message-preview privacy, explicit OS permission, local test and per-Mico flags |
| Voice | Account services; optional device voice entry | Existing speech connections and samples; conversation entry appears only when the host supplies that capability |
| Approvals | Account | Existing rule editor and server validation |
| Space | Selected owned Space | Existing name, members, model overrides and removal |
| Memory | Selected owned Space | Existing provider forms, default scope and encrypted credentials |
| Usage | Existing report / local cost-display preference | Existing measured/estimated cost and token report |
| Computer | Configured environment | Actual environment, existing recovery and per-Mico access guidance |
| Mobile | Same account; device installation | Existing safe server link, clipboard fallback and iPhone/Android guide |
| Updates | Current web build / installed Desktop package | Existing release notes/history, coalesced passive web check and native updater |
| Billing | Capability/owner gated | Existing balance/portal; failed reads expose retry |
| Logs | Developer mode / selected Space | Existing owned run-log report |

Keep a single editor for each setting. Existing legacy links remain valid.
Account settings do not gain an implicit Space override. Space-bound actions must
use the selected Space's client; cached data and device preferences remain scoped
to the signed-in user. Opening Mico settings remembers the canonical right-panel
state for that Mico and uses the existing Space-switch mechanism.
Micos and notification lists load the selected Space's roster independently of
the open chat. Failed roster reads expose retry, never an empty-success state;
per-Mico saves refresh that same scoped cache. Opening a different Space's Mico
uses the selected Space even when it is absent from the current chat roster.

Profile names, model connection fields, speech keys and memory drafts report busy
and dirty state to the shared leave guard. Keep editing preserves the form;
discard permits the requested navigation. Pending saves block close/navigation.
Connection close uses the same guard and cancels the existing OAuth attempt.
Successful saves clear dirty state. Secret drafts never enter preference storage.

Reply notifications only run while the app is open in the background. Device
disablement does not change server-side Mico flags, and message-preview privacy
removes both Mico names and reply content from the system notification. Permission
is requested through an explicit action; blocked/unsupported states stay visible.
Incoming-call and closed-app push behavior retain their existing separate flows.

Web checks reuse the client-update tracker and cannot reload through open settings,
unsent work or calls. A development build is identified as a preview. Native
checks/installation retain the installed package's actual updater behavior and
published manual download route. Do not import OpenBot's server-member restart
permissions, channel switches or automatic installation controls without a matching
Mycellios runtime capability. No deployment or updater-security policy is changed.

Validation commands remain under compilar.ps1. Focused tests cover the owning
settings/auth/approval/model/voice/update behavior; the isolated settings browser
scenario uses a real local API/PostgreSQL/worker and a free local model fixture.
Browser notification construction is an explicit in-page fixture. External OAuth,
real microphone permissions/audio, native packaging/installation, remote memory
acceptance, password/deletion and payment actions require separate qualification;
read-only or synthetic checks must not be described as live acceptance.

References inspected:

- https://github.com/nightly-labs/openbot/blob/main/src/renderer/src/features/settings/SettingsModal.tsx
- https://github.com/nightly-labs/openbot/blob/main/packages/ui/src/features/settings/SettingsDialogShell.tsx
- https://github.com/nightly-labs/openbot/blob/main/packages/ui/src/features/settings/SettingsUpdatesTab.tsx
- https://github.com/nightly-labs/openbot/blob/main/src/renderer/src/features/settings/SettingsNotificationsTab.tsx
- https://github.com/nightly-labs/openbot/blob/main/packages/ui/src/features/settings/SettingsMobileConnectTab.tsx

Production promotion retains the current skill editor. Marketplace and continuous
voice UI are separate local candidates; their entry controls are capability-gated.
