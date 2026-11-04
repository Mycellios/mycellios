# Repository consolidation

Consolidate reviewed Agent fixes and compatible dependency updates against the
current main, preserving both sides of overlapping changes. Keep the existing
branch protection, required checks, package pins and product boundaries.

Before retiring remote branches, retain their exact heads, PR metadata and full
history in a verified private Git bundle. Do not delete local worktrees, drafts,
uncommitted work, runtime data or release artifacts. A closed proposal must state
whether its implementation is superseded or intentionally deferred.

Do not downgrade a package already upgraded on main or introduce an incomplete
major-version migration as housekeeping. Keep the separate Expo Router and
Mermaid migration proposals for their own compatibility qualification.
Python requirement changes must also qualify their relationship to the separately
certified portable wheel graph; a declaration-only bump is not proof of runtime
compatibility. Retain an unqualified proposal rather than report it as verified.

Qualify the combined source locally with affected tests and incremental types,
then require the protected CI checks on the integrated candidate. Fetch main
again before promotion and repeat affected qualification if it moves. Merge only
through the repository's permitted method; do not bypass checks or deploy a
production runtime as part of branch cleanup.
