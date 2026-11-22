import { useGeneralPreferences } from "../../lib/general-preferences";
import { orderSidebarChats } from "../../lib/sidebar-chat-order";
import { filterSidebarGroups, sidebarFilterActive, useSidebarFilter, writeSidebarFilter, EMPTY_SIDEBAR_FILTER } from "../../lib/sidebar-filter";
import { micoConversationScope, setMicoConversationsOpen, useOpenMicoConversations, useSidebarConversationRows } from "../../lib/sidebar-conversations";
import { useConversationRows } from "../../lib/thread-tabs";
import { type RpcClient, rpcForSpace } from "../../lib/rpc";
import { HoverConversations, SidebarMicoConversations } from "../../components/SidebarMicoConversations";
import { i18n } from "@lingui/core";
import { t } from "@lingui/core/macro";
import { Trans, useLingui } from "@lingui/react/macro";
import type { Bot, BotSection, Group, Me, Space, ThreadSnapshot } from "@mycellios/contracts";
import { assertSidebarFolderParent, sidebarFolderTree } from "@mycellios/core";
import {
  BotAvatar,
  Button,
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
  ContextMenu,
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuSub,
  ContextMenuSubContent,
  ContextMenuSubTrigger,
  ContextMenuTrigger,
  GroupAvatar,
} from "@mycellios/ui-web";
import { Check, ChevronDown, ChevronRight, CircleAlert, Folder, FolderOpen, FolderPlus, Lock, MoreHorizontal, Pencil, Trash2 } from "lucide-react";
import type { Dispatch, ReactNode, RefObject, SetStateAction } from "react";
import { Fragment, Suspense, useMemo, useState } from "react";
import { IconTooltip } from "../../components/IconTooltip";
import { RosterReplyIndicator } from "../../components/RosterReplyIndicator";
import { RosterMessagePreview } from "../../components/RosterMessagePreview";
import type { BotsSidebarDensity } from "../../lib/bots-sidebar-density-pref";
import {
  compactRosterStatusLabel,
  rosterConversationStatusLabel,
  rosterHasUndismissedRunError,
  rosterWorkStatusLabel,
  unreadBadgeText,
} from "../../lib/roster-status";
import type { RosterDropAction, RosterDropTarget } from "./roster-drop";
import type { sidebarGroupsForSpaces } from "./space-sidebar";

