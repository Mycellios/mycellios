import { useEffect, useRef, useState, type RefObject } from "react";
import { ArrowRight, ArrowUpRight, CalendarDays, Check, CheckCheck, Copy, FileText, Globe2, Laptop, MousePointer2, RotateCcw, ShieldCheck } from "lucide-react";
import { Button, FieldLabel, Heading, Input, Link, Text } from "../ui/primitives";
import { MicoAvatar } from "./AgentHeroDemo";
import { MARKETING_AGENT_URL } from "./MarketingHeader";
import { useDemoAutoplay } from "./use-demo-autoplay";
import "./product-stories.css";
import { CollaborationDesk, ContextDocument, ModelPatchbay, RoutineTimeline } from "./ProductIllustrations";

function useStoryMotion(root: RefObject<HTMLElement | null>) {
  useEffect(() => {
    let active = true, dispose: (() => void) | undefined;
    void import("./product-story-motion").then(({ animateProductStory }) => {
      if (active && root.current) dispose = animateProductStory(root.current);
    }).catch(() => {});
    return () => { active = false; dispose?.(); };
  }, [root]);
}

function CollaborationStory() {
  const root = useRef<HTMLElement>(null);
  useStoryMotion(root);
  return <section ref={root} className="product-story story-collaboration reference-shell" id="mico-team" aria-labelledby="mico-team-title">
    <div className="story-heading" data-story-enter><Heading as="h2" id="mico-team-title">Good work grows<br />together.</Heading><Text>Give each Mico a focus. Bring their work into one shared direction.</Text></div>
    <div data-story-stage><CollaborationDesk /></div>
    <div className="story-demo-caption"><Text as="small">Illustrative collaboration. You choose the agents and the work they share.</Text></div>
  </section>;
}

function ModelStory() {
  const [selected, setSelected] = useState(0), root = useRef<HTMLElement>(null);
  useStoryMotion(root);
  useDemoAutoplay(root, setSelected, 3, 4500);
  return <section ref={root} id="model-connections" className="product-story story-model story-split reference-shell" aria-labelledby="story-model-title">
    <div className="story-copy" data-story-enter><Heading as="h2" id="story-model-title">Your Mico.<br />Your model.</Heading><Text>The project stays in view as you choose a model connection. Keep your notes and conversation together.</Text><Link href={MARKETING_AGENT_URL}>Explore model connections<ArrowUpRight size={15} /></Link></div>
    <div className="story-model-window story-window" data-story-stage data-ui="model-continuity-example">
      <div className="story-window-header"><MicoAvatar /><strong>Model connections</strong><span>Workspace settings</span></div>
      <ModelPatchbay selected={selected} onSelect={setSelected} />
    </div>
  </section>;
}

const browserBeats = [2200, 2200, 5000];
function BrowserStory() {
  const [stage, setStage] = useState(0), root = useRef<HTMLElement>(null);
  const selected = stage > 0, applied = stage === 2;
  const [interacted, setInteracted] = useState(false);
  useStoryMotion(root);
  useDemoAutoplay(root, step => { setStage(step); setInteracted(false); }, 3, browserBeats);
  return <div className="story-browser-band"><img className="story-browser-art" src="/assets/agent-demo/fungal-colonies-v1.webp" alt="" loading="lazy" width="1536" height="1024" /><section ref={root} id="project-preview" className="product-story story-browser reference-shell" aria-labelledby="story-browser-title" data-story-interacted={interacted}>
    <div className="story-heading" data-story-enter><Heading as="h2" id="story-browser-title">See the work.<br />Shape what’s next.</Heading><Text>Keep the project beside the conversation. Point to the part you want to discuss.</Text></div>
    <div className="story-browser-workspace story-window" data-story-stage data-ui="project-browser-example">
      <div className="story-browser-chat"><div className="story-window-header"><MicoAvatar /><strong>Website Mico</strong></div><Text>Let’s give your project a clearer first impression.</Text><div className="story-note"><FileText size={18} /><span><strong>Project preview</strong><small>Open beside the chat</small></span></div><div className="story-selection-note" aria-live={interacted ? "polite" : "off"}>{applied ? <><Check size={17} /><Text>The example headline is updated. Review it in the preview.</Text></> : selected ? <><MousePointer2 size={17} /><Text>Selected: page headline.<br />“Make this title shorter.”</Text></> : <><MousePointer2 size={17} /><Text>A detail becomes a focused note, then an update.</Text></>}</div><div className="story-browser-actions"><Button variant="secondary" onClick={() => { setInteracted(true); setStage(selected ? 0 : 1); }}>{selected ? "Clear selection" : "Try a selection"}</Button><Button variant="primary" disabled={!selected || applied} onClick={() => { setInteracted(true); setStage(2); }}>{applied ? "Example updated" : "Apply example"}</Button></div></div>
      <div className="story-browser-page"><div className="story-browser-address"><Globe2 size={14} /><span>Project preview</span><span>Browser</span></div><div className="story-site-preview"><span className="story-site-wordmark">Fieldwork</span><div className={selected ? "story-site-headline is-selected" : "story-site-headline"}><Heading as="h3">{applied ? "Make room for good ideas." : "A place for good ideas to grow."}</Heading>{selected && <span>Headline selected</span>}<i className="story-selection-frame" aria-hidden="true" /><div className="story-preview-cursor" aria-hidden="true"><MousePointer2 size={23} /><span>Select a detail</span></div></div><Text>A small studio for thoughtful projects. Bring a question. Build something useful.</Text><span className="story-site-action">Explore the project<ArrowRight size={15} /></span><div className="story-site-print" aria-hidden="true"><MicoAvatar name="planning" /><span /><MicoAvatar name="research" /><span /><MicoAvatar name="writing" /></div></div></div>
    </div><Text as="small" className="story-example-note">Interactive example. Changes affect this preview only. Native browser features depend on your app and setup.</Text>
  </section></div>;
}

