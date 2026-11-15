import {desktopBridge} from "../lib/desktop";

export function DevelopmentIdentity() {
  const identity=desktopBridge()?.development?.identity;
  if(!identity)return null;
  return <span role="status" title={`Mycellios Dev · ${identity.branch}`}
    className="app-no-drag inline-flex max-w-40 shrink-0 items-center gap-1.5 rounded-md bg-muted px-2 py-1 text-xs text-foreground">
    <span className="size-1.5 shrink-0 rounded-full" style={{backgroundColor:`hsl(${identity.hue} 48% 48%)`}} aria-hidden />
    <span className="truncate">Dev · {identity.branch}</span>
  </span>;
}
