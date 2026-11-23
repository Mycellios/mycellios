# Memory MCP profile v1

Mycellios connects a person's own long-term memory through the Model Context Protocol. It has no
integration for any particular memory product: any remote MCP server that implements this profile
can be connected in Settings > Memory > Personal memory. The design is in
`specs/mcp-memory/spec.md` at the repository root; the checker is `evaluateMemoryProfile` in
`packages/contracts/src/memory-mcp.ts`.

## Transport and authorization

- MCP Streamable HTTP over HTTPS. Plain HTTP is accepted only on loopback, and private or LAN
  addresses only when the deployment owner allows private MCP endpoints.
- OAuth 2.1 as the MCP authorization specification describes it: protected-resource metadata
  (RFC 9728), authorization server discovery, dynamic client registration or a pre-registered
  client, PKCE and resource indicators (RFC 8707). Servers without OAuth may accept a bearer token.
- Advertise a read scope and, when writing is supported, a separate write scope (conventionally
  `memory.read` and `memory.write`).

## Tools

| Tool | Required | Annotation | Required input |
|---|---|---|---|
| `memory_search` | yes | `readOnlyHint: true` | `query` (string). Optional `limit`, `projectId` |
| `memory_read` | yes | `readOnlyHint: true` | `id` (string). Optional `offset`, `maxChars` |
| `memory_write` | no | | `title`, `content` (strings). Optional `projectId`, `tags`, `operationKey` |
| `memory_forget` | no | `destructiveHint: true` | `id` (string). Optional `reason` |
| `memory_status` | no | `readOnlyHint: true` | none |

A server is compatible when both required tools exist and accept their required inputs as text. A
search or read tool that declares `readOnlyHint: false` is refused, because Mycellios may call it
automatically on every turn. Optional tools with the wrong shape are ignored. Forgetting is only
used together with writing.

`operationKey` on `memory_write` is an idempotency key. Servers should scope it to the authorized
connection so one client can never overwrite another client's entry.

Results may be `structuredContent` or JSON text:

- `memory_search`: `{ results: [{ id, title?, snippet, score?, updatedAt?, projectId?, source? }] }`
- `memory_read`: `{ id, title?, content, updatedAt?, nextOffset? }`
- `memory_write`: `{ id, status: "created" | "updated" | "unchanged" }`
- `memory_forget`: `{ id, forgotten }`
- `memory_status`: `{ writable?, projects?: [{ id, name }] }`

A connection may map profile tools to differently named tools with the same semantics. The
mapping is per connection; Mycellios ships no built-in mappings.

## How Micos use it

- **Reading.** A Mico with access searches the memory before each reply and can search it with
  `recall_memory`.
- **Saving.** A Mico the person allowed to save uses `save_memory`, and it goes to that memory.
  - A Mico saves to one memory at most.
  - Each call sends `title` (the first line), `content` and
    `operationKey = mycellios:<connection>:<run>:<sha256(content)>`, so a retried call updates
    the same entry.
  - Content over 8,000 bytes is refused before anything is sent.
  - Content that contains one of the run's secrets, or that looks like a password, key or token,
    is also refused before anything is sent.
- **Forgetting.** A Mico the person also allowed to forget uses `forget_memory`. It follows the
  Space's approval mode:
  - **Ask:** it asks the person.
  - **Auto:** the approval model decides, or it asks.
  - **Never ask:** it runs without asking.
- **When nothing is written.** Runs started by an external webhook only read.
- **Changes on the server.** Writing stops as soon as a check finds the server no longer offers
  `memory_write`.
- **Turning on writing for a read-only connection.** If a connection was authorized for reading
  only, remove it and connect it again, then accept writing on the server's consent screen.

## Safety

Recalled text is untrusted data, never instructions. Mycellios stores connection credentials in its
secret store, never sends them to a model, and grants no Mico access to a connected memory until
the person enables it for that Mico.
