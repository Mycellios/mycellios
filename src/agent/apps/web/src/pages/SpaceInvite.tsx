import { useLingui } from "@lingui/react/macro";
import type { SpaceInvitePreview } from "@mycellios/contracts";
import { SpaceInviteTokenSchema } from "@mycellios/contracts";
import { Button } from "@mycellios/ui-web";
import type { ReactNode } from "react";
import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { LoadingSkeleton } from "../components/LoadingSkeleton";
import { rpc } from "../lib/rpc";
import { spaceLabel } from "../lib/space-label";
import { errorText } from "../lib/user-error";

const PENDING_INVITE_KEY = "mycellios:space-invite";

function tabStorage(): Storage | undefined {
  try {
    return window.sessionStorage;
  } catch {
    return undefined;
  }
}

/**
 * The invitation token. It travels in the link's fragment, which no server sees; it is kept in
 * this tab only while the person signs in, so the fragment can leave the address bar at once.
 */
export function takeInviteToken(hash: string, storage = tabStorage()): string | null {
  const fromLink = hash.replace(/^#/, "");
  try {
    if (SpaceInviteTokenSchema.safeParse(fromLink).success) {
      storage?.setItem(PENDING_INVITE_KEY, fromLink);
      return fromLink;
    }
    const kept = storage?.getItem(PENDING_INVITE_KEY) ?? null;
    return kept && SpaceInviteTokenSchema.safeParse(kept).success ? kept : null;
  } catch {
    return SpaceInviteTokenSchema.safeParse(fromLink).success ? fromLink : null;
  }
}

export function forgetInviteToken(storage = tabStorage()): void {
  try {
    storage?.removeItem(PENDING_INVITE_KEY);
  } catch {
    // Nothing kept.
  }
}

/** Where a joined Space opens: its people, since nothing is shared in it yet. */
export function joinedSpacePath(spaceId: string): string {
  return `/app?${new URLSearchParams({ settings: "space-members", space: spaceId })}`;
}

/** Opens an invitation to someone's Space (specs/space-members) and joins it on request. */
export function SpaceInvitePage({ signedIn }: { signedIn: boolean }) {
  const { t } = useLingui();
  const navigate = useNavigate();
  const [token] = useState(() => takeInviteToken(window.location.hash));
  const [preview, setPreview] = useState<SpaceInvitePreview | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [joining, setJoining] = useState(false);

  useEffect(() => {
    if (window.location.hash)
      window.history.replaceState(
        window.history.state,
        "",
        window.location.pathname + window.location.search,
      );
  }, []);

  useEffect(() => {
    if (!signedIn || !token) return;
    let current = true;
    // Asked without a Space, so the account's own Personal Space answers.
    rpc.spaces.invites.preview({ token }, { context: { spaceId: null } }).then(
      (value) => current && setPreview(value),
      (err: unknown) => current && setError(errorText(err)),
    );
    return () => {
      current = false;
    };
  }, [signedIn, token]);

  function leave(path = "/app") {
    forgetInviteToken();
    navigate(path, { replace: true });
  }

  async function join() {
    if (!token || joining) return;
    setJoining(true);
    setError(null);
    try {
      const joined = await rpc.spaces.invites.accept({ token }, { context: { spaceId: null } });
      leave(joinedSpacePath(joined.spaceId));
    } catch (err) {
      setError(errorText(err));
      setJoining(false);
    }
  }

  let content: ReactNode;
  if (!token) {
    content = (
      <>
        <p className="text-sm text-muted-foreground">{t`This invitation is no longer valid.`}</p>
        <Button onClick={() => leave(signedIn ? "/app" : "/sign-in")}>
          {signedIn ? t`Open` : t`Sign in`}
        </Button>
      </>
    );
  } else if (!signedIn) {
    content = (
      <>
        <p className="text-sm text-muted-foreground">{t`Sign in to accept this invitation.`}</p>
        <Button onClick={() => navigate("/sign-in?next=join")}>{t`Sign in`}</Button>
      </>
    );
  } else if (error && !preview) {
    content = (
      <>
        <p role="alert" className="text-sm text-destructive">
          {error}
        </p>
        <Button variant="outline" onClick={() => leave()}>
          {t`Not now`}
        </Button>
      </>
    );
  } else if (!preview) {
    content = <LoadingSkeleton layout="detail" rows={1} />;
  } else {
    const space = spaceLabel(preview.spaceName);
    const inviter = preview.invitedBy || preview.ownerName;
    const owner = preview.ownerName;
    content = (
      <>
        <h1 className="text-xl font-medium break-words">{space}</h1>
        {preview.member ? (
          <>
            <p className="text-sm text-muted-foreground">{t`You are already in this space.`}</p>
            <Button onClick={() => leave(joinedSpacePath(preview.spaceId))}>{t`Open`}</Button>
          </>
        ) : (
          <>
            {inviter ? (
              <p className="text-sm text-muted-foreground break-words">{t`Invited by ${inviter}`}</p>
            ) : null}
            {/* Members' turns run on the owner's Credits, so the owner can open them (spec). */}
            {owner ? (
              <p className="text-sm text-muted-foreground break-words">
                {t`${owner} can read your conversations with their Micos.`}
              </p>
            ) : null}
            {error ? (
              <p role="alert" className="text-sm text-destructive">
                {error}
              </p>
            ) : null}
            <div className="flex justify-center gap-2">
              <Button disabled={joining} onClick={() => void join()}>
                {t`Join`}
              </Button>
              <Button variant="ghost" disabled={joining} onClick={() => leave()}>
                {t`Not now`}
              </Button>
            </div>
          </>
        )}
      </>
    );
  }

  return (
    <main
      data-testid="space-invite"
      className="grid h-dvh place-items-center bg-background p-6 text-center"
    >
      <div className="w-full max-w-sm space-y-4">{content}</div>
    </main>
  );
}
