import { useLingui } from "@lingui/react/macro";
import type {
  SpaceInvitationCreated,
  SpaceMemberRole,
  SpaceMembers,
  SpacePerson,
  SpaceRole,
} from "@mycellios/contracts";
import { canChangeSpaceRole, canInviteToSpace, canRemoveSpacePerson } from "@mycellios/contracts";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  Button,
  Input,
  NativeSelect,
  NativeSelectOption,
} from "@mycellios/ui-web";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Check } from "lucide-react";
import { useState } from "react";
import { LoadingSkeleton } from "../components/LoadingSkeleton";
import { SettingsGroup, SettingsRow } from "../components/SettingsRows";
import { useCopyText } from "../lib/copy-text";
import { useSpaceQueries, writeSaved } from "../lib/query";
import { spaceLabel } from "../lib/space-label";
import { useSpaceRpc } from "../lib/space-rpc";
import { errorText } from "../lib/user-error";

/**
 * The people in the bound Space (specs/space-members). Its owner and admins invite by email or
 * with a one-use link; people who joined see who is there and can leave.
 */
export function SpaceMembersPanel({
  spaceName,
  onLeft,
}: {
  spaceName: string;
  /** Called once the viewer has left; the Space is no longer theirs to show. */
  onLeft?: () => void;
}) {
  const { t, i18n } = useLingui();
  const queries = useSpaceQueries();
  const rpc = useSpaceRpc();
  const queryClient = useQueryClient();
  const listOptions = queries.spaces.members.list.queryOptions();
  const members = useQuery(listOptions);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [email, setEmail] = useState("");
  const [created, setCreated] = useState<SpaceInvitationCreated | null>(null);
  const [leaving, setLeaving] = useState(false);
  const [copied, copy] = useCopyText();

  async function run(action: () => Promise<SpaceMembers | undefined>) {
    if (busy) return;
    setBusy(true);
    setError(null);
    try {
      const next = await action();
      if (next) await writeSaved(queryClient, listOptions.queryKey, () => next);
    } catch (err) {
      setError(errorText(err));
    } finally {
      setBusy(false);
    }
  }

  function invite(kind: "email" | "link") {
    void run(async () => {
      const result = await rpc.spaces.invites.create(
        kind === "email" ? { kind, email: email.trim() } : { kind },
      );
      setCreated(result);
      if (kind === "email") setEmail("");
      return rpc.spaces.members.list();
    });
  }

  if (members.isPending) return <LoadingSkeleton layout="settings" />;
  if (members.isError)
    return (
      <div className="space-y-3">
        <p role="alert" className="text-sm text-destructive">
          {errorText(members.error)}
        </p>
        <Button variant="outline" onClick={() => void members.refetch()}>
          {t`Retry`}
        </Button>
      </div>
    );

  const data = members.data;
  const manages = canInviteToSpace(data.role);
  const roleLabel = (role: SpaceRole) =>
    role === "owner" ? t`Owner` : role === "admin" ? t`Admin` : t`Member`;
  const personName = (person: SpacePerson) => person.name || person.email || "—";
  const expires = (iso: string) => i18n.date(new Date(iso), { dateStyle: "medium" });
  const showLink =
    created && (created.invitation.kind === "link" || !created.emailSent) ? created : null;
  const space = spaceLabel(spaceName);

  return (
    <div className="space-y-8" data-testid="space-members">
      <SettingsGroup data-testid="space-people">
        {data.people.map((person) => {
          const name = personName(person);
          return (
            <SettingsRow
              key={person.userId}
              label={<p className="break-words">{name}</p>}
              description={person.name && person.email ? person.email : undefined}
              control={
                <>
                  {canChangeSpaceRole(data.role, person.role) ? (
                    <NativeSelect
                      size="sm"
                      aria-label={t`Role`}
                      value={person.role}
                      disabled={busy}
                      onChange={(event) => {
                        const role = event.target.value as SpaceMemberRole;
                        void run(() => rpc.spaces.members.setRole({ userId: person.userId, role }));
                      }}
                    >
                      <NativeSelectOption value="admin">{t`Admin`}</NativeSelectOption>
                      <NativeSelectOption value="member">{t`Member`}</NativeSelectOption>
                    </NativeSelect>
                  ) : (
                    <span className="text-[13px] text-muted-foreground">
                      {roleLabel(person.role)}
                    </span>
                  )}
                  {!person.you && canRemoveSpacePerson(data.role, person.role) ? (
                    <Button
                      variant="ghost"
                      size="sm"
                      className="rounded-full"
                      aria-label={t`Remove ${name}`}
                      disabled={busy}
                      onClick={() =>
                        void run(() => rpc.spaces.members.remove({ userId: person.userId }))
                      }
                    >
                      {t`Remove`}
                    </Button>
                  ) : null}
                </>
              }
            />
          );
        })}
      </SettingsGroup>

      {manages ? (
        <SettingsGroup data-testid="space-invite">
          <form
            className="flex flex-wrap items-center gap-2 px-4 py-3"
            onSubmit={(event) => {
              event.preventDefault();
              if (email.trim()) invite("email");
            }}
          >
            <Input
              type="email"
              className="min-w-0 flex-1 basis-56"
              aria-label={t`Email address`}
              placeholder={t`Email address`}
              value={email}
              disabled={busy}
              onChange={(event) => setEmail(event.target.value)}
            />
            <Button type="submit" className="rounded-full" disabled={busy || !email.trim()}>
              {t`Invite`}
            </Button>
            <Button
              type="button"
              variant="outline"
              className="rounded-full"
              disabled={busy}
              onClick={() => invite("link")}
            >
              {t`Create link`}
            </Button>
          </form>
          {showLink ? (
            <div className="space-y-2 px-4 py-3" data-testid="space-invite-link">
              <div className="flex gap-2">
                <Input
                  readOnly
                  value={showLink.url}
                  aria-label={t`Invite link`}
                  onFocus={(event) => event.currentTarget.select()}
                />
                <Button variant="outline" onClick={() => copy(showLink.url)}>
                  {copied ? <Check size={15} aria-hidden="true" /> : null}
                  {copied ? t`Copied` : t`Copy link`}
                </Button>
              </div>
              {showLink.invitation.kind === "email" ? (
                <p className="text-[13px] text-muted-foreground">
                  {t`Email not sent. Share the link instead.`}
                </p>
              ) : null}
            </div>
          ) : null}
        </SettingsGroup>
      ) : null}

      {manages && data.invitations.length > 0 ? (
        <SettingsGroup data-testid="space-invitations">
          {data.invitations.map((invitation) => {
            const date = expires(invitation.expiresAt);
            return (
              <SettingsRow
                key={invitation.id}
                label={<p className="break-words">{invitation.email ?? t`Invite link`}</p>}
                description={t`Expires ${date}`}
                control={
                  <Button
                    variant="ghost"
                    size="sm"
                    className="rounded-full"
                    disabled={busy}
                    onClick={() =>
                      void run(() => rpc.spaces.invites.revoke({ invitationId: invitation.id }))
                    }
                  >
                    {t`Revoke`}
                  </Button>
                }
              />
            );
          })}
        </SettingsGroup>
      ) : null}

      {error ? (
        <p role="alert" className="text-[13px] text-destructive">
          {error}
        </p>
      ) : null}

      {data.role !== "owner" ? (
        <Button
          variant="destructive"
          className="rounded-full"
          disabled={busy}
          onClick={() => setLeaving(true)}
        >
          {t`Leave space`}
        </Button>
      ) : null}
      <AlertDialog open={leaving} onOpenChange={(open) => !open && setLeaving(false)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{t`Leave ${space}?`}</AlertDialogTitle>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>{t`Cancel`}</AlertDialogCancel>
            <AlertDialogAction
              variant="destructive"
              disabled={busy}
              onClick={() =>
                void run(async () => {
                  await rpc.spaces.members.leave();
                  setLeaving(false);
                  onLeft?.();
                  return undefined;
                })
              }
            >
              {t`Leave`}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
