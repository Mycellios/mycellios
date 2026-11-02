/** A native folder grant stays fixed while its cloud binding is live. */
export function assertProjectGrant(existing: { path: string } | null, requested: string) {
  if (existing && existing.path !== requested)
    throw new Error("Revoke local computer access from the File menu before choosing another project for this agent.");
}