export function SidebarRoster({
  sidebarGroups,
  collapsedSidebarSections,
  bootstrapMe,
  botSections,
  spaces,
  rosterDropKey,
  setRosterDropKey,
  rosterDropAction,
  applyRosterDrop,
  openSpaceChat,
  spaceMenuAnchor,
  setSpaceMenu,
  setRenameSectionTarget,
  setDeleteSectionTarget,
  onCreateFolder,
  onMoveFolder,
  toggleSidebarSection,
  inGroup,
  active,
  activeGroup,
  botsSidebarDensity,
  dismissedRunErrorIds,
  displayedRunError,
  draggedBotId,
  setDraggedBotId,
  botMenu,
  setBotMenu,
  reorderRosterBot,
  activeSnapshot,
  botMenuContent,
  mini = false,
  mobile = false,
  activeSpaceId,
  userId,
  activeThreadId,
  onOpenConversation,
  conversationClient = rpcForSpace,
}: {
  sidebarGroups: ReturnType<
    typeof sidebarGroupsForSpaces<Space["bots"][number], Space["groups"][number]>
  >;
  collapsedSidebarSections: ReadonlySet<string>;
  bootstrapMe: Pick<Me, "spaceId"> | null | undefined;
  botSections: BotSection[];
  spaces: Space[];
  rosterDropKey: string | null;
  setRosterDropKey: (key: string | null) => void;
  rosterDropAction: (target: RosterDropTarget, sameList: boolean) => RosterDropAction | null;
  applyRosterDrop: (target: RosterDropTarget, sameList: boolean, botIds: string[]) => void;
  openSpaceChat: (spaceId: string, path: string) => void;
  spaceMenuAnchor: RefObject<HTMLElement | null>;
  setSpaceMenu: (menu: { id: string; position: { x: number; y: number } }) => void;
  setRenameSectionTarget: (target: { section: BotSection; spaceId: string }) => void;
  setDeleteSectionTarget: (target: { section: BotSection; spaceId: string }) => void;
  onCreateFolder: (parentId: string | null, spaceId: string) => void;
  onMoveFolder: (section: BotSection, parentId: string | null, spaceId: string) => void;
  toggleSidebarSection: (key: string) => void;
  inGroup: boolean;
  active: Pick<Bot, "id"> | undefined;
  activeGroup: Pick<Group, "id"> | undefined;
  botsSidebarDensity: BotsSidebarDensity;
  dismissedRunErrorIds: ReadonlySet<string>;
  displayedRunError: string | null;
  draggedBotId: string | null;
  setDraggedBotId: (id: string | null) => void;
  botMenu: { kind: "bot" | "group"; id: string } | null;
  setBotMenu: Dispatch<SetStateAction<{ kind: "bot" | "group"; id: string } | null>>;
  reorderRosterBot: (sourceId: string, targetId: string, groupBotIds: string[]) => void;
  activeSnapshot: ThreadSnapshot | null;
  botMenuContent: ReactNode;
  mini?: boolean;
  mobile?: boolean;
  activeSpaceId?: string | null;
  /** Keys the conversation lists shared with each Mico's tabs. */
  userId?: string;
  /** The conversation open in the chat, marked in its Mico's expanded list. */
  activeThreadId?: string;
  /** Opens one of a Mico's conversations in the chat. */
  onOpenConversation?: (spaceId: string, botId: string, threadId: string) => void;
  /** Reads an expanded Mico's conversations in its own Space. */
  conversationClient?: (spaceId: string) => Pick<RpcClient, "development">;
}) {
  const { t } = useLingui();
  const { sidebarChatOrder } = useGeneralPreferences();
  const folderTrees = useMemo(() => {
    const trees = new Map(spaces.map(space => [space.id, sidebarFolderTree(space.botSections)] as const));
    if (bootstrapMe?.spaceId) trees.set(bootstrapMe.spaceId, sidebarFolderTree(botSections));
    return trees;
  }, [spaces, botSections, bootstrapMe?.spaceId]);
  const sidebarFilter = useSidebarFilter();
  const openMicos = useOpenMicoConversations();
  const allFolders = useMemo(() => [...folderTrees.values()].flat(), [folderTrees]);
  const filtering = !mini && sidebarFilterActive(sidebarFilter);
  const orderedChats = orderSidebarChats(sidebarGroups, sidebarChatOrder, t`Unread`);
  const allGroups = filtering ? filterSidebarGroups(orderedChats, sidebarFilter, allFolders) : orderedChats;
  const orderedGroups = allGroups.filter(group => mini || filtering || !group.ancestorKeys.some(key => collapsedSidebarSections.has(key)));
  const conversationsOf = (spaceId: string, botId: string, threadId: string) => onOpenConversation?.(spaceId, botId, threadId);
  return (
    <>
      {filtering && orderedGroups.every(group => group.bots.length === 0) ? (
        <div data-testid="sidebar-filter-empty" className="flex flex-col items-center gap-2 px-3 py-6 text-center text-sm text-muted-foreground">
          <p>{t`No chats match these filters`}</p>
          <Button size="sm" variant="secondary" onClick={() => writeSidebarFilter(EMPTY_SIDEBAR_FILTER)}>{t`Clear filters`}</Button>
        </div>
      ) : null}
      {orderedGroups.map((group, groupIndex) => {
        // A filter shows its matches even inside closed folders.
        const collapsed = !filtering && Boolean(group.title) && collapsedSidebarSections.has(group.key);
        const currentMobileSpace = mobile && group.spaceId === activeSpaceId;
        const title = currentMobileSpace
          ? group.subtitle ?? (group.title === group.spaceName && !group.emptySpaceId ? t`Micos` : group.title)
          : group.title;
        const subtitle = currentMobileSpace ? undefined : group.subtitle;
        const groupBotIds = group.bots.flatMap((item) =>
          item.kind === "bot" ? [item.chat.id] : [],
        );
        const hasSpaceActions = group.canOpenSpaceSettings;
        const headerDropTarget: RosterDropTarget | null =
          sidebarChatOrder === "manual" && group.spaceId === bootstrapMe?.spaceId &&
          !group.emptySpaceId &&
          (group.sectionId || group.key.endsWith("unassigned"))
            ? { kind: "section", sectionId: group.sectionId }
            : null;
        const headerDropKey = `header:${group.key}`;
        const section = group.sectionId
          ? (group.spaceId === bootstrapMe?.spaceId
              ? botSections
              : (spaces.find((space) => space.id === group.spaceId)?.botSections ?? [])
            ).find((item) => item.id === group.sectionId)
          : undefined;
        const folders = folderTrees.get(group.spaceId) ?? [];
        const folderDepth = folders.find(folder => folder.id === section?.id)?.depth ?? 0;
        const destinations = section ? [null, ...folders].filter(parent => {
          try { assertSidebarFolderParent(folders, section.id, parent?.id ?? null); return true; } catch { return false; }
        }) : [];
        const unread = section ? allGroups.filter(item => item.key === group.key || item.ancestorKeys.includes(group.key))
          .reduce((count,item) => count + item.bots.filter(row => row.chat.unread).length,0) : 0;
        return (
          <Collapsible
            key={group.key}
            open={mini || !collapsed}
            onOpenChange={() => {
              if (!mini) toggleSidebarSection(group.key);
            }}
            data-sidebar-group={group.key}
            className={`flex flex-col gap-0.5 ${mini && groupIndex > 0 ? "mt-2 border-t border-sidebar-border pt-2" : ""}`}
          >
            {!mini && (group.title || hasSpaceActions) ? (
              // biome-ignore lint/a11y/useSemanticElements: groups sidebar controls, not form fields; Move to remains the keyboard alternative.
              <div
                role="group"
                data-roster-drop={rosterDropKey === headerDropKey ? "true" : undefined}
                className={`${
                  group.title && hasSpaceActions
                    ? "grid"
                    : `flex items-center${group.title ? "" : " justify-end"}`
                } sticky top-0 z-10 pb-0.5 ${section ? folderDepth > 0 ? "pt-0" : "pt-2" : "pt-3"} ${mobile ? "" : "rounded-lg"} ${rosterDropKey === headerDropKey ? "bg-sidebar-accent" : mobile ? "bg-background" : "bg-sidebar"}`}
                onDragOver={(event) => {
                  if (!headerDropTarget || !rosterDropAction(headerDropTarget, false)) return;
                  event.preventDefault();
                  event.dataTransfer.dropEffect = "move";
                  if (rosterDropKey !== headerDropKey) setRosterDropKey(headerDropKey);
                }}
                onDragLeave={() => {
                  if (rosterDropKey === headerDropKey) setRosterDropKey(null);
                }}
                onDrop={(event) => {
                  if (!headerDropTarget) return;
                  event.preventDefault();
                  applyRosterDrop(headerDropTarget, false, groupBotIds);
                }}
              >
                {group.title ? (
                  // Prefer the section menu over the space menu when both apply;
                  // the dedicated space-actions button still opens the space menu.
                  <ContextMenu disabled={!section}>
                    <ContextMenuTrigger
                      render={
                        group.emptySpaceId ? <button type="button" /> : <CollapsibleTrigger />
                      }
                      className={`flex min-w-0 items-center gap-2 rounded-lg px-2.5 ${mobile ? "min-h-10 justify-start text-[13px] font-semibold tracking-tight text-muted-foreground" : `justify-between py-1 text-xs ${section ? "font-medium text-foreground" : "font-normal text-muted-foreground"}`} ${hasSpaceActions ? "col-start-1 row-start-1 w-full" : "flex-1"}`}
                      onClick={() => {
                        if (group.emptySpaceId) {
                          openSpaceChat(group.emptySpaceId, "/onboarding");
                        }
                      }}
                      onContextMenu={
                        section
                          ? (event) => event.currentTarget.focus()
                          : hasSpaceActions
                            ? (event) => {
                                event.preventDefault();
                                spaceMenuAnchor.current = event.currentTarget;
                                setSpaceMenu({
                                  id: group.spaceId,
                                  position: { x: event.clientX, y: event.clientY },
                                });
                              }
                            : undefined
                      }
                      aria-label={
                        group.emptySpaceId
                          ? t`Open ${headerName({ title, subtitle })}`
                          : collapsed
                            ? t`Expand ${headerName({ title, subtitle })}`
                            : t`Collapse ${headerName({ title, subtitle })}`
                      }
                    >
                      <span
                        className={`flex min-w-0 items-center gap-1.5 truncate ${hasSpaceActions ? "pe-7" : ""}`}
                      >
                        {group.showLock && !currentMobileSpace ? (
                          <Lock size={11} strokeWidth={2} aria-hidden="true" />
                        ) : null}
                        <span className="truncate">{title}</span>
                        {subtitle ? (
                          <span className="ms-0.5 truncate text-muted-foreground">
                            {subtitle}
                          </span>
                        ) : null}
                      </span>
                      {section ? <span className="ms-auto flex shrink-0 items-center gap-1.5 text-muted-foreground">
                        {collapsed && unread > 0 ? <span className="text-[11px] tabular-nums">{unread}</span> : null}
                        {collapsed ? <Folder size={14} aria-hidden="true" /> : <FolderOpen size={14} aria-hidden="true" />}
                      </span> : group.emptySpaceId ? null : (
                        <ChevronDown
                          size={14}
                          strokeWidth={1.8}
                          className={
                            collapsed ? "-rotate-90 transition-transform" : "transition-transform"
                          }
                          aria-hidden="true"
                        />
                      )}
                    </ContextMenuTrigger>
                    {section ? (
                      <ContextMenuContent
                        aria-label={t`Actions for ${section.name}`}
                        className="w-[220px]"
                      >
                        <ContextMenuItem disabled={folderDepth >= 2} onClick={() => onCreateFolder(section.id, group.spaceId)}>
                          <FolderPlus />{t`New folder inside`}
                        </ContextMenuItem>
                        <ContextMenuSub>
                          <ContextMenuSubTrigger><Folder />{t`Move to`}</ContextMenuSubTrigger>
                          <ContextMenuSubContent className="max-h-72 min-w-48 overflow-y-auto">
                            {destinations.map(parent => <ContextMenuItem key={parent?.id ?? "root"} onClick={() => onMoveFolder(section, parent?.id ?? null, group.spaceId)}>
                              <span>{parent?.path ?? t`Top level`}</span>
                              {(section.parentId ?? null) === (parent?.id ?? null) ? <Check className="ms-auto" /> : null}
                            </ContextMenuItem>)}
                          </ContextMenuSubContent>
                        </ContextMenuSub>
                        <ContextMenuItem
                          onClick={() =>
                            setRenameSectionTarget({ section, spaceId: group.spaceId })
                          }
                        >
                          <Pencil />
                          {t`Rename folder`}
                        </ContextMenuItem>
                        <ContextMenuItem
                          variant="destructive"
                          onClick={() =>
                            setDeleteSectionTarget({ section, spaceId: group.spaceId })
                          }
                        >
                          <Trash2 />
                          {t`Delete folder`}
                        </ContextMenuItem>
                      </ContextMenuContent>
                    ) : null}
                  </ContextMenu>
                ) : null}
                {hasSpaceActions ? (
                  <Button
                    variant="ghost"
                    size="icon-sm"
                    className={
                      group.title
                        ? `col-start-1 row-start-1 justify-self-end self-center ${mobile ? "size-11" : group.emptySpaceId ? "" : "me-6"}`
                        : undefined
                    }
                    aria-label={t`Actions for ${group.spaceName}`}
                    onClick={(event) => {
                      const rect = event.currentTarget.getBoundingClientRect();
                      spaceMenuAnchor.current = event.currentTarget;
                      setSpaceMenu({
                        id: group.spaceId,
                        position: { x: rect.left, y: rect.bottom },
                      });
                    }}
                  >
                    <MoreHorizontal size={14} aria-hidden="true" />
                  </Button>
                ) : null}
              </div>
            ) : null}
            <CollapsibleContent className="flex flex-col gap-0.5">
              {mobile && group.sectionId && group.bots.length === 0 && !allGroups.some(item => item.ancestorKeys.includes(group.key)) ? (
                <p className="px-2.5 pb-2 text-sm text-muted-foreground">{t`No chats in this folder`}</p>
              ) : null}
              {group.bots.map((item) => {
                const selected =
                  (item.kind === "bot" && !inGroup && active?.id === item.chat.id) ||
                  (item.kind === "group" && inGroup && activeGroup?.id === item.chat.id);
                const compact = !mobile && botsSidebarDensity === "compact";
                const workStatusLabel =
                  item.kind === "bot" ? rosterWorkStatusLabel(item.chat.status) : null;
                // The main chat is idle but a conversation waits or works: say so in its place.
                const conversationLabel =
                  item.kind === "bot" ? rosterConversationStatusLabel(item.chat) : null;
                const conversationCount = item.kind === "bot" ? (item.chat.conversations?.open ?? 0) : 0;
                const conversationWaiting = item.kind === "bot" && (item.chat.conversations?.waiting ?? 0) > 0;
                const expandable = item.kind === "bot" && !mini && !mobile && conversationCount > 0;
                const expanded = expandable && openMicos.includes(item.chat.id);
                const unreadText = item.chat.unread && item.kind === "bot" ? unreadBadgeText(item.chat.unreadCount) : null;
                const conversationUnread = item.kind === "bot" && !item.chat.unread && (item.chat.conversations?.unread ?? 0) > 0;
                const rowError =
                  item.kind === "bot" &&
                  (rosterHasUndismissedRunError(item.chat.runErrorId, dismissedRunErrorIds) ||
                    (active?.id === item.chat.id && Boolean(displayedRunError)));
                const compactStatusLabel =
                  (compact || mini) && item.kind === "bot"
                    ? rowError
                      ? t`Error`
                      : (compactRosterStatusLabel(item.chat.status) ?? conversationLabel)
                    : null;
                const rosterLine = compact
                  ? compactStatusLabel
                  : (workStatusLabel ?? conversationLabel ??
                    (item.kind === "bot"
                      ? item.chat.preview || (item.chat.status !== "idle" ? item.chat.status : "")
                      : item.chat.preview ||
                        item.chat.members.map((member) => member.name).join(", ")));
                const rowDropTarget: RosterDropTarget | null =
                  item.chat.spaceId !== bootstrapMe?.spaceId
                    ? null
                    : item.kind === "bot"
                      ? { kind: "bot", chat: item.chat }
                      : {
                          kind: "group",
                          chat: {
                            id: item.chat.id,
                            memberIds: item.chat.members.map((member) => member.botId),
                          },
                        };
                const rowSameList =
                  Boolean(draggedBotId) && groupBotIds.includes(draggedBotId ?? "");
                const rowDropKey = `row:${item.kind}:${item.chat.id}`;
                const avatar =
                  item.kind === "bot" ? (
                    <BotAvatar
                      color={item.chat.color}
                      identity={item.chat.id}
                      size={mini ? 46 : compact ? 38 : mobile ? 46 : 52}
                      status={item.chat.status}
                      unread={Boolean(item.chat.unread)}
                    />
                  ) : (
                    <GroupAvatar
                      members={
                        item.chat.id === activeSnapshot?.groupId
                          ? (activeSnapshot.members ?? item.chat.members)
                          : item.chat.members
                      }
                      size={mini ? 40 : compact ? 28 : 38}
                    />
                  );
                const chatTrigger = (
                  <ContextMenuTrigger
                    render={<button type="button" />}
                    draggable={item.kind === "bot" && sidebarChatOrder === "manual"}
                    data-mico-avatar-hover=""
                    data-roster-bot-id={item.kind === "bot" ? item.chat.id : undefined}
                    data-roster-unread={item.chat.unread ? "true" : undefined}
                    data-roster-error={rowError && (compact || mini) ? "true" : undefined}
                    aria-current={selected ? "page" : undefined}
                    aria-label={mini ? item.chat.name : undefined}
                    aria-describedby={
                      mini
                        ? [
                            item.chat.unread ? `roster-unread-${item.kind}-${item.chat.id}` : null,
                            compactStatusLabel
                              ? `roster-status-${item.kind}-${item.chat.id}`
                              : null,
                          ]
                            .filter(Boolean)
                            .join(" ") || undefined
                        : undefined
                    }
                    aria-keyshortcuts={
                      item.kind === "bot" && sidebarChatOrder === "manual" ? "Alt+ArrowUp Alt+ArrowDown" : undefined
                    }
                    onDragStart={(event) => {
                      if (item.kind !== "bot" || sidebarChatOrder !== "manual") { event.preventDefault(); return; }
                      setDraggedBotId(item.chat.id);
                      event.dataTransfer.effectAllowed = "move";
                      event.dataTransfer.setData("text/plain", item.chat.id);
                    }}
                    onDragOver={(event) => {
                      if (!rowDropTarget || !rosterDropAction(rowDropTarget, rowSameList)) return;
                      event.preventDefault();
                      event.dataTransfer.dropEffect = "move";
                      if (rosterDropKey !== rowDropKey) setRosterDropKey(rowDropKey);
                    }}
                    onDragLeave={() => {
                      if (rosterDropKey === rowDropKey) setRosterDropKey(null);
                    }}
                    onDrop={(event) => {
                      if (!rowDropTarget) return;
                      event.preventDefault();
                      applyRosterDrop(rowDropTarget, rowSameList, groupBotIds);
                    }}
                    onDragEnd={() => {
                      setDraggedBotId(null);
                      setRosterDropKey(null);
                    }}
                    data-roster-drop={rosterDropKey === rowDropKey ? "true" : undefined}
                    onKeyDown={(event) => {
                      if (
                        sidebarChatOrder !== "manual" ||
                        item.kind !== "bot" ||
                        !event.altKey ||
                        // Alt+Shift+arrows move between a Mico's conversations.
                        event.shiftKey ||
                        (event.key !== "ArrowUp" && event.key !== "ArrowDown")
                      )
                        return;
                      const siblings = groupBotIds;
                      const index = siblings.indexOf(item.chat.id);
                      const target = siblings[index + (event.key === "ArrowUp" ? -1 : 1)];
                      if (!target) return;
                      event.preventDefault();
                      reorderRosterBot(item.chat.id, target, groupBotIds);
                    }}
                    onClick={() => {
                      const params = new URLSearchParams();
                      if (item.kind === "bot" && item.chat.status === "waiting_input") {
                        params.set("respond", "1");
                        if (item.chat.waitingTaskThreadId) params.set("task", item.chat.waitingTaskThreadId);
                      }
                      openSpaceChat(
                        item.chat.spaceId,
                        item.kind === "bot" ? `/app/${item.chat.id}${params.size ? `?${params}` : ""}` : `/app/g/${item.chat.id}`,
                      );
                    }}
                    // Focus the row so closing the menu returns focus here.
                    onContextMenu={(event) => event.currentTarget.focus()}
                    className={`flex items-center ${
                      mini
                        ? "mx-auto size-12 justify-center rounded-xl"
                        : compact
                          ? "w-full min-h-11 gap-2 rounded-xl px-2.5 py-1.5"
                          : mobile ? "w-full min-h-[62px] gap-3 rounded-2xl px-2 py-1.5"
                          : "w-full min-h-[66px] gap-3 rounded-xl px-2.5 py-[7px]"
                    } text-start ${
                      item.kind === "bot" && sidebarChatOrder === "manual" ? "cursor-grab active:cursor-grabbing" : ""
                    } ${
                      selected || rosterDropKey === rowDropKey
                        ? "bg-sidebar-accent"
                        : "group-hover/row:bg-accent"
                    }`}
                  >
                    {mini ? (
                      <span className="relative shrink-0">
                        {avatar}
                        {item.kind === "bot" ? <RosterReplyIndicator status={item.chat.status} avatar /> : null}
                        {rowError ? (
                          <span
                            aria-hidden="true"
                            className="absolute -end-0.5 bottom-0 size-2 rounded-full bg-destructive ring-2 ring-sidebar"
                          />
                        ) : null}
                        {compactStatusLabel ? (
                          <span
                            className="sr-only"
                            id={`roster-status-${item.kind}-${item.chat.id}`}
                          >
                            {compactStatusLabel}
                          </span>
                        ) : null}
                        {conversationUnread ? (
                          <span aria-hidden="true" data-roster-conversation-unread
                            className="absolute -end-0.5 top-0 size-2 rounded-full border-[1.5px] border-unread bg-sidebar" />
                        ) : null}
                        {item.chat.unread ? (
                          <>
                            <span
                              aria-hidden="true"
                              data-roster-unread-dot
                              className="absolute -end-0.5 top-0 size-2 rounded-full bg-unread ring-2 ring-sidebar"
                            />
                            <span
                              id={`roster-unread-${item.kind}-${item.chat.id}`}
                              className="sr-only"
                            >
                              <Trans> (unread)</Trans>
                            </span>
                          </>
                        ) : null}
                      </span>
                    ) : (
                      <span className="relative shrink-0">{avatar}{item.kind === "bot" ? <RosterReplyIndicator status={item.chat.status} avatar /> : null}</span>
                    )}
                    {!mini ? (
                      <div className="min-w-0 flex-1">
                        <div className="flex items-center justify-between gap-1.5">
                          <div className="flex min-w-0 items-center gap-1.5 overflow-hidden">
                            <span
                              dir="auto"
                              data-roster-bot-name={item.kind === "bot" ? "" : undefined}
                              className={`min-w-0 truncate text-foreground ${mobile ? "text-[15px]" : "text-body2"} ${
                                mobile || item.chat.unread ? "font-semibold" : "font-medium"
                              }`}
                            >
                              {item.chat.name}
                            </span>
                            {item.chat.unread ? (
                              <span className="sr-only">
                                {unreadText ? t`, ${unreadText} unread` : <Trans> (unread)</Trans>}
                              </span>
                            ) : conversationUnread ? (
                              <span className="sr-only">{t`, new replies in conversations`}</span>
                            ) : null}
                          </div>
                          <div className="flex shrink-0 items-center gap-1.5">
                            {item.kind === "bot" && item.chat.status === "waiting_input" ? <RosterReplyIndicator status={item.chat.status} /> : !compact ? (
                              <span
                                data-roster-time
                                className={`tabular-nums ${mobile ? "text-xs text-muted-foreground" : "text-label text-faint-foreground"}`}
                              >
                                {formatRosterTime(item.chat.updatedAt)}
                              </span>
                            ) : null}
                            {unreadText ? (
                              <span
                                aria-hidden="true"
                                data-roster-unread-dot
                                data-roster-unread-count={unreadText}
                                className="inline-flex h-4 min-w-4 items-center justify-center rounded-full bg-unread px-1 text-[10px] font-semibold leading-none text-white tabular-nums"
                              >
                                {unreadText}
                              </span>
                            ) : item.chat.unread ? (
                              <span
                                aria-hidden="true"
                                data-roster-unread-dot
                                className="inline-block h-2 w-2 rounded-full bg-unread"
                              />
                            ) : conversationUnread ? (
                              <span
                                aria-hidden="true"
                                data-roster-conversation-unread
                                title={t`New replies in conversations`}
                                className="inline-block size-2 rounded-full border-[1.5px] border-unread"
                              />
                            ) : null}
                          </div>
                        </div>
                        {compact ? (
                          compactStatusLabel ? (
                            <div
                              dir="auto"
                              data-roster-status={
                                rowError
                                  ? "error"
                                  : item.kind === "bot"
                                    ? item.chat.status
                                    : undefined
                              }
                              className={`mt-0.5 flex items-center gap-1 text-[11.5px] ${
                                rowError
                                  ? "font-medium text-destructive"
                                  : workStatusLabel
                                    ? "font-semibold text-status-working"
                                    : "font-medium text-foreground/75"
                              }`}
                            >
                              {rowError ? <CircleAlert size={12} aria-hidden="true" /> : null}
                              <span>{compactStatusLabel}</span>
                            </div>
                          ) : null
                        ) : (
                          <div
                            dir="auto"
                            data-roster-preview={!workStatusLabel && !conversationLabel ? "true" : undefined}
                            data-roster-conversation-status={conversationLabel ? "true" : undefined}
                            className={`truncate ${expandable ? "pe-6" : ""} ${mobile ? "mt-0.5 text-sm" : "mt-1 text-label"} ${
                              workStatusLabel
                                ? "font-semibold text-status-working"
                                : conversationLabel
                                  ? conversationWaiting ? "font-medium text-warning" : "font-medium text-status-working"
                                : item.chat.unread
                                  ? "font-medium text-foreground/75"
                                  : "text-muted-foreground"
                            }`}
                          >
                            {rosterLine}
                          </div>
                        )}
                      </div>
                    ) : null}
                  </ContextMenuTrigger>
                );
                const conversationCard = item.kind === "bot" && conversationCount > 0 && !mobile ? (
                  <HoverConversationsFor scope={micoConversationScope(userId, item.chat.spaceId, item.chat.id)}
                    summary={item.chat.conversations}
                    onOpen={threadId => conversationsOf(item.chat.spaceId, item.chat.id, threadId)} />
                ) : undefined;
                const needsLook = conversationWaiting || conversationUnread;
                return (
                  <Fragment key={`${item.kind}:${item.chat.id}`}>
                  <div
                    className="group/row relative"
                    style={{
                      opacity: item.kind === "bot" && draggedBotId === item.chat.id ? 0.55 : 1,
                    }}
                  >
                    <ContextMenu
                      disabled={item.chat.spaceId !== bootstrapMe?.spaceId}
                      open={botMenu?.kind === item.kind && botMenu.id === item.chat.id}
                      // A sibling row's menu may already own the state; only clear our own.
                      onOpenChange={(open) =>
                        setBotMenu((current) =>
                          open
                            ? { kind: item.kind, id: item.chat.id }
                            : current?.kind === item.kind && current.id === item.chat.id
                              ? null
                              : current,
                        )
                      }
                    >
                      {item.kind === "bot" ? (
                        <RosterMessagePreview name={item.chat.name} status={item.chat.status} preview={item.chat.preview}
                          hasError={rowError} mini={mini} disabled={mobile || Boolean(draggedBotId) || Boolean(botMenu)}
                          conversations={conversationCard}>
                          {chatTrigger}
                        </RosterMessagePreview>
                      ) : mini ? (
                        <IconTooltip
                          side="inline-end"
                          label={
                            compactStatusLabel
                              ? `${item.chat.name}: ${compactStatusLabel}`
                              : item.chat.name
                          }
                        >
                          {chatTrigger}
                        </IconTooltip>
                      ) : (
                        chatTrigger
                      )}
                      {botMenu?.kind === item.kind && botMenu.id === item.chat.id ? (
                        <Suspense fallback={null}>{botMenuContent}</Suspense>
                      ) : null}
                    </ContextMenu>
                    {expandable ? (
                      <Button size="icon-xs" variant="ghost" data-roster-expand={item.chat.id}
                        aria-expanded={expanded}
                        aria-label={expanded ? t`Hide conversations of ${item.chat.name}` : t`Show conversations of ${item.chat.name}`}
                        title={expanded ? t`Hide conversations` : t`Show conversations`}
                        className={`absolute end-2 ${compact ? "bottom-1" : "bottom-2"} size-5 rounded text-muted-foreground hover:bg-background hover:text-foreground focus-visible:opacity-100 ${expanded || needsLook ? "opacity-100" : "opacity-0 group-hover/row:opacity-100"}`}
                        onClick={() => setMicoConversationsOpen(item.chat.id, !expanded)}
                      >
                        <ChevronRight size={13} aria-hidden="true" className={`transition-transform rtl:-scale-x-100 ${expanded ? "rotate-90 rtl:-rotate-90" : ""}`} />
                      </Button>
                    ) : null}
                  </div>
                  {expanded && item.kind === "bot" ? (
                    <ExpandedMicoConversations spaceId={item.chat.spaceId} botId={item.chat.id} userId={userId} clientFor={conversationClient}
                      revision={item.chat.conversations?.revision} activeThreadId={selected ? activeThreadId : undefined}
                      onOpen={threadId => conversationsOf(item.chat.spaceId, item.chat.id, threadId)} />
                  ) : null}
                  </Fragment>
                );
              })}
            </CollapsibleContent>
          </Collapsible>
        );
      })}
    </>
  );
}

