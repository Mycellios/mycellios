import { useEffect, useRef, useState } from "react";
import { ArrowUp, Bell, Check, ChevronDown, FileText, Folder, Mic, Monitor, MousePointer2, PanelLeftClose, PanelRight, Pause, Play, Plus, Search, ShieldCheck } from "lucide-react";
import { Button, IconButton, Input, Link, Select, Text } from "../ui/primitives";
import { AGENT_URL } from "./AssemblageAgent";
import { agentExamples, projectNotes } from "./agent-demo-content";
import "./mico-avatar.css";

export function MicoAvatar({ name = "mico", className = "" }: { name?: string; className?: string }) {
  return <span className={`mico-avatar ${className}`} data-mico={name} aria-hidden="true"><img src={`/assets/agent-demo/${name}.svg`} alt="" draggable="false" /><i className="mico-face" /></span>;
}

/** A synthetic product illustration. No model, file, permission or account API is called. */
export function AgentHeroDemo({ onPlaybackChange }: { onPlaybackChange: (playing: boolean) => void }) {
  const root = useRef<HTMLElement>(null);
  const searchToggle = useRef<HTMLButtonElement>(null);
  const motion = useRef<Awaited<ReturnType<typeof import("./agent-hero-motion")["animateAgentDemo"]>> | null>(null);
  const playIntent = useRef(true);
  const [selected, setSelected] = useState(0);
  const [playing, setPlaying] = useState(true), [reducedMotion, setReducedMotion] = useState(false);
  const [preview, setPreview] = useState<"notes" | "computer" | null>(null);
  const [permission, setPermission] = useState<"pending" | "allowed" | "denied">("pending");
  const [searchOpen, setSearchOpen] = useState(false), [query, setQuery] = useState("");
  const example = agentExamples[selected]!;
  useEffect(() => {
    const media = window.matchMedia("(prefers-reduced-motion: reduce)");
    const update = () => {
      setReducedMotion(media.matches);
      setPlaying(!media.matches && playIntent.current); onPlaybackChange(!media.matches && playIntent.current);
    };
    update(); media.addEventListener("change", update);
    return () => media.removeEventListener("change", update);
  }, [onPlaybackChange]);
  useEffect(() => {
    if (!searchOpen) return;
    const closeSearch = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      setSearchOpen(false); setQuery(""); searchToggle.current?.focus();
    };
    window.addEventListener("keydown", closeSearch);
    return () => window.removeEventListener("keydown", closeSearch);
  }, [searchOpen]);
  useEffect(() => {
    let active = true;
    setPreview(null); setPermission("pending");
    void import("./agent-hero-motion").then(({ animateAgentDemo }) => {
      if (!active || !root.current) return;
      motion.current = animateAgentDemo(root.current, example.request, () => {
        if (active) setPreview("notes");
      }, () => { if (active) setPermission("allowed"); }, () => { if (active) { setQuery(""); setSearchOpen(false); setSelected(index => (index + 1) % agentExamples.length); } });
      if (!playIntent.current) motion.current.pause();
    }).catch(() => { if (active) { setPlaying(false); onPlaybackChange(false); } });
    return () => { active = false; motion.current?.destroy(); motion.current = null; };
  }, [example, onPlaybackChange]);
  function pause() { playIntent.current = false; motion.current?.pause(); setPlaying(false); onPlaybackChange(false); }
  function togglePreview(mode: "notes" | "computer") { hold(); setPreview(current => current === mode ? null : mode); }
  function hold() { motion.current?.pause(); }
  function select(index: number) { setSelected(index); }
  return <figure className="agent-demo-figure" ref={root} aria-label="Animated example of Mycellios Agent">
    <div className="agent-demo-window" data-ui="agent-product-demo" data-preview={preview ? "open" : "closed"}>
      <aside className="agent-demo-sidebar" aria-label="Example Micos">
        <div className="agent-demo-sidebar-top"><img src="/assets/brand/favicon.png" width="26" height="26" alt="Mycellios" /><div><IconButton ref={searchToggle} variant="ghost" aria-label="Search example Micos" onClick={() => { hold(); if (searchOpen) setQuery(""); setSearchOpen(!searchOpen); }}><Search size={16} /></IconButton><span aria-hidden="true"><Bell size={16} /></span><span aria-hidden="true"><PanelLeftClose size={16} /></span><IconButton variant="ghost" aria-label="Show Mico example" onClick={() => select(0)}><Plus size={17} /></IconButton></div></div>
        {searchOpen && <Input autoFocus className="agent-demo-search" aria-label="Filter example Micos" placeholder="Search Micos" value={query} onChange={event => setQuery(event.target.value)} />}
        <div className="agent-demo-personal"><span>Personal</span><span aria-hidden="true">··· <ChevronDown size={12} /></span></div>
        <div className="agent-demo-roster">{agentExamples.map((item,index) => item.name.toLowerCase().includes(query.toLowerCase()) && <Button key={item.name} variant="ghost" className="agent-demo-mico" aria-pressed={selected === index} onClick={() => select(index)}><MicoAvatar name={item.avatar} /><span><strong>{item.name}<small>Now</small></strong><span>{item.preview}</span></span></Button>)}{!agentExamples.some(item => item.name.toLowerCase().includes(query.toLowerCase())) && <Text className="agent-demo-no-results">No matching Micos.</Text>}</div>
        <div className="agent-demo-sidebar-bottom"><Link href={AGENT_URL} aria-label="Open Mycellios Agent to connect apps"><span className="agent-demo-account" aria-hidden="true">M</span>Connect apps<Plus size={14} /></Link></div>
      </aside>
      <div className="agent-demo-conversation">
        <div className="agent-demo-toolbar"><span className="agent-demo-active"><MicoAvatar name={example.avatar} /><span>{example.name}</span></span><Select className="agent-demo-mobile-mico" aria-label="Choose example Mico" value={selected} onChange={event => select(Number(event.target.value))}>{agentExamples.map((item,index) => <option key={item.name} value={index}>{item.name}</option>)}</Select><div><IconButton variant="ghost" aria-label="Show example project notes" aria-pressed={preview === "notes"} onClick={() => togglePreview("notes")}><PanelRight size={16} /></IconButton><IconButton variant="ghost" aria-label="Show example computer view" aria-pressed={preview === "computer"} onClick={() => togglePreview("computer")}><Monitor size={16} /></IconButton></div></div>
        <div className="agent-demo-transcript" tabIndex={0} aria-label="Example conversation">
          <div className="agent-demo-thread" key={selected}>
            <span className="agent-demo-time">Today</span>
            <div className="agent-demo-step"><div className="agent-demo-message agent-demo-user">{example.request}</div></div>
            <div className="agent-demo-step"><div className="agent-demo-message agent-demo-answer">{example.response}</div></div>
            <div className="agent-demo-step"><div className="agent-demo-attachment"><FileText size={21} /><span><strong>Project notes</strong><small>README.md</small></span><span>Attached</span></div></div>
            <div className="agent-demo-step"><div className="agent-demo-permission"><div><ShieldCheck size={17} /><strong>{example.permission}</strong></div><Text>Use the notes attached to this example.</Text><div><span>{permission === "pending" ? "Approval required" : permission === "allowed" ? "Allowed once · example" : "Declined · example"}</span><Button variant="secondary" size="sm" disabled={permission !== "pending"} onClick={() => { hold(); setPermission("denied"); motion.current?.decline(); }}>Deny</Button><Button variant="primary" size="sm" className="agent-demo-allow" disabled={permission !== "pending"} onClick={() => { hold(); setPermission("allowed"); motion.current?.approve(); }}>Allow once</Button></div></div></div>
            <div className="agent-demo-step agent-demo-approved"><div className="agent-demo-action"><Check size={14} /><span>Read README.md</span><span>Allowed once</span></div></div>
            <div className="agent-demo-step agent-demo-result"><div className="agent-demo-message agent-demo-answer"><strong>{example.result}</strong><ul>{example.lines.map(line => <li key={line}><Check size={13} />{line}</li>)}</ul></div></div>
            <div className="agent-demo-step agent-demo-document"><Button variant="ghost" className="agent-demo-artifact" onClick={() => togglePreview("notes")}><FileText size={19} /><span><strong>Project plan</strong><small>Open preview</small></span><PanelRight size={15} /></Button></div>
            <div className="agent-demo-declined" hidden><div className="agent-demo-message agent-demo-answer">Access declined. Nothing was read.</div></div>
          </div>
        </div>
        <Link className="agent-demo-composer" href={AGENT_URL} aria-label="Open Mycellios Agent to send a message"><span aria-hidden="true"><Plus size={16} /></span><span className="agent-demo-draft" aria-hidden="true" data-placeholder={`Message ${example.name}`}></span><Mic size={16} aria-hidden="true" /><span className="agent-demo-send" aria-hidden="true"><ArrowUp size={15} /></span></Link>
      </div>
      {preview && <aside className="agent-demo-preview" aria-label={preview === "notes" ? "Example project notes" : "Example computer view"}><div><span>{preview === "notes" ? <FileText size={14} /> : <Monitor size={14} />}{preview === "notes" ? "README.md" : "Computer"}</span><IconButton variant="ghost" aria-label="Close example preview" onClick={() => setPreview(null)}><PanelRight size={15} /></IconButton></div>{preview === "notes" ? <pre>{projectNotes}</pre> : <div className="agent-demo-computer"><Folder size={28} /><strong>Project workspace</strong><Text>Your connected tools and files appear here.</Text><span>Illustrative view</span></div>}</aside>}
      <MousePointer2 className="agent-demo-cursor" size={23} fill="#242b26" stroke="#fff" strokeWidth={1.5} aria-hidden="true" />
    </div>
    <figcaption><span>Illustrative demo. Your connections, your permissions.</span><div><IconButton variant="ghost" disabled={reducedMotion} aria-label={reducedMotion ? "Animations disabled for reduced motion" : playing ? "Pause animations" : "Play animations"} onClick={() => { if (playing) pause(); else { playIntent.current = true; motion.current?.play(); setPlaying(true); onPlaybackChange(true); } }}>{playing ? <Pause size={14} /> : <Play size={14} />}</IconButton></div></figcaption>
  </figure>;
}