const routines = [
  { name: "Morning brief", when: "Weekdays · 09:00", goal: "Turn the notes you provide into a short brief for the day.", file: "Morning brief.md", time: "09:00" },
  { name: "Project check-in", when: "Mondays · 10:00", goal: "Review your project context and prepare a short list of open questions.", file: "Project check-in.md", time: "10:00" },
  { name: "Weekly wrap-up", when: "Fridays · 16:00", goal: "Summarize the week’s shared updates and draft the next steps.", file: "Weekly wrap-up.md", time: "16:00" },
] as const;

function RoutineStory() {
  const [selected, setSelected] = useState(0), root = useRef<HTMLElement>(null);
  useStoryMotion(root);
  useDemoAutoplay(root, setSelected, routines.length, 6000);
  const routine = routines[selected]!;
  return <section ref={root} id="mico-routines" className="product-story story-split story-routines reference-shell" aria-labelledby="story-routine-title">
    <div className="story-routine-window story-window" data-story-stage data-ui="routine-schedule-example"><div className="story-window-header"><CalendarDays size={20} /><strong>Your rhythm</strong><span>Schedule preview</span></div><RoutineTimeline selected={selected} time={routine.time} file={routine.file} /><div className="routine-summary"><strong>{routine.name}</strong><Text>{routine.goal}</Text><span><CalendarDays size={14} />{routine.when} · your chosen timezone</span></div><Text as="small" className="story-example-note">Schedule example. Execution needs a connected model and an available runner.</Text></div>
    <div className="story-copy" data-story-enter><Heading as="h2" id="story-routine-title">Make space<br />for a routine.</Heading><Text>Give recurring work a goal and a schedule. Come back to a useful starting point.</Text><div className="story-routine-choices" role="group" aria-label="Choose a routine example">{routines.map((item, i) => <Button variant="ghost" aria-pressed={selected === i} key={item.name} onClick={() => setSelected(i)}><span>{item.name}<small>{item.when}</small></span><ArrowRight size={16} /></Button>)}</div><Link href={MARKETING_AGENT_URL}>Set up your own routine<ArrowUpRight size={15} /></Link></div>
  </section>;
}