/** A space section header's name as one phrase, for accessible labels. */
function headerName(group: { title?: string | null; subtitle?: string }): string {
  return group.subtitle ? `${group.title}, ${group.subtitle}` : (group.title ?? "");
}

function formatRosterTime(isoDate?: string | null): string {
  if (!isoDate) return "";
  try {
    const d = new Date(isoDate);
    if (Number.isNaN(d.getTime())) return "";
    const locale = i18n.locale || "en";
    const now = new Date();
    const isToday =
      d.getDate() === now.getDate() &&
      d.getMonth() === now.getMonth() &&
      d.getFullYear() === now.getFullYear();
    if (isToday) {
      return d.toLocaleTimeString(locale, { hour: "numeric", minute: "2-digit" });
    }
    const yesterday = new Date(now);
    yesterday.setDate(now.getDate() - 1);
    const isYesterday =
      d.getDate() === yesterday.getDate() &&
      d.getMonth() === yesterday.getMonth() &&
      d.getFullYear() === yesterday.getFullYear();
    if (isYesterday) return t`Yesterday`;
    const diffDays = Math.floor((now.getTime() - d.getTime()) / (1000 * 60 * 60 * 24));
    if (diffDays < 7) {
      return d.toLocaleDateString(locale, { weekday: "short" });
    }
    return d.toLocaleDateString(locale, { month: "short", day: "numeric" });
  } catch {
    return "";
  }
}

