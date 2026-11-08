import { t } from "@lingui/core/macro";
import { userFacingLabel } from "@rakazo/core";

export function spaceLabel(name: string | null | undefined): string {
  return userFacingLabel({ name }, t`Space`);
}

export function selectedSpaceLabel(
  spaces: readonly { id: string; name: string }[],
  spaceId: string | null,
  absent = "Mycellios",
): string {
  const current = spaces.find((space) => space.id === spaceId);
  return current ? spaceLabel(current.name) : absent;
}
