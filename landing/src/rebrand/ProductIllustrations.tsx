import { ArrowRight, Check, CheckCheck, FileText, Globe2, Laptop, ShieldCheck } from "lucide-react";
import { Button, Card, Heading, Text } from "../ui/primitives";
import { MicoAvatar } from "./AgentHeroDemo";
import "./product-illustrations.css";

function DiagramLinks({ prefix }: { prefix: string }) {
  return <svg className="product-diagram-links" aria-hidden="true">{[0, 1, 2].map(index => <g key={index}>
    <path data-route-line data-route-from={`${prefix}-${index}`} data-route-to={`${prefix}-output`} />
    <path data-route-trace data-route-index={index} data-route-active />
    <g data-route-packet data-route-index={index} data-route-active opacity="0"><rect x="-8" y="-10" width="16" height="20" rx="3" /><path d="M-4 -3H4M-4 1H4M-4 5H1" /></g>
  </g>)}</svg>;
}

export function CollaborationDesk() {
  const contributors = [
    { avatar: "research", name: "Research", action: "Find the useful context", file: "Source notes" },
    { avatar: "planning", name: "Planning", action: "Shape a small first step", file: "Project outline" },
    { avatar: "writing", name: "Review", action: "Make the direction clearer", file: "Reviewed brief" },
  ];
  return <div className="collaboration-desk" data-product-diagram="collaboration" data-ui="mico-collaboration-example" role="group" aria-label="Illustrative collaboration: three Micos contribute to the same project brief">
    <DiagramLinks prefix="collab" />
    <div className="collaboration-sources">{contributors.map((mico, i) => <div className="collaboration-source" data-contributor={i} key={mico.name}>
      <div><MicoAvatar name={mico.avatar} /><strong>{mico.name}</strong><span className="collaboration-source-check"><Check size={12} /></span></div>
      <Text>{mico.action}</Text><small><FileText size={12} />{mico.file}</small><i className="product-diagram-port" data-route-port={`collab-${i}`} />
    </div>)}</div>
    <Card className="collaboration-paper"><i className="product-diagram-port" data-route-port="collab-output" />
      <header><span><FileText size={15} />Launch brief.md</span><small>Shared project</small></header>
      <div className="collaboration-paper-title"><span>THE FIRST RELEASE</span><Heading as="h3">Less scope.<br />A clearer next step.</Heading><Text>A useful direction, shaped together.</Text></div>
      <div className="collaboration-contribution" data-contribution={0}><span><FileText size={12} /></span><div><strong>Understand the need</strong><Text>Keep the project notes and the audience in view.</Text></div><small>Research</small></div>
      <div className="collaboration-contribution" data-contribution={1}><span><ArrowRight size={12} /></span><div><strong>Choose one complete workflow</strong><Text>Start with a small result people can try.</Text></div><small>Planning</small></div>
      <div className="collaboration-contribution" data-contribution={2}><span><Check size={12} /></span><div><strong>Leave room to learn</strong><Text>Review the result before expanding the scope.</Text></div><small>Review</small></div>
      <footer><span><CheckCheck size={15} />Ready for your review</span><small>One project. One direction.</small></footer>
    </Card>
    <div className="collaboration-margin-note"><span>Same context.<br />Different perspectives.</span><i /><small>The brief stays<br />in your workspace.</small></div>
  </div>;
}

const connections = [
  { name: "Your provider", label: "Connected provider", detail: "A model connection you configure.", Icon: Globe2 },
  { name: "Local model", label: "Local endpoint", detail: "A compatible endpoint on your setup.", Icon: Laptop },
  { name: "Mycellios network", label: "Network model", detail: "A model with available network capacity.", Icon: MicoAvatar },
];

export function ModelPatchbay({ selected, onSelect }: { selected: number; onSelect: (index: number) => void }) {
  const connection = connections[selected]!;
  return <div className="model-patchbay" data-product-diagram="models" data-active-source={selected} data-ui="model-continuity-example">
    <div className="model-patchbay-heading"><span>MODEL CONNECTION</span><small>Your project stays in place.</small></div>
    <div className="model-patchbay-body"><DiagramLinks prefix="model" /><div className="model-patchbay-sources" role="group" aria-label="Preview a model connection">{connections.map(({ name, Icon, detail }, i) => <Button key={name} variant="ghost" aria-pressed={selected === i} onClick={() => onSelect(i)}><Icon /><span><strong>{name}</strong><small>{detail}</small></span><i className="product-diagram-port" data-route-port={`model-${i}`} /></Button>)}</div>
      <div className="model-patchbay-project"><i className="product-diagram-port" data-route-port="model-output" /><MicoAvatar /><strong>Launch Mico</strong><small>Project workspace</small><div><FileText size={16} /><span>Launch notes.md</span><Check size={13} /></div><Text>Your goal, notes and next step stay together.</Text></div>
    </div><div className="model-patchbay-connection"><i /><span><strong>{connection.label}</strong><small>{connection.detail}</small></span><ArrowRight size={16} /><MicoAvatar /></div>
    <Text as="small" className="story-example-note">Connection preview. Available models and usage depend on your setup.</Text>
  </div>;
}

export function RoutineTimeline({ selected, time, file }: { selected: number; time: string; file: string }) {
  return <div className="routine-timeline" data-routine={selected}>
    <div className="routine-timeline-head"><span>YOUR WEEK</span><strong>{time}<small>Your chosen timezone</small></strong></div>
    <div className="routine-timeline-days">{["MON", "TUE", "WED", "THU", "FRI"].map((day, i) => <div key={day} className={selected === 0 || selected === 1 && i === 0 || selected === 2 && i === 4 ? "is-scheduled" : ""}><span>{day}</span><i /><small>{selected === 0 || selected === 1 && i === 0 || selected === 2 && i === 4 ? time : "—"}</small></div>)}</div>
    <div className="routine-run"><span><i />Scheduled work</span><div className="routine-run-track"><b data-routine-runner /><i /><i /><i /></div><span><FileText size={14} />A draft to review</span></div>
    <div className="routine-draft"><div className="routine-draft-tabs"><span>Notes</span><span>Draft</span><span>For your review</span></div><div><FileText size={21} /><span><strong>{file}</strong><small>Prepared from the context you provide</small></span><Check size={16} data-routine-check /></div></div>
  </div>;
}

export function ContextDocument({ decision }: { decision: "waiting" | "allowed" | "denied" }) {
  return <div className="context-document" data-decision={decision}>
    <div className="context-document-page"><header><FileText size={15} /><span>Project notes.md</span><small>Attached by you</small></header><Heading as="h3">The context<br />you choose to share.</Heading><Text>Project goal, constraints and the notes that help a Mico take the next step.</Text><div className="context-document-excerpt"><span>PROJECT NOTES</span><Text>Start with a clear brief.<br />Keep the first outcome small.<br />Leave the next action for review.</Text></div></div>
    <div className="context-access"><div><ShieldCheck size={22} /><span>{decision === "allowed" ? "Allowed once" : decision === "denied" ? "Access declined" : "Approval comes first"}</span></div><dl><div><dt>Scope</dt><dd>Attached notes</dd></div><div><dt>Connection</dt><dd>Your selected model</dd></div><div><dt>Access</dt><dd>{decision === "allowed" ? "This example only" : decision === "denied" ? "Not granted" : "Waiting for your decision"}</dd></div></dl><Text>{decision === "allowed" ? "The attached context can be used for this draft." : decision === "denied" ? "The notes stay unread in this example." : "Review what is shared before a Mico uses it."}</Text></div>
  </div>;
}
