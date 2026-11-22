import { Trans, useLingui } from "@lingui/react/macro";
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription,
  AlertDialogFooter, AlertDialogHeader, AlertDialogTitle, ContextMenuContent, ContextMenuItem, ContextMenuSeparator,
} from "@mycellios/ui-web";
import { Archive, ArrowLeftToLine, ArrowRightToLine, ArchiveRestore, MessageCircle, Pencil, Trash2, X } from "lucide-react";

export type ThreadMenuActions = {
  onOpen?: () => void;
  onClose?: () => void;
  onCloseOthers?: () => void;
  onCloseToRight?: () => void;
  onRename?: () => void;
  onArchive?: () => void;
  onRestore?: () => void;
  onDelete?: () => void;
  /** Delete waits until the conversation stops working. */
  deleteDisabled?: boolean;
  busy?: boolean;
};

/**
 * The actions of one conversation: its tab first (open, close, close others, close to the
 * right), then the conversation itself. Only actions that are passed show, so the main chat
 * offers the close actions only.
 */
export function ThreadMenu({ label, ...actions }: ThreadMenuActions & { label: string }) {
  const { t } = useLingui();
  const tabActions = actions.onOpen || actions.onClose || actions.onCloseOthers || actions.onCloseToRight;
  const threadActions = actions.onRename || actions.onArchive || actions.onRestore || actions.onDelete;
  return <ContextMenuContent aria-label={label} className="w-60">
    {actions.onOpen ? <ContextMenuItem onClick={actions.onOpen}><MessageCircle aria-hidden="true" /><Trans>Open</Trans></ContextMenuItem> : null}
    {actions.onClose ? <ContextMenuItem onClick={actions.onClose}><X aria-hidden="true" /><Trans>Close tab</Trans></ContextMenuItem> : null}
    {actions.onCloseOthers ? <ContextMenuItem onClick={actions.onCloseOthers}><ArrowLeftToLine aria-hidden="true" /><Trans>Close other tabs</Trans></ContextMenuItem> : null}
    {actions.onCloseToRight ? <ContextMenuItem onClick={actions.onCloseToRight}><ArrowRightToLine aria-hidden="true" /><Trans>Close tabs to the right</Trans></ContextMenuItem> : null}
    {tabActions && threadActions ? <ContextMenuSeparator /> : null}
    {actions.onRename ? <ContextMenuItem disabled={actions.busy} onClick={actions.onRename}><Pencil aria-hidden="true" /><Trans>Rename conversation</Trans></ContextMenuItem> : null}
    {actions.onRestore ? <ContextMenuItem disabled={actions.busy} onClick={actions.onRestore}><ArchiveRestore aria-hidden="true" /><Trans>Restore</Trans></ContextMenuItem> : null}
    {actions.onArchive ? <ContextMenuItem disabled={actions.busy} onClick={actions.onArchive}><Archive aria-hidden="true" /><Trans>Archive</Trans></ContextMenuItem> : null}
    {actions.onDelete ? <ContextMenuItem variant="destructive" disabled={actions.busy || actions.deleteDisabled}
      title={actions.deleteDisabled ? t`Stop this conversation before you delete it.` : undefined}
      onClick={actions.onDelete}><Trash2 aria-hidden="true" /><Trans>Delete</Trans></ContextMenuItem> : null}
  </ContextMenuContent>;
}

/** On a phone a delete cannot be undone from a toast, so it asks first. */
export function DeleteConversationDialog({ title, open, onCancel, onConfirm }: {
  title: string; open: boolean; onCancel: () => void; onConfirm: () => void;
}) {
  return <AlertDialog open={open} onOpenChange={value => { if (!value) onCancel(); }}>
    <AlertDialogContent>
      <AlertDialogHeader>
        <AlertDialogTitle><Trans>Delete this conversation?</Trans></AlertDialogTitle>
        <AlertDialogDescription>
          <Trans>“{title}” and its messages, and the files made only there, are removed for good. The main chat stays as it is.</Trans>
        </AlertDialogDescription>
      </AlertDialogHeader>
      <AlertDialogFooter>
        <AlertDialogCancel><Trans>Cancel</Trans></AlertDialogCancel>
        <AlertDialogAction variant="destructive" onClick={onConfirm}><Trans>Delete</Trans></AlertDialogAction>
      </AlertDialogFooter>
    </AlertDialogContent>
  </AlertDialog>;
}
