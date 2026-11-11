// A read-only MCP fixture. Listen only on the peer's loopback; Tailscale Serve
// is the only network ingress. The counter detects unauthorized upstream calls.
import { createServer } from 'node:http';
let calls = 0;
createServer(async (req, res) => {
  if (req.url === '/counter') return res.end(JSON.stringify({ calls }));
  if (req.method !== 'POST') return res.writeHead(405).end();
  const chunks = [];
  for await (const chunk of req) chunks.push(chunk);
  const input = JSON.parse(Buffer.concat(chunks).toString());
  if (input.id === undefined) return res.writeHead(202).end();
  const result = input.method === 'initialize'
    ? { protocolVersion: '2025-03-26', capabilities: { tools: {} }, serverInfo: { name: 'private-readonly', version: '1' } }
    : input.method === 'tools/list'
      ? { tools: [{ name: 'read', description: 'Read a fixed qualification value', inputSchema: { type: 'object', properties: {} } }] }
      : input.method === 'tools/call'
        ? (calls++, { content: [{ type: 'text', text: 'private-tailnet-ok' }] }) : {};
  res.writeHead(200, { 'content-type': 'application/json' }).end(JSON.stringify({ jsonrpc: '2.0', id: input.id, result }));
}).listen(8081, '127.0.0.1');
