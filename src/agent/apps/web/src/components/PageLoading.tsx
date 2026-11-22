import { LoadingSkeleton } from "./LoadingSkeleton";

/** A whole-page placeholder for routes whose content has not loaded yet. */
export function PageLoading({
  label,
  className = "",
  layout = "detail",
  ...props
}: React.ComponentPropsWithoutRef<"div"> & { label?: string; layout?: "detail" | "chat" }) {
  return (
    <div className={`h-full min-h-0 overflow-hidden bg-background ${className}`} {...props}>
      <LoadingSkeleton label={label} layout={layout} rows={4} className="mx-auto w-full max-w-3xl px-6 py-8 sm:px-10" />
    </div>
  );
}
