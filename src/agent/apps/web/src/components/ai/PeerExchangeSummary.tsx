import { Plural } from "@lingui/react/macro";
import { ChevronRight } from "lucide-react";

/** One folded row for a run of messages between Micos; the rows show when it opens. */
export function PeerExchangeSummary({
  count,
  peers,
  locale,
  open,
  onToggle,
}: {
  count: number;
  peers: readonly string[];
  locale: string;
  open: boolean;
  onToggle: () => void;
}) {
  const names = new Intl.ListFormat(locale, { style: "long", type: "conjunction" }).format(peers);
  return (
    <div className="flex justify-start py-0.5" data-testid="peer-exchange">
      <button
        type="button"
        aria-expanded={open}
        onClick={onToggle}
        className="flex min-h-6 w-fit cursor-pointer items-center gap-1 rounded-md py-0.5 pe-1.5 text-[12px] text-muted-foreground outline-none hover:text-foreground/75 focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background"
      >
        <ChevronRight
          aria-hidden
          size={14}
          strokeWidth={1.8}
          className={`transition-transform duration-150 motion-reduce:transition-none ${open ? "rotate-90" : ""}`}
        />
        <span dir="auto">
          <Plural value={count} one={`# message with ${names}`} other={`# messages with ${names}`} />
        </span>
      </button>
    </div>
  );
}
