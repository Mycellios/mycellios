# Notifications for the installed web app

The installed Mycellios web app enrolls automatically when the device already
allows Mycellios notifications and reply notifications are enabled. A device that
has not granted permission uses the single system notification prompt.
The existing open-tab and native app channels remain available. iOS requires
installing the PWA on the Home Screen and accepting its notification permission.

The authenticated API binds a subscription to one user, browser installation
and session. Only supported browser push endpoints are accepted. Subscriptions
and outbox payloads are encrypted. Access is limited to system operations;
delivery rechecks session validity, Space membership, unread state and Mico
preferences. Read or superseded events are discarded. A focused Mycellios tab
temporarily holds delivery. Native notification preferences are independent.

The API and worker use the same stable VAPID keys. Deploy the additive migration
before configuring those keys and rolling out the services. The web worker accepts
only bounded, current payloads for its bound account. Clicks stay inside the web
app and route to the intended Space, chat and task where applicable.

Validate registration, ownership, migration and outbox delivery on disposable
PostgreSQL; test navigation and malformed payloads in the web worker. To qualify
the release, opt in on a physical phone, close the installed PWA, finish a turn
from another client and tap the system notification. Confirm it opens the exact
conversation without signing into a different account. Check a private task too.
