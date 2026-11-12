import type { HostedWebDraft } from "@rakazo/contracts";
import { queryClient } from "./query";
import { setUnsavedEditorWork } from "./unsaved-editor-work";

type EditorState = {
  draft: HostedWebDraft;
  dirty: boolean;
  selected: string;
  busy: boolean;
};
const PREFIX = "hosted-web-editor";
const PROMPT_PREFIX = "hosted-app-prompt";
const key = (scope: string) => [PREFIX, scope] as const;
// Reuse the app's memory-only account cache: setQueryUser clears it on sign-out/switch.
// Dirty source must not expire while the user works in another section.
queryClient.setQueryDefaults([PREFIX], {
  gcTime: Infinity,
  staleTime: Infinity,
});
queryClient.setQueryDefaults([PROMPT_PREFIX], {
  gcTime: Infinity,
  staleTime: Infinity,
});
queryClient.getQueryCache().subscribe((event) => {
  if (
    event.type === "removed" &&
    [PREFIX, PROMPT_PREFIX].includes(String(event.query.queryKey[0]))
  )
    setUnsavedEditorWork(JSON.stringify(event.query.queryKey), false);
});
export function readWebEditor(scope: string) {
  return queryClient.getQueryData<EditorState>(key(scope));
}
export function writeWebEditor(scope: string, value: EditorState) {
  queryClient.setQueryData(key(scope), value);
  setUnsavedEditorWork(JSON.stringify(key(scope)), value.dirty || value.busy);
}
export function clearWebEditor(scope: string) {
  queryClient.removeQueries({ queryKey: key(scope), exact: true });
}
type AppPrompt = { text: string; nonce?: string };
export function readAppPrompt(scope: string) {
  return queryClient.getQueryData<AppPrompt>([PROMPT_PREFIX, scope]);
}
export function writeAppPrompt(scope: string, value: AppPrompt) {
  const key = [PROMPT_PREFIX, scope];
  queryClient.setQueryData(key, value);
  setUnsavedEditorWork(
    JSON.stringify(key),
    Boolean(value.text.trim() || value.nonce),
  );
}
