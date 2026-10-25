import { useState } from "react";
import { ArrowUp, Check, ChevronDown, Clock, Code2, FileText, Folder, Layers, Plus, Search, Settings, ShieldCheck, X } from "lucide-react";
import { Button, Card, Disclosure, DisclosureSummary, Heading, Link, Select, Text } from "../ui/primitives";

export const AGENT_URL = "https://www.mycellios.com/agent";
const logo = "/assets/brand/favicon.png";
const examples = [
  { name: "Project assistant", icon: Layers, request: "Review these project files.", response: "I can review the files and summarize what needs attention.", permission: "Read project files", description: "View the files in this example project.", result: "Access allowed for this example. In Agent, your connected model would review the project." },
  { name: "Research", icon: Search, request: "Help me research a new idea.", response: "Let's start with your question. I can search for context when you allow it.", permission: "Search the web", description: "Look up public sources for this example.", result: "Search allowed for this example. Open Agent to research with your own model and tools." },
];
const extendedExamples = [...examples,
  { name: "Writing", icon: FileText, request: "Help me make this brief clearer.", response: "I can help shape the structure and wording. Start with the notes you've attached, then decide what else to share.", permission: "Read project files", description: "View related notes in this example project.", result: "Access allowed for this example. Open Agent to work on your own documents." },
  { name: "Planning", icon: Layers, request: "Turn these notes into a practical plan.", response: "Let's identify the goal, the constraints and the next step. I can use the attached project context.", permission: "Read project files", description: "Read supporting files for this example plan.", result: "Access allowed for this example. No files were actually read." },
  { name: "Code review", icon: Code2, request: "Show me where to start reviewing this project.", response: "I'll start with the entry point and follow the request flow. You choose whether I can access the rest of the files.", permission: "Read project files", description: "View the source in this example project.", result: "Access allowed for this example. Open Agent to review your own project." },
];
const attachments = [
  { name: "README.md", text: "# Project notes\n\nA place to collect the idea,\nthe open questions and the\nnext steps.\n\n- Understand the request\n- Gather useful context\n- Choose what happens next" },
  { name: "architecture.md", text: "# Architecture notes\n\nClient → API → runtime\n\nQuestions to explore:\n- Where does the request go?\n- What can run locally?\n- Which context is needed?" },
  { name: "notes.md", text: "# Working notes\n\nKeep the goal clear.\nUse the context you need.\nAsk before taking action.\n\nNext: make a small plan." },
];

