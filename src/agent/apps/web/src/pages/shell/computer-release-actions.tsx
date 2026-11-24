import { Trans } from "@lingui/react/macro";
import type { ComputerReleaseReason } from "@mycellios/contracts";
import { Button } from "@mycellios/ui-web";

/**
 * The one primary way to hand the computer back. Skipping a request lives in the
 * computer's menu, so a waiting request shows a single clear action.
 */
export function ComputerReleaseActions({
  takeoverRequested,
  onRelease,
}: {
  takeoverRequested: boolean;
  onRelease: (reason?: ComputerReleaseReason) => Promise<void>;
}) {
  if (!takeoverRequested) {
    return (
      <Button type="button" variant="outline" size="sm" onClick={() => void onRelease()}>
        <Trans>Release control</Trans>
      </Button>
    );
  }
  return (
    <Button type="button" size="sm" onClick={() => void onRelease("done")}>
      <Trans>I’m done</Trans>
    </Button>
  );
}
