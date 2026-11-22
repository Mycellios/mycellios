import { useLingui } from "@lingui/react/macro";
import { sidebarFolderTree } from "@mycellios/core";
import type { Bot, BotSection } from "@mycellios/contracts";
import {
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuSeparator,
  ContextMenuSub,
  ContextMenuSubContent,
  ContextMenuSubTrigger,
} from "@mycellios/ui-web";
import {
  Archive,
  Bell,
  BellDot,
  Check,
  Copy,
  Eraser,
  Folder,
  FolderPlus,
  MessageCirclePlus,
  Pencil,
  Pin,
  Trash2,
} from "lucide-react";

type ChatMenuTarget = Pick<Bot, "name" | "pinned" | "sectionId" | "unread">;

/** A roster row's context menu content; `onClose` serves the lazy-load error fallback. */
export function BotContextMenu({
  bot,
  onTogglePinned,
  sections,
  onMoveToSection,
  onCreateSection,
  onRenameSection,
  onToggleUnread,
  onEdit,
  onDuplicate,
  onClear,
  onArchive,
  onDelete,
  onNewConversation,
  onMarkAllRead,
  conversationsUnread = false,
}: {
  bot: ChatMenuTarget;
  onClose: () => void;
  onTogglePinned: () => void;
  sections: BotSection[];
  onMoveToSection: (sectionId: string | null) => void;
  onCreateSection: () => void;
  onRenameSection?: (sectionId: string) => void;
  onToggleUnread: () => void;
  onEdit: () => void;
  onDuplicate: () => void;
  onClear: () => void;
  onArchive: () => void;
  onDelete: () => void;
  /** Opens a draft conversation with this Mico; groups have none. */
  onNewConversation?: () => void;
  /** Reads the Mico's main chat and all of its conversations at once. */
  onMarkAllRead?: () => void;
  /** Only its conversations have unread replies; the main chat may be read. */
  conversationsUnread?: boolean;
}) {
  const { t } = useLingui();

  return (
    <ContextMenuContent
      aria-label={t`Actions for ${bot.name}`}
      className="max-h-[min(420px,calc(100vh-16px))] w-[264px] overflow-y-auto"
    >
      {onNewConversation ? (
        <>
          <ContextMenuItem onClick={onNewConversation}>
            <MessageCirclePlus />
            {t`New conversation`}
          </ContextMenuItem>
          <ContextMenuSeparator />
        </>
      ) : null}
      <ContextMenuItem onClick={onTogglePinned}>
        <Pin />
        {bot.pinned ? t`Unpin` : t`Pin`}
      </ContextMenuItem>
      <ContextMenuSub>
        <ContextMenuSubTrigger>
          <Folder />
          {t`Move to`}
        </ContextMenuSubTrigger>
        <ContextMenuSubContent className="max-h-[min(420px,calc(100vh-16px))] min-w-[180px] overflow-y-auto">
          {sidebarFolderTree(sections).map((section) => (
            <ContextMenuItem key={section.id} onClick={() => onMoveToSection(section.id)}>
              <Folder />
              <span dir="auto">{section.path}</span>
              {bot.sectionId === section.id ? <Check className="ms-auto" /> : null}
            </ContextMenuItem>
          ))}
          <ContextMenuItem onClick={() => onMoveToSection(null)}>
            <Folder />
            {t`Unassigned`}
            {bot.sectionId === null ? <Check className="ms-auto" /> : null}
          </ContextMenuItem>
          <ContextMenuSeparator />
          <ContextMenuItem onClick={onCreateSection}>
            <FolderPlus />
            {t`New folder`}
          </ContextMenuItem>
          {bot.sectionId && onRenameSection ? (
            <ContextMenuItem onClick={() => onRenameSection(bot.sectionId!)}>
              <Pencil />
              {t`Rename folder`}
            </ContextMenuItem>
          ) : null}
        </ContextMenuSubContent>
      </ContextMenuSub>
      {(bot.unread || conversationsUnread) && onMarkAllRead ? (
        <ContextMenuItem onClick={onMarkAllRead}>
          <BellDot />
          {t`Mark as Read`}
        </ContextMenuItem>
      ) : bot.unread ? (
        <ContextMenuItem onClick={onToggleUnread}>
          <BellDot />
          {t`Mark as Read`}
        </ContextMenuItem>
      ) : null}
      {!bot.unread ? (
        <ContextMenuItem onClick={onToggleUnread}>
          <Bell />
          {t`Mark as Unread`}
        </ContextMenuItem>
      ) : null}
      <ContextMenuSeparator />
      <ContextMenuItem onClick={onEdit}>
        <Pencil />
        {t`Edit Profile`}
      </ContextMenuItem>
      <ContextMenuItem onClick={onDuplicate}>
        <Copy />
        {t`Duplicate`}
      </ContextMenuItem>
      <ContextMenuSeparator />
      <ContextMenuItem onClick={onClear}>
        <Eraser />
        {t`Clear conversation`}
      </ContextMenuItem>
      <ContextMenuItem onClick={onArchive}>
        <Archive />
        {t`Archive`}
      </ContextMenuItem>
      <ContextMenuItem variant="destructive" onClick={onDelete}>
        <Trash2 />
        {t`Delete`}
      </ContextMenuItem>
    </ContextMenuContent>
  );
}
