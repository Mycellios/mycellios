/** Deployment-owned placement, never accepted from a voice HTTP request. */
export function networkSpeechIdentityIds(value: string | undefined): string[] {
  if (!value?.trim()) return [];
  const ids = [...new Set(value.split(",").map(id => id.trim()))];
  if (ids.length > 64 || ids.some(id => !/^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/.test(id))) {
    throw new Error("MYCELLIOS_NETWORK_SPEECH_IDENTITIES must contain valid worker identity IDs");
  }
  return ids;
}
