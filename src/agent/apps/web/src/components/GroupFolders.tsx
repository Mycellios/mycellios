import { Trans, useLingui } from "@lingui/react/macro";
import type { Bot, DesktopGroupFolder, Group, GroupFolder } from "@mycellios/contracts";
import { GROUP_FOLDER_MAX } from "@mycellios/contracts";
import { Button } from "@mycellios/ui-web";
import { Folder, FolderPlus, X } from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";
import { desktopBridge } from "../lib/desktop";
import type { RpcClient } from "../lib/rpc";
import { errorText } from "../lib/user-error";

/**
 * Group settings → Folders (specs/group-shared-folders/spec.md). Folders are chosen with the
 * Desktop's own folder picker; the server only keeps their ids and names. The list says which
 * members can use them: only Micos on This PC, on the PC where the folder was added.
 */
export function GroupFolders({
  groupId,
  members,
  bots,
  rpc,
}: {
  groupId: string;
  members: Group["members"];
  bots: Bot[];
  rpc: Pick<RpcClient, "groups">;
}) {
  const { t } = useLingui();
  const computer = desktopBridge()?.computer;
  const [folders, setFolders] = useState<GroupFolder[] | null>(null);
  const [onPc, setOnPc] = useState<DesktopGroupFolder[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const alive = useRef(true);
  useEffect(() => {
    alive.current = true;
    return () => {
      alive.current = false;
    };
  }, []);

  const load = useCallback(async () => {
    const [listed, granted] = await Promise.all([
      rpc.groups.folders({ groupId }),
      computer?.groupFolders?.(groupId).catch(() => []) ?? Promise.resolve([]),
    ]);
    if (!alive.current) return;
    setFolders(listed.folders);
    setOnPc(granted);
  }, [computer, groupId, rpc]);

  useEffect(() => {
    setFolders(null);
    setOnPc([]);
    void load().catch(() => {
      if (alive.current) setFolders([]);
    });
  }, [load]);

  async function change(action: () => Promise<void>) {
    if (busy) return;
    setBusy(true);
    setError("");
    try {
      await action();
      await load();
    } catch (cause) {
      if (alive.current) setError(errorText(cause, t`Could not continue`));
    } finally {
      if (alive.current) setBusy(false);
    }
  }

  async function add(folderId?: string) {
    await change(async () => {
      if (!computer?.chooseGroupFolder || !(await computer.requestAccess())) return;
      const chosen = await computer.chooseGroupFolder(groupId, folderId);
      if (!chosen) return;
      try {
        await rpc.groups.addFolder({ groupId, folderId: chosen.folderId, name: chosen.name });
      } catch (cause) {
        // A folder the group did not keep must not stay granted on this PC.
        if (!folderId)
          await computer.removeGroupFolder?.(groupId, chosen.folderId).catch(() => undefined);
        throw cause;
      }
    });
  }

  async function remove(folder: GroupFolder) {
    await change(async () => {
      await rpc.groups.removeFolder({ groupId, folderId: folder.folderId });
      await computer?.removeGroupFolder?.(groupId, folder.folderId).catch(() => undefined);
    });
  }

  if (!folders) return null;
  const canChoose = Boolean(computer?.chooseGroupFolder);
  const full = folders.length >= GROUP_FOLDER_MAX;
  const named = members.map((member) => ({
    name: member.name,
    thisPc: bots.find((bot) => bot.id === member.botId)?.computerMode === "dedicated",
  }));
  const reach = named
    .filter((member) => member.thisPc)
    .map((member) => member.name)
    .join(", ");
  const away = named
    .filter((member) => !member.thisPc)
    .map((member) => member.name)
    .join(", ");

  return (
    <section className="mt-6 border-t pt-4" aria-labelledby={`group-folders-${groupId}`}>
      <div className="flex items-center justify-between gap-2">
        <h3 id={`group-folders-${groupId}`} className="text-sm text-muted-foreground">
          <Trans>Folders</Trans>
        </h3>
        <span className="text-xs text-muted-foreground">
          {folders.length}/{GROUP_FOLDER_MAX}
        </span>
      </div>
      <p className="mt-1 text-xs text-muted-foreground">
        <Trans>
          Micos of this group on This PC can change files and run commands in these folders.
        </Trans>
      </p>
      {folders.length ? (
        <ul className="mt-3 space-y-2">
          {folders.map((folder) => {
            const here = onPc.find((item) => item.folderId === folder.folderId);
            return (
              <li key={folder.folderId} className="flex min-w-0 items-center gap-2 text-sm">
                <Folder size={15} aria-hidden="true" className="shrink-0 text-muted-foreground" />
                <span className="min-w-0 flex-1">
                  <span className="block truncate" title={here?.path ?? folder.label}>
                    {folder.label}
                  </span>
                  {canChoose && !here ? (
                    <span className="block text-xs text-muted-foreground">
                      <Trans>Not connected on this PC</Trans>
                    </span>
                  ) : null}
                </span>
                {canChoose && !here ? (
                  <Button
                    size="sm"
                    variant="secondary"
                    disabled={busy}
                    onClick={() => void add(folder.folderId)}
                  >
                    <Trans>Connect</Trans>
                  </Button>
                ) : null}
                <Button
                  size="icon-sm"
                  variant="ghost"
                  disabled={busy}
                  aria-label={t`Remove ${folder.label}`}
                  onClick={() => void remove(folder)}
                >
                  <X size={15} aria-hidden="true" />
                </Button>
              </li>
            );
          })}
        </ul>
      ) : null}
      {canChoose ? (
        <Button
          variant="secondary"
          size="sm"
          className="mt-3"
          disabled={busy || full}
          onClick={() => void add()}
        >
          <FolderPlus size={15} aria-hidden="true" />
          <Trans>Add folder</Trans>
        </Button>
      ) : (
        <p className="mt-3 text-xs text-muted-foreground">
          <Trans>Add folders from Mycellios Desktop.</Trans>
        </p>
      )}
      {folders.length ? (
        <div className="mt-3 space-y-1 text-xs text-muted-foreground">
          {reach ? (
            <p>
              <Trans>Can use them: {reach}</Trans>
            </p>
          ) : null}
          {away ? (
            <p>
              <Trans>Can't reach them (not on This PC): {away}</Trans>
            </p>
          ) : null}
        </div>
      ) : null}
      {error ? (
        <p role="alert" className="mt-2 break-words text-sm text-destructive">
          {error}
        </p>
      ) : null}
    </section>
  );
}
