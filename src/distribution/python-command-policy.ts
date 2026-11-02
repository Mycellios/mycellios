import {
  MYCELLIOS_CELL_MEMBER_MODULE,
  MYCELLIOS_STAGE_MODULE,
  MYCELLIOS_SERVER_MODULE,
} from "./python-launcher.js";

export function nativeEntrypointForCommandKind(kind: string): string {
  return kind === "cell-member" ? MYCELLIOS_CELL_MEMBER_MODULE
    : kind === "remote-stage" ? MYCELLIOS_STAGE_MODULE : MYCELLIOS_SERVER_MODULE;
}
