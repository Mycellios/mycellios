# Personal pinned messages

The chat header exposes pinned messages for the current account, Space and exact
conversation. Message menus pin/unpin existing user and assistant messages. The
list jumps to the original message using the existing history paging and scroll
path. Unpinning never removes a message or starts an agent run.

Persist only message references and timestamps. Read content through the existing
encrypted message client and transcript visibility rules; never copy plaintext
into a bookmark table. Resolve conversation ownership/membership for every call.
Composite foreign keys enforce message/thread/Space consistency. RLS requires the
current user and Space membership. Limit to 100 pins per account/conversation,
serializing mutations and preserving idempotent retries. Deletion cascades stale
references. Main chats, independent task chats and groups remain separate.

Validate the focused message-pin API/UI tests, incremental web/API typing and the
isolated PostgreSQL pin proof, including the actual migration, tenant isolation,
concurrent changes and stale-reference cleanup. Local qualification does not
publish or deploy this feature.
