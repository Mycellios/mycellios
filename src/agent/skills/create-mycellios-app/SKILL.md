---
name: create-mycellios-app
description: Create or revise a versioned Mycellios App definition, workflow and bundled instructions in a Mycellios source checkout. Use for internal Apps authoring, not general websites or application execution.
---

# Create a Mycellios App

Turn a proven task into a repeatable, declarative application. Work in a draft;
creation is not publication, a permission grant, or an instruction to execute it.

1. Read [the authoring guide](references/guide.md). Identify inputs, expected
   results, review points, target machines and existing authorization. Use the
   smallest supported flow. The current v1 supports an acyclic graph, not loops,
   arbitrary HTML/JS, embedded logins or user-supplied shell commands.
2. Copy [the complete template bundle](assets/template/app.json), including its
   `prompts/` and `skills/` folders. Adapt the identity, fields, screens and steps.
   Registered action names are contracts, not proof that a tool is installed.
3. Make instructions explicit and generic. Extract only verified behavior from
   a chat; exclude personal account data, credentials, untested claims, licensed
   resources without permission and hidden dependencies on conversational memory.
4. Use the checkout's authoritative schemas and validator, linked from the guide.
   Preserve Mycellios session/Space ownership, private project data, remembered
   grants, bounded quotes, explicit Cloud transfer and immutable versions.
5. Recompute the SHA-256 of each changed bundled asset. Validate the whole bundle,
   and use `--previous` with the prior immutable bundle for updates. Never replace
   a failing test with invented approval, capability or execution evidence.
6. Report definition validation separately from executor qualification, creative
   approval, publication and deployment. Real publication additionally needs the
   authorized platform publisher and matching local/Cloud executor evidence.

Keep existing projects pinned to their definition digest. V1 new versions start
new projects; it does not migrate existing projects. Do not invent a migration or
expand a user's standing access to make a definition executable.
