import { useLingui } from "@lingui/react/macro";
import { Workflow } from "lucide-react";
import type { ReactNode } from "react";
import { ComingSoonWorkspace } from "../../components/ComingSoonWorkspace";
import { routinesAvailable } from "../../lib/routines-availability";

/** Gate before mounting editors/queries so direct links cannot open the paused UI. */
export function RoutinesAvailability({ children, onExit, onNavigation }: {
  children: ReactNode;
  onExit: () => void;
  onNavigation?: () => void;
}) {
  const { t } = useLingui();
  if (routinesAvailable()) return children;
  return <ComingSoonWorkspace title={t`Routines`} icon={Workflow} testId="routines-coming-soon" onExit={onExit} onNavigation={onNavigation} />;
}
