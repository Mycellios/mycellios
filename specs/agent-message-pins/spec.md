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
references. Main chats, independent task chats and groups keep separate pin lists.

## Pins a Mico makes

A Mico may pin or unpin with `pin_message` ({messageId or quote, pinned}) in its own
main chat or one of its own side conversations, never in a group or an outside
messaging chat, and never for background work. A quote picks the newest person or
Mico message after the New chat boundary that holds it. The pin belongs to the
person who owns the conversation and records the Mico in the additive, nullable
`pinnedByBotId` column (migration `20261122200000_message_pin_authors`); a NULL
author is the person's own pin, so existing pins keep their meaning. The list marks
these pins as pinned by that Mico. They count toward the same 100 under the same lock.
The person can unpin them, and pinning one makes it the person's own pin; the Mico
never unpins the person's pin. Its guidance: pin what the person will want to find
again, such as a final draft or a decision, not routine replies.

## All of a Mico's conversations

The pins popover can switch to one list for a Mico's main chat and its side
conversations (`pins.mico`), newest pin first and at most 200, each with its
conversation (main chat, its title, or archived). Groups, other Micos and
conversations being deleted are left out. Opening a pin from another conversation
restores it if archived, opens it and jumps to the message, and says so when the
message is gone. Unpinning there (`pins.unpin`) is fenced to that Mico's own
conversations. The phone uses the same popover and list.

Validate the focused message-pin API/UI tests, incremental web/API typing and the
isolated PostgreSQL pin proof, including the actual migrations, tenant isolation,
Mico pins, the combined list, concurrent changes and stale-reference cleanup. Local
qualification does not publish or deploy this feature.