const permissionBeats = [2400, 4400];
function ContextStory() {
  const root = useRef<HTMLElement>(null), [decision, setDecision] = useState<"waiting" | "allowed" | "denied">("waiting");
  useStoryMotion(root);
  useDemoAutoplay(root, step => setDecision(step ? "allowed" : "waiting"), 2, permissionBeats);
  return <section ref={root} id="context-control" className="product-story story-context reference-shell" aria-labelledby="story-context-title">
    <div className="story-copy" data-story-enter><Heading as="h2" id="story-context-title">Choose the context.<br />Review the action.</Heading><Text>Give a Mico the information it needs. Keep model connections, shared context and computer access clear.</Text></div>
    <div className="story-context-layout" data-story-stage><ContextDocument decision={decision} /><div className="story-permission-example" data-ui="context-permission-example"><ShieldCheck size={22} /><div><strong>Read the attached project notes</strong><Text>{decision === "waiting" ? "A focused request for this example." : decision === "allowed" ? "Allowed once in this example. The notes can be used for the draft." : "Declined in this example. The notes remain unread."}</Text></div><div>{decision === "waiting" ? <><Button variant="ghost" size="sm" onClick={() => setDecision("denied")}>Deny</Button><Button variant="primary" size="sm" onClick={() => setDecision("allowed")}>Allow once</Button></> : <Button variant="secondary" size="sm" onClick={() => setDecision("waiting")}><RotateCcw size={13} />Try again</Button>}</div></div><Text as="small" className="story-example-note">Permission example. Review the access and approval settings in your own workspace; your model provider’s data terms apply.</Text></div>
  </section>;
}

function GettingStartedStory() {
  const root = useRef<HTMLElement>(null), [step, setStep] = useState(0), [goal, setGoal] = useState("Plan my first project"), [copied, setCopied] = useState(false);
  useStoryMotion(root);
  useDemoAutoplay(root, setStep, 3, 5500);
  const prompt = `Help me ${goal.trim() || "plan my first project"}. Ask what context you need, outline a small first step, and leave the result ready for my review.`;
  const steps = ["Give it a goal", "Connect a model", "Add the context"];
  return <section ref={root} className="product-story story-start reference-shell" id="get-started" aria-labelledby="story-start-title"><div className="story-copy" data-story-enter><Heading as="h2" id="story-start-title">Meet your<br />first Mico.</Heading><Text>A goal, a model and the context to get started.</Text><div className="story-start-steps" role="group" aria-label="Explore the first-use steps">{steps.map((label, i) => <Button variant="ghost" aria-pressed={step === i} aria-controls="story-start-preview" key={label} onClick={() => setStep(i)}><span>{label}</span><ArrowRight size={16} /></Button>)}</div></div><div className="story-start-preview story-window" id="story-start-preview" data-story-stage data-ui="getting-started-example"><div className="story-window-header"><MicoAvatar /><strong>Your first Mico</strong><span>Setup preview</span></div><div className="starter-composer-progress" aria-label={`Setup step ${step + 1} of 3`}>{["Goal", "Model", "Context"].map((label,i)=><span key={label} data-active={step === i}><small>0{i + 1}</small>{label}<i /></span>)}</div><div className="story-start-body">{step === 0 ? <><FieldLabel htmlFor="mico-starter-goal">What would you like to work on?</FieldLabel><Input id="mico-starter-goal" value={goal} maxLength={160} onChange={event => { setGoal(event.target.value); setCopied(false); }} /><Text>Start with one useful outcome. You can refine it together.</Text></> : step === 1 ? <><Heading as="h3">Choose a supported connection.</Heading><Text>Connect a provider or compatible endpoint in Agent. Check the model’s capabilities, availability and usage before you begin.</Text><div className="story-note"><Globe2 size={19} /><span><strong>Your choice of model</strong><small>Configure the connection in your workspace</small></span></div></> : <><Heading as="h3">Bring the right context.</Heading><Text>Add the project notes or files you want your Mico to use. Review its access before asking it to act.</Text><div className="story-note"><FileText size={19} /><span><strong>Project notes.md</strong><small>Your goal, constraints and first questions</small></span></div></>}</div><div className="story-starter-prompt"><strong>Your starting prompt</strong><Text>{prompt}</Text><Button variant="ghost" size="sm" onClick={() => { void navigator.clipboard?.writeText(prompt).then(() => setCopied(true)).catch(() => setCopied(false)); }}>{copied ? <Check size={13} /> : <Copy size={13} />}{copied ? "Copied" : "Copy starter prompt"}</Button></div><Link href={MARKETING_AGENT_URL} variant="primary">Open Agent and get started<ArrowUpRight size={15} /></Link></div></section>;
}

export default function AgentProductStories() {
  return <div className="product-stories" data-ui="product-stories" data-ui-surface="agent-marketing"><CollaborationStory /><ModelStory /><BrowserStory /><RoutineStory /><ContextStory /><GettingStartedStory /></div>;
}
