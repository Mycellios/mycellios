import { useEffect, useRef, useState } from "react";
import { ArrowRight, Check, FileText, ShieldCheck } from "lucide-react";
import { Button, Card, Heading, Link, Text } from "../ui/primitives";
import { AGENT_URL } from "./AssemblageAgent";
import { MicoAvatar } from "./AgentHeroDemo";
import { useDemoAutoplay } from "./use-demo-autoplay";

const examples = [
  { name: "Plan a project", avatar: "planning", description: "Find a useful first step.", request: "Turn these launch notes into a plan I can review.", file: "Launch notes.md", context: "A first release for a small project: onboarding, one useful workflow, and feedback from early users.", title: "A smaller, clearer first release.", intro: "Start with one complete workflow. Learn from the first people who use it.", sections: [
    { title: "Shape the scope", body: "Agree on the audience and the one thing the first version should do well." },
    { title: "Build the full path", body: "Connect onboarding, the project space and the first useful result." },
    { title: "Make room to learn", body: "Gather feedback before adding another feature." },
  ] },
  { name: "Research an idea", avatar: "research", description: "Turn questions into a direction.", request: "What should we check before building this idea?", file: "Research brief.md", context: "A shared project space for a small studio. The idea is promising; the team's actual needs still need checking.", title: "Good questions before more features.", intro: "Separate what the team already knows from what needs evidence.", sections: [
    { title: "Ask the people doing the work", body: "Where does context get lost between a brief and a finished project?" },
    { title: "Check the assumptions", body: "Do people need a new workspace, or a better way to connect their current tools?" },
    { title: "Try one small experiment", body: "Walk through a real project with the team before committing to the full scope." },
  ] },
  { name: "Write a brief", avatar: "writing", description: "Give rough notes a clear shape.", request: "Make these notes into a short brief for the team.", file: "Workshop notes.md", context: "An introductory community workshop. Beginners welcome. Bring a laptop. Keep the session practical and leave time for questions.", title: "A workshop that starts with doing.", intro: "A practical introduction for curious people, with a small project to take home.", sections: [
    { title: "Who it is for", body: "Beginners who want to try an idea with a little guidance. No previous experience needed." },
    { title: "What to bring", body: "A laptop, an idea and a willingness to experiment." },
    { title: "What happens next", body: "Build something small together, then leave space for questions and next steps." },
  ] },
] as const;

export default function AgentUseCases() {
  const [selected, setSelected] = useState(0);
  const preview = useRef<HTMLDivElement>(null);
  const root = useRef<HTMLElement>(null);
  useDemoAutoplay(root, setSelected, examples.length, 6500);
  const example = examples[selected]!;
  useEffect(() => {
    let active = true, destroy: (() => void) | undefined;
    void import("./agent-hero-motion").then(({ animateCasePreview }) => {
      if (active && preview.current) destroy = animateCasePreview(preview.current);
    }).catch(() => {});
    return () => { active = false; destroy?.(); };
  }, [selected]);
  return <section ref={root} className="agent-use-cases reference-shell" aria-labelledby="agent-cases-title" data-ui-surface="agent-marketing">
    <div className="agent-case-copy"><Heading as="h2" id="agent-cases-title">A Mico for<br />what’s next.</Heading><Text>Start with a goal. Add the context.<br /> Keep the next step yours.</Text>
      <div className="agent-case-choices" role="group" aria-label="Choose an example workflow">{examples.map((item, index) => <Button key={item.name} variant="ghost" className="agent-case-choice" aria-pressed={selected === index} aria-controls="agent-case-preview" onClick={() => setSelected(index)}><MicoAvatar name={item.avatar} /><span><strong>{item.name}</strong><span>{item.description}</span></span><ArrowRight size={18} aria-hidden="true" /></Button>)}</div>
      <Link className="agent-case-open" href={AGENT_URL}>Start with your own idea<ArrowRight size={16} aria-hidden="true" /></Link>
    </div>
    <div className="agent-case-preview" id="agent-case-preview" ref={preview} data-ui="agent-case-preview" role="region" aria-label={`${example.name} example`}>
      <div className="agent-case-request"><MicoAvatar name={example.avatar} /><Text>{example.request}</Text></div>
      <div className="agent-case-context"><FileText size={20} aria-hidden="true" /><div><strong>{example.file}</strong><Text>{example.context}</Text></div></div>
      <div className="agent-case-permission"><ShieldCheck size={15} aria-hidden="true" /><span>Read attached notes</span><span><Check size={13} aria-hidden="true" />Allowed once</span></div>
      <Card className="agent-case-document" aria-labelledby="agent-case-document-title"><div className="agent-case-document-header"><FileText size={18} aria-hidden="true" /><span>{example.name === "Research an idea" ? "Research direction" : example.name === "Write a brief" ? "Workshop brief" : "Project plan"}</span><span>Draft</span></div><Heading as="h3" id="agent-case-document-title">{example.title}</Heading><Text>{example.intro}</Text><dl>{example.sections.map(section => <div key={section.title}><dt><Check size={14} aria-hidden="true" />{section.title}</dt><dd>{section.body}</dd></div>)}</dl></Card>
      <Text className="agent-case-caption">{example.name} · Illustrative example. You choose what to share.</Text>
    </div>
  </section>;
}