/** A Mico row's hover card part: its conversations as already loaded, never read on hover. */
function HoverConversationsFor({ scope, summary, onOpen }: {
  scope: string;
  summary?: Space["bots"][number]["conversations"];
  onOpen: (threadId: string) => void;
}) {
  const rows = useConversationRows(scope);
  return <HoverConversations rows={rows} summary={summary} onOpen={onOpen} />;
}

/** The list under an expanded Mico row, read again whenever the roster says its conversations moved. */
function ExpandedMicoConversations({ spaceId, botId, userId, revision, activeThreadId, onOpen, clientFor }: {
  clientFor: (spaceId: string) => Pick<RpcClient, "development">;
  spaceId: string;
  botId: string;
  userId?: string;
  revision?: string;
  activeThreadId?: string;
  onOpen: (threadId: string) => void;
}) {
  const [all, setAll] = useState(false);
  const scope = micoConversationScope(userId, spaceId, botId);
  const client = useMemo(() => clientFor(spaceId), [clientFor, spaceId]);
  const { rows, loaded } = useSidebarConversationRows({ enabled: true, rpc: client, scope, botId, revision });
  return <SidebarMicoConversations rows={rows} all={all} onToggleAll={() => setAll(value => !value)}
    activeThreadId={activeThreadId} onOpen={onOpen} loading={!loaded} />;
}