/** Local illustration of the permission flow; never sends a prompt or uses a tool. */
export function AssemblageAgent({ expanded = false }: { expanded?: boolean } = {}) {
  const [selected, setSelected] = useState(0);
  const [permission, setPermission] = useState<"pending" | "allowed" | "denied">("pending");
  const [model, setModel] = useState("connected");
  const [access, setAccess] = useState("Approval required");
  const [attachment, setAttachment] = useState(0);
  const [contextOpen, setContextOpen] = useState(false);
  const available = expanded ? extendedExamples : examples;
  const activeSelected = Math.min(selected, available.length - 1);
  const example = available[activeSelected]!;
  function select(index: number) { setSelected(index); setPermission("pending"); }
  return <div className="assembly-agent-showcase"><figure className="assembly-agent-figure">
    <div className="assembly-workspace theme-dark" data-ui="agent-demo" aria-label="Interactive example of Mycellios Agent">
      <aside className="assembly-agent-sidebar" aria-label="Example assistants">
        <div className="assembly-agent-brand"><img src={logo} alt="" width="28" height="28" /><span>Mycellios Agent</span></div>
        <div className="assembly-bots-label"><span>Assistants</span><Link href={AGENT_URL} aria-label="Create an assistant in Mycellios Agent"><Plus size={17} /></Link></div>
        <div className="assembly-assistants">{available.map((item, index) => <Button key={item.name} variant="ghost" aria-pressed={activeSelected === index} onClick={() => select(index)}><item.icon size={18} /><span>{item.name}</span></Button>)}</div>
        {expanded && <Select className="assembly-mobile-assistant" aria-label="Example assistant" value={activeSelected} onChange={event => select(Number(event.target.value))}>{available.map((item,index) => <option key={item.name} value={index}>{item.name}</option>)}</Select>}
        <Link className="assembly-agent-settings" href={AGENT_URL}><Settings size={17} />Settings</Link>
      </aside>
      <div className="assembly-conversation">
        <div className="assembly-conversation-top"><span><Layers size={17} />{example.name}</span><Select className="assembly-model-select" aria-label="Example model connection" value={model} onChange={event => setModel(event.target.value)}><option value="connected">Connected model</option><option value="choose">Choose a model</option></Select></div>
        <div className="assembly-messages" key={selected}>
          <div className="assembly-message-user">{example.request}</div>
          <div className="assembly-message-answer"><img src={logo} width="27" height="27" alt="" /><Text>{example.response}</Text></div>
          {expanded && <><div className="assembly-attached-note"><FileText size={17} /><div><strong>Attached context</strong><span>{attachments[attachment]!.name}</span></div><Button variant="ghost" onClick={() => { setAttachment((attachment + 1) % attachments.length); setContextOpen(true); }}>View next</Button></div><Disclosure className="assembly-inline-context" open={contextOpen} onToggle={event => setContextOpen(event.currentTarget.open)}><DisclosureSummary>View attached context<ChevronDown size={15} /></DisclosureSummary><div className="assembly-file-preview" aria-live="polite"><span>{attachments[attachment]!.name}</span><pre><code>{attachments[attachment]!.text}</code></pre></div></Disclosure></>}
          <div className="assembly-permission" aria-live="polite">
            <div className="assembly-permission-title">{permission === "allowed" ? <Check size={20} /> : permission === "denied" ? <X size={20} /> : <FileText size={20} />}<div><Heading as="h3">{permission === "pending" ? example.permission : permission === "allowed" ? "Allowed once" : "Access declined"}</Heading><Text>{permission === "pending" ? example.description : permission === "allowed" ? example.result : "Nothing was accessed. You stay in control."}</Text></div></div>
            <div className="assembly-permission-actions"><span><ShieldCheck size={15} />{permission === "pending" ? "Approval required" : "Example only"}</span>{permission === "pending" ? <div><Button variant="secondary" onClick={() => setPermission("denied")}>Deny</Button><Button variant="primary" onClick={() => setPermission("allowed")}>Allow once</Button></div> : <Button variant="ghost" onClick={() => setPermission("pending")}>Try again</Button>}</div>
          </div>
        </div>
        <Link className="assembly-composer" href={AGENT_URL} aria-label="Continue this conversation in Mycellios Agent"><Plus size={18} /><span>Continue in your workspace</span><span className="assembly-composer-send"><ArrowUp size={18} /></span></Link>
      </div>
      <aside className="assembly-agent-context" aria-label="Example project context"><div><Folder size={17} /><span>{expanded ? "Example attachments" : "Project context"}</span></div>{expanded ? <><div className="assembly-context-files" role="group" aria-label="Example attachments">{attachments.map((file,index) => <Button key={file.name} variant="ghost" aria-pressed={attachment === index} onClick={() => setAttachment(index)}><FileText size={16} />{file.name}</Button>)}</div><div className="assembly-file-preview"><span>{attachments[attachment]!.name}</span><pre><code>{attachments[attachment]!.text}</code></pre></div></> : <><ul><li><FileText size={17} />README.md</li><li><FileText size={17} />package.json</li><li><Folder size={17} />src/</li><li><Folder size={17} />docs/</li></ul><div className="assembly-tools-label"><Code2 size={17} />Tools</div><ul><li><FileText size={17} />Read project files</li><li><Search size={17} />Search the web</li></ul></>}<span className="assembly-context-caption">Choose what to share.</span></aside>
    </div>
    <figcaption>Example workspace. Try a permission request, then open Agent to work with your own connections.</figcaption>
  </figure><div className="assembly-agent-details">
    <Card className="assembly-agent-feature"><div><Layers size={24} /><Heading as="h3">Choose your model.</Heading><Text>Pick the connection that fits your task.</Text></div><div className="assembly-mini-ui" data-ui="model-example"><Disclosure open><DisclosureSummary><Layers size={15} />Choose a model<ChevronDown size={14} /></DisclosureSummary><div role="group" aria-label="Example model choices"><Button variant="ghost" aria-pressed={model === "connected"} onClick={() => setModel("connected")}><Layers size={16} />Connected model{model === "connected" && <Check size={15} />}</Button><Button variant="ghost" aria-pressed={model === "choose"} onClick={() => setModel("choose")}><Plus size={16} />Choose a model</Button><Link href={AGENT_URL}><Plus size={16} />Add a connection</Link></div></Disclosure></div></Card>
    <Card className="assembly-agent-feature"><div><ShieldCheck size={24} /><Heading as="h3">Set your permissions.</Heading><Text>Control what your agent can access.</Text></div><div className="assembly-mini-ui" data-ui="permission-example"><Disclosure open><DisclosureSummary><Folder size={15} />File access<ChevronDown size={14} /></DisclosureSummary><div role="group" aria-label="Example file access setting">{[{name:"Approval required",Icon:ShieldCheck},{name:"Allow once",Icon:Clock},{name:"Always allow",Icon:Check}].map(({name,Icon}) => <Button key={name} variant="ghost" aria-pressed={access === name} onClick={() => setAccess(name)}><Icon size={16} />{name}{access === name && <Check size={15} />}</Button>)}</div></Disclosure></div></Card>
  </div><Text className="assembly-settings-caption" aria-live="polite">Example file access setting: {access.toLowerCase()}.</Text></div>;
}
