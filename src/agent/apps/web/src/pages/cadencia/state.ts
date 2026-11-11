import { queryClient } from "../../lib/query";
import { setUnsavedEditorWork } from "../../lib/unsaved-editor-work";
import {
  DEFAULT_SETTINGS,
  type Analysis,
  type Cut,
  type Settings,
} from "./analysis";
import type { MediaInfo, Rendered } from "./media";

export type CadenciaState = {
  file?: File;
  info?: MediaInfo;
  pcm?: Float32Array;
  analysis?: Analysis;
  cuts: Cut[];
  settings: Settings;
  rendered?: Rendered;
  demo: boolean;
};
const prefix = "cadencia-editor",
  key = (scope: string) => [prefix, scope];
queryClient.setQueryDefaults([prefix], {
  gcTime: Infinity,
  staleTime: Infinity,
});
queryClient.getQueryCache().subscribe((event) => {
  if (event.type === "removed" && event.query.queryKey[0] === prefix)
    setUnsavedEditorWork(JSON.stringify(event.query.queryKey), false);
});
export const blankState = (): CadenciaState => ({
  cuts: [],
  settings: { ...DEFAULT_SETTINGS },
  demo: false,
});
export const readCadencia = (scope: string) =>
  queryClient.getQueryData<CadenciaState>(key(scope)) ?? blankState();
export function saveCadencia(scope: string, state: CadenciaState) {
  queryClient.setQueryData(key(scope), state);
  setUnsavedEditorWork(JSON.stringify(key(scope)), !!state.file);
}
export function clearCadencia(scope: string) {
  queryClient.removeQueries({ queryKey: key(scope), exact: true });
}
