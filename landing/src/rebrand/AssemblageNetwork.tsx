import { useEffect, useRef, useState } from "react";
import { ArrowRight, Check, Copy, Laptop, Server, Smartphone } from "lucide-react";
import { Button, Heading, Link, Text } from "../ui/primitives";

const endpoint = "https://www.mycellios.com/v1";
const peers = [
  { name: "Laptop", Icon: Laptop, x: 16, y: 27 },
  { name: "Desktop", Icon: Server, x: 72, y: 15 },
  { name: "Phone", Icon: Smartphone, x: 83, y: 69 },
  { name: "Server", Icon: Server, x: 32, y: 80 },
];
const edges = [[0, 1], [1, 2], [2, 3], [3, 0], [0, 2], [1, 3]];

export function AssemblageNetwork() {
  const [running, setRunning] = useState(false);
  const [complete, setComplete] = useState(false);
  const timer = useRef<number | undefined>(undefined);
  useEffect(() => () => window.clearTimeout(timer.current), []);
  function showRequest() {
    window.clearTimeout(timer.current); setComplete(false); setRunning(true);
    timer.current = window.setTimeout(() => { setRunning(false); setComplete(true); }, window.matchMedia("(prefers-reduced-motion: reduce)").matches ? 0 : 2800);
  }
  return <figure className="assembly-network-demo" data-running={running}>
    <div className="assembly-mesh" aria-label="Network concept: four device types connected by multiple paths" role="img">
      <svg viewBox="0 0 600 330" aria-hidden="true"><g>{edges.map(([a, b], index) => { const from = peers[a!]!; const to = peers[b!]!; return <path key={index} d={`M${from.x * 6},${from.y * 3.3} L${to.x * 6},${to.y * 3.3}`} className={index < 3 ? "assembly-route" : ""} />; })}</g>{running && <g className="assembly-packets"><circle r="4"><animateMotion dur="1.3s" repeatCount="2" path="M96,89 L432,49 L498,228 L192,264" /></circle><circle r="4"><animateMotion dur="1.4s" repeatCount="2" path="M192,264 L432,49 L96,89" /></circle></g>}</svg>
      {peers.map(({ name, Icon, x, y }) => <div key={name} className="assembly-peer" style={{ left: `${x}%`, top: `${y}%` }}><Icon size={25} /><span>{name}</span></div>)}
    </div>
    <div className="assembly-mesh-controls"><Button variant="secondary" onClick={showRequest} disabled={running}>{running ? "Following a request…" : complete ? "Show it again" : "Show a request"}<ArrowRight size={16} /></Button><span aria-live="polite">{running ? "A request moves between connected devices." : complete ? "Connections bring the parts together." : "Network concept"}</span></div>
    <figcaption>The network vision. Available devices, models and routes are shown in the <Link href="/network">network view</Link>.</figcaption>
  </figure>;
}

export function AssemblageApi() {
  const [status, setStatus] = useState<"idle" | "copied" | "failed">("idle");
  useEffect(() => { if (status === "idle") return; const timeout = window.setTimeout(() => setStatus("idle"), 3000); return () => window.clearTimeout(timeout); }, [status]);
  async function copy() { try { await navigator.clipboard.writeText(endpoint); setStatus("copied"); } catch { setStatus("failed"); } }
  return <div className="assembly-api" data-ui="endpoint"><div><Heading as="h3">Bring your own tools.</Heading><Text>Connect a client through the OpenAI-compatible API.</Text></div><div className="assembly-api-endpoint"><code>{endpoint}</code><Button variant="ghost" onClick={() => void copy()} aria-label="Copy API endpoint">{status === "copied" ? <Check size={17} /> : <Copy size={17} />}<span>{status === "copied" ? "Copied" : "Copy"}</span></Button></div><div className="assembly-api-bottom"><Link href="/docs">Read the API docs<ArrowRight size={16} /></Link><span role="status">{status === "failed" ? "Select the endpoint to copy it manually." : "Choose an available model in the panel."}</span></div></div>;
}
