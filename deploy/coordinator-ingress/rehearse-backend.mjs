import { createHash } from "node:crypto";
import { createServer } from "node:http";

const { REVISION: revision, READY: ready } = process.env;
const server = createServer((request, response) => {
  if (request.url === "/stream") {
    response.writeHead(200, { "Content-Type": "text/plain" });
    const send = () => response.write(`${revision}\n`);
    send();
    const timer = setInterval(send, 50);
    response.once("close", () => clearInterval(timer));
    return;
  }
  response.writeHead(ready === "true" ? 200 : 503, { "Content-Type": "application/json" });
  response.end(JSON.stringify({ status: ready === "true" ? "ok" : "unavailable", revision }));
});
server.on("upgrade", (request, socket) => {
  const key = createHash("sha1").update(request.headers["sec-websocket-key"] + "258EAFA5-E914-47DA-95CA-C5AB0DC85B11").digest("base64");
  socket.write(`HTTP/1.1 101 Switching Protocols\r\nConnection: Upgrade\r\nUpgrade: websocket\r\nSec-WebSocket-Accept: ${key}\r\n\r\n`);
  const payload = Buffer.from(revision);
  const timer = setInterval(() => socket.write(Buffer.concat([Buffer.from([0x81, payload.length]), payload])), 50);
  socket.on("error", () => socket.destroy());
  socket.once("close", () => clearInterval(timer));
});
server.listen(4174, "0.0.0.0");
