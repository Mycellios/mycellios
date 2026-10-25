import { useState } from "react";
import { Cpu, Laptop, Server, Smartphone } from "lucide-react";
import { Button, Text } from "../ui/primitives";
import { HeroMushroom } from "./HeroMushroom";
import { FruitingMark } from "./FruitingMark";

const devices = [
  { name: "Laptop", icon: Laptop, note: "A browser worker or native node, depending on your hardware." },
  { name: "Phone", icon: Smartphone, note: "A compatible browser can contribute with WebGPU support." },
  { name: "Server", icon: Server, note: "A native setup for supported systems and runtimes." },
];

/** Concept artwork, independent from observed network telemetry. */
export function NetworkWeave() {
  const [selected, setSelected] = useState(0);
  return <figure className="rooted-weave" aria-label="Mycellios network concept">
    <div className="rooted-organism" aria-hidden="true">
      <div className="rooted-sculpture"><FruitingMark /><HeroMushroom /></div>
      <svg className="rooted-rootlines" viewBox="0 0 700 530" fill="none">
        <g className="rooted-main-roots">
          <path d="M352 205 C350 270 238 233 173 312 S77 374 53 406 M352 225 C353 282 462 245 524 316 S611 367 655 404 M350 233 C303 307 341 362 349 458" />
          <path d="M175 311 C206 363 293 318 350 369 S483 397 524 317 M175 311 C226 275 270 288 350 303 S456 348 524 317" />
          <path d="M351 263 C280 237 226 245 206 200 M350 273 C405 215 447 239 470 189" />
        </g>
        <g className="rooted-fine-roots">
          <path d="M149 344 Q116 337 95 358 M114 369 Q127 394 104 414 M209 343 Q231 365 221 388 M279 338 Q256 372 283 397 M350 373 Q313 396 318 426 M353 419 Q376 437 380 463 M489 354 Q515 373 506 395 M557 350 Q585 343 603 362 M592 370 Q578 398 608 417 M287 267 Q279 236 257 225 M425 243 Q447 267 473 257" />
        </g>
        <g className="rooted-root-tips"><circle cx="53" cy="406" r="5" /><circle cx="655" cy="404" r="5" /><circle cx="349" cy="458" r="5" /><circle cx="206" cy="200" r="4" /><circle cx="470" cy="189" r="4" /></g>
      </svg>
      <span className={`rooted-device rooted-device-laptop${selected === 0 ? " is-selected" : ""}`}><Laptop /><span>Laptop</span></span>
      <span className={`rooted-device rooted-device-phone${selected === 1 ? " is-selected" : ""}`}><Smartphone /><span>Phone</span></span>
      <span className={`rooted-device rooted-device-server${selected === 2 ? " is-selected" : ""}`}><Server /><span>Server</span></span>
    </div>
    <figcaption className="rooted-weave-caption">
      <div className="rooted-device-picker" role="group" aria-label="Explore device types">
        {devices.map(({ name, icon: Icon }, index) => <Button key={name} variant="ghost" aria-pressed={selected === index} onClick={() => setSelected(index)}><Icon size={16} />{name}</Button>)}
      </div>
      <Text aria-live="polite">{devices[selected]!.note}</Text>
      <span className="rooted-concept-caption">Network concept</span>
    </figcaption>
  </figure>;
}

export function RequestDiagram() {
  return <figure className="rooted-request-diagram" aria-label="Concept: an app calls the Mycellios API, which coordinates compatible compute peers">
    <svg className="rooted-diagram-desktop" viewBox="0 0 660 300" role="img" aria-labelledby="request-diagram-title">
      <title id="request-diagram-title">An app, a common API, and a mesh of compute peers</title>
      <g className="rooted-diagram-paths" fill="none">
        <path d="M138 150 H210 Q220 150 220 140 V82 Q220 72 230 72 H280 M138 150 H210 Q220 150 220 160 V218 Q220 228 230 228 H280" />
        <path d="M380 72 H430 Q440 72 440 82 V140 Q440 150 450 150 H510 M380 228 H430 Q440 228 440 218 V160 Q440 150 450 150 H510 M330 108 V192" />
      </g>
      <g className="rooted-diagram-node"><rect x="24" y="112" width="114" height="76" rx="16" /><text x="81" y="155" textAnchor="middle">Your app</text></g>
      <g className="rooted-diagram-node"><rect x="280" y="34" width="100" height="76" rx="16" /><text x="330" y="78" textAnchor="middle">Laptop</text><rect x="280" y="190" width="100" height="76" rx="16" /><text x="330" y="234" textAnchor="middle">Server</text><rect x="510" y="112" width="114" height="76" rx="16" /><text x="567" y="155" textAnchor="middle">Browser</text></g>
      <g className="rooted-diagram-hub"><rect x="183" y="119" width="74" height="62" rx="14" /><text x="220" y="156" textAnchor="middle">API</text></g>
    </svg>
    <svg className="rooted-diagram-mobile" viewBox="0 0 360 290" role="img" aria-labelledby="request-diagram-mobile-title">
      <title id="request-diagram-mobile-title">Your app connects through the API to compatible compute peers</title>
      <g className="rooted-diagram-paths" fill="none"><path d="M88 145 H135 M205 145 H235 Q245 145 245 135 V58 Q245 48 255 48 H268 M205 145 H268 M205 145 H235 Q245 145 245 155 V232 Q245 242 255 242 H268 M310 76 V117 M310 173 V214" /></g>
      <g className="rooted-diagram-node"><rect x="2" y="117" width="86" height="56" rx="12" /><text x="45" y="150" textAnchor="middle">Your app</text><rect x="268" y="20" width="84" height="56" rx="12" /><text x="310" y="53" textAnchor="middle">Laptop</text><rect x="268" y="117" width="84" height="56" rx="12" /><text x="310" y="150" textAnchor="middle">Browser</text><rect x="268" y="214" width="84" height="56" rx="12" /><text x="310" y="247" textAnchor="middle">Server</text></g>
      <g className="rooted-diagram-hub"><rect x="135" y="117" width="70" height="56" rx="12" /><text x="170" y="150" textAnchor="middle">API</text></g>
    </svg>
    <figcaption><Cpu size={15} />One interface. Compatible models and routes.</figcaption>
  </figure>;
}
