import { useLingui } from "@lingui/react/macro";
import { productBrand } from "@rakazo/contracts";
import {
  Button,
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@rakazo/ui-web";
import {
  ArrowUpRight,
  BookOpen,
  ChevronDown,
  CircleHelp,
  Code2,
  Mail,
  MessagesSquare,
  Sparkles,
} from "lucide-react";
import { useState } from "react";
import { RELEASE_NOTES } from "../lib/release-notes";

/** Shared by the desktop rail and mobile sidebar; no second release feed. */
export function HelpMenu({
  onWhatsNew,
  compact = true,
}: {
  onWhatsNew: () => void;
  compact?: boolean;
}) {
  const { t } = useLingui();
  const [open, setOpen] = useState(false);
  const [guides, setGuides] = useState(false);
  const topics = [
    {
      title: t`Start a conversation`,
      text: t`Choose a Mico from the sidebar, write what you need and send your message. Use a separate chat for each topic so its context stays clear.`,
    },
    {
      title: t`Connect apps and add skills`,
      text: t`Open Marketplace to connect your tools, add a Mico or install a skill. A skill gives your Mico instructions for a task; an app connects it to a service.`,
    },
    {
      title: t`Tasks, routines and scheduling`,
      text: t`Use Tasks to follow delegated work. Routines repeat an action or respond to a trigger; Schedule shows their planned runs and history. Open an item to see its details.`,
    },
    {
      title: t`Models, quota and costs`,
      text: t`Open Settings → Models to manage your model accounts. The quota ring shows the allowance reported by a subscription. Usage shows recorded consumption and costs; it is a separate report.`,
    },
    {
      title: t`Attachments and voice`,
      text: t`Use the plus button beside your message for attachments and chat tools. Open Voice for a spoken conversation. Voice availability depends on your browser or Desktop app and the configured speech engine.`,
    },
  ];
  const row = "items-start gap-3 rounded-md px-3 py-2.5 whitespace-normal";
  const copy = "min-w-0 flex-1 text-sm leading-5";
  const detail = "mt-0.5 block text-xs leading-4 text-muted-foreground";
  return (
    <>
      <DropdownMenu open={open} onOpenChange={setOpen}>
        <DropdownMenuTrigger
          data-testid="help-menu-trigger"
          aria-label={t`Help`}
          className={`app-no-drag ${compact ? "rk-rail-button" : "mx-3 flex min-h-10 w-[calc(100%-24px)] items-center gap-2 rounded-md px-2 text-sm hover:bg-sidebar-accent focus-visible:ring-2 focus-visible:ring-ring"}`}
        >
          <CircleHelp size={compact ? 19 : 17} strokeWidth={1.6} />
          {!compact ? (
            <>
              <span className="flex-1 text-start">{t`Help and resources`}</span>
              <ChevronDown size={14} />
            </>
          ) : null}
        </DropdownMenuTrigger>
        <DropdownMenuContent
          data-testid="help-menu"
          side={compact ? "right" : "top"}
          align="end"
          className="app-no-drag max-h-[min(var(--available-height),calc(100dvh-24px))] w-[320px] max-w-[calc(100vw-24px)] overflow-y-auto rounded-xl p-1.5"
        >
          <div className="px-3 py-2 text-sm font-semibold text-foreground">{t`Help and resources`}</div>
          <DropdownMenuGroup>
            <DropdownMenuLabel className="px-3 pb-1 pt-2 text-xs font-normal text-muted-foreground">{t`Learn`}</DropdownMenuLabel>
            <DropdownMenuItem
              className={row}
              onClick={() => {
                setOpen(false);
                setGuides(true);
              }}
            >
              <BookOpen className="mt-0.5 size-4 shrink-0" />
              <span className={copy}>
                {t`Quick guides`}
                <span className={detail}>{t`Chats, apps, routines and model accounts`}</span>
              </span>
            </DropdownMenuItem>
            <DropdownMenuItem
              className={row}
              onClick={() => {
                setOpen(false);
                onWhatsNew();
              }}
            >
              <Sparkles className="mt-0.5 size-4 shrink-0" />
              <span className={copy}>
                {t`What's new`}
                <span className={detail}>
                  {t`Release notes`} · {RELEASE_NOTES.version}
                </span>
              </span>
            </DropdownMenuItem>
            <DropdownMenuItem
              className={row}
              render={
                <a
                  href="https://github.com/Mycellios/mycellios/releases"
                  target="_blank"
                  rel="noopener noreferrer"
                />
              }
            >
              <BookOpen className="mt-0.5 size-4 shrink-0" />
              <span className={copy}>
                {t`Version history`}
                <span className={detail}>{t`Published releases on GitHub`}</span>
              </span>
              <ArrowUpRight className="mt-0.5 size-3.5 shrink-0 text-muted-foreground" />
            </DropdownMenuItem>
          </DropdownMenuGroup>
          <DropdownMenuSeparator />
          <DropdownMenuGroup>
            <DropdownMenuLabel className="px-3 pb-1 pt-2 text-xs font-normal text-muted-foreground">{t`Contact and community`}</DropdownMenuLabel>
            <DropdownMenuItem
              className={row}
              render={
                <a
                  href={productBrand.communityDiscordUrl}
                  target="_blank"
                  rel="noopener noreferrer"
                />
              }
            >
              <MessagesSquare className="mt-0.5 size-4 shrink-0" />
              <span className={copy}>
                {t`Open Discord`}
                <span className={detail}>{t`Opens in a new tab`}</span>
              </span>
              <ArrowUpRight className="mt-0.5 size-3.5 shrink-0 text-muted-foreground" />
            </DropdownMenuItem>
            <DropdownMenuItem
              className={row}
              render={<a href="mailto:hello@mycellios.com?subject=Mycellios%20feedback" />}
            >
              <Mail className="mt-0.5 size-4 shrink-0" />
              <span className={copy}>
                {t`Send feedback`}
                <span className={detail}>{t`Opens your email app`} · hello@mycellios.com</span>
              </span>
              <ArrowUpRight className="mt-0.5 size-3.5 shrink-0 text-muted-foreground" />
            </DropdownMenuItem>
            <DropdownMenuItem
              className={row}
              render={
                <a
                  href="https://github.com/Mycellios/mycellios"
                  target="_blank"
                  rel="noopener noreferrer"
                />
              }
            >
              <Code2 className="mt-0.5 size-4 shrink-0" />
              <span className={copy}>
                {t`Source code`}
                <span className={detail}>{t`Mycellios repository on GitHub`}</span>
              </span>
              <ArrowUpRight className="mt-0.5 size-3.5 shrink-0 text-muted-foreground" />
            </DropdownMenuItem>
          </DropdownMenuGroup>
        </DropdownMenuContent>
      </DropdownMenu>
      <Dialog open={guides} onOpenChange={setGuides}>
        <DialogContent
          data-testid="help-guides"
          className="max-h-[calc(100dvh-24px)] gap-0 overflow-y-auto sm:max-w-lg"
        >
          <DialogHeader>
            <DialogTitle>{t`Quick guides`}</DialogTitle>
            <DialogDescription>{t`The essentials, without leaving your chat.`}</DialogDescription>
          </DialogHeader>
          <div className="my-3">
            {topics.map((topic, index) => (
              <details
                key={topic.title}
                open={index === 0}
                className="group border-b py-3 last:border-0"
              >
                <summary className="flex cursor-pointer list-none items-center justify-between gap-3 rounded-sm text-sm font-medium outline-none focus-visible:ring-2 focus-visible:ring-ring [&::-webkit-details-marker]:hidden">
                  {topic.title}
                  <ChevronDown className="size-4 shrink-0 text-muted-foreground group-open:rotate-180" />
                </summary>
                <p className="mt-2 pe-4 text-sm leading-relaxed text-muted-foreground">
                  {topic.text}
                </p>
              </details>
            ))}
          </div>
          <div className="flex justify-end border-t pt-3">
            <Button variant="secondary" onClick={() => setGuides(false)}>{t`Close`}</Button>
          </div>
        </DialogContent>
      </Dialog>
    </>
  );
}
