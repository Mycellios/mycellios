/** Dynamic native admission takes precedence; static cloud providers retain their first-boot support. */
export function computerAvailable(configuredKind: string, provisionKind: string | undefined) {
  return provisionKind === undefined ? configuredKind !== "none" : provisionKind !== "none";
}
