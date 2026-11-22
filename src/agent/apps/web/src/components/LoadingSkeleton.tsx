import { useLingui } from "@lingui/react/macro";
import { Dialog, DialogContent, DialogTitle } from "@mycellios/ui-web";
import { Skeleton } from "@mycellios/ui-web/components/ui/skeleton";

type LoadingLayout = "list" | "cards" | "detail" | "settings" | "chat";

export function LoadingSkeleton({
  label,
  layout = "list",
  rows = 3,
  className,
}: {
  label?: string;
  layout?: LoadingLayout;
  rows?: number;
  className?: string;
}) {
  const { t } = useLingui();
  return (
    <div role="status" aria-label={label ?? t`Loading…`} aria-busy="true" className={className}>
      <div
        aria-hidden="true"
        className={layout === "cards" ? "grid gap-4 sm:grid-cols-2 lg:grid-cols-3" : "space-y-3"}
      >
        {Array.from({ length: rows }, (_, index) => (
          <div key={index} className={layout === "chat" ? (index % 2 ? "ms-auto max-w-[65%]" : "max-w-[80%]") : undefined}>
            {layout === "cards" ? (
              <div className="space-y-3 rounded-xl border border-border p-3">
                <Skeleton className="aspect-video w-full" />
                <Skeleton className="h-3.5 w-3/5" />
                <Skeleton className="h-3 w-4/5" />
              </div>
            ) : layout === "detail" || layout === "chat" ? (
              <div className="space-y-2 rounded-xl px-2 py-3">
                <Skeleton className="h-3.5 w-2/5" />
                <Skeleton className="h-3 w-full" />
                <Skeleton className="h-3 w-3/4" />
              </div>
            ) : (
              <div className="flex items-center gap-3 rounded-lg border border-border px-3 py-3">
                {layout === "list" && <Skeleton className="size-7 shrink-0" />}
                <div className="min-w-0 flex-1 space-y-2">
                  <Skeleton className="h-3.5 max-w-40" />
                  <Skeleton className="h-3 max-w-60" />
                </div>
                {layout === "settings" && <Skeleton className="h-8 w-1/4 max-w-40 shrink-0 rounded-lg" />}
              </div>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}

export function SettingsLoading({ onClose }: { onClose: () => void }) {
  const { t } = useLingui();
  return (
    <Dialog open onOpenChange={(open) => { if (!open) onClose(); }}>
      <DialogContent
        className="inset-0 top-0 left-0 flex h-dvh max-h-none w-full max-w-none translate-x-0 translate-y-0 overflow-hidden rounded-none bg-background p-0 sm:max-w-none data-open:animate-none data-closed:animate-none"
      >
        <aside aria-hidden="true" className="hidden w-[232px] shrink-0 space-y-4 border-e border-border p-4 md:block">
          <Skeleton className="h-4 w-24" />
          <Skeleton className="h-8 w-full rounded-lg" />
          {[72, 112, 85, 100, 120, 78, 104].map((width) => (
            <Skeleton key={width} className="h-5" style={{ width }} />
          ))}
        </aside>
        <div className="min-w-0 flex-1">
          <DialogTitle className="border-b border-border px-6 py-6">{t`Settings`}</DialogTitle>
          <LoadingSkeleton label={t`Loading…`} layout="settings" rows={6} className="mx-auto max-w-3xl px-6 py-6" />
        </div>
      </DialogContent>
    </Dialog>
  );
}

export function DialogLoading({ title, onClose, layout }: {
  title: string;
  onClose: () => void;
  layout?: LoadingLayout;
}) {
  return (
    <Dialog open onOpenChange={(open) => { if (!open) onClose(); }}>
      <DialogContent className="sm:max-w-lg">
        <DialogTitle>{title}</DialogTitle>
        <LoadingSkeleton layout={layout} />
      </DialogContent>
    </Dialog>
  );
}
