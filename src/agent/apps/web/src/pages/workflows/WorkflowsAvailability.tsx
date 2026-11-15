import { useLingui } from "@lingui/react/macro";
import { Waypoints } from "lucide-react";
import type { ReactNode } from "react";
import { ComingSoonWorkspace } from "../../components/ComingSoonWorkspace";
import { workflowsAvailable } from "../../lib/workflows-availability";

/** Keep editors and workflow RPCs unmounted while this UI is paused. */
export function WorkflowsAvailability({ children, onExit, onNavigation }: {
  children: ReactNode;
  onExit: () => void;
  onNavigation?: () => void;
}) {
  const { t } = useLingui();
  if (workflowsAvailable()) return children;
  return <ComingSoonWorkspace title={t`Workflows`} icon={Waypoints} testId="workflows-coming-soon" onExit={onExit} onNavigation={onNavigation} />;
}
