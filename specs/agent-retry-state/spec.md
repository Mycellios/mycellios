# Current-state admission for original-turn retries

A message retry must re-read the owned thread before attempting the same saved run.
Offer it only for failed user turns without an already saved bot reply. Automatic
introductions, routine and peer work are not new user-message retries.

Keep the API's original-message, effect, ownership and active-run fences unchanged.
Reconcile known conflict refusals with a fresh read, never another retry POST or a
copy of text/attachments. Retain actionable auth/transport errors. Do not report
old results into a different chat/Space or after unmount, and do not classify a
failed observation after accepted retry as failed submission.

Verify retry-thread-run tests on web and API, composer draft/attachment tests and
web incremental typing. Qualify the installed first-party UI without submitting
the user's saved documents. This client repair requires no production deployment.
