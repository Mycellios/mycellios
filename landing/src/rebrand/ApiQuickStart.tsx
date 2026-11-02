import { useEffect, useRef, useState } from "react";
import { ArrowUpRight, Check, Copy } from "lucide-react";
import { Button, Heading, Link, Text } from "../ui/primitives";
import "./api-quick-start.css";

const examples = {
  Python: 'from openai import OpenAI\nimport os\n\nclient = OpenAI(\n    base_url="https://www.mycellios.com/v1",\n    api_key=os.environ["MYCELLIOS_API_KEY"],\n)\n\nresponse = client.chat.completions.create(\n    model="MODEL_ID",\n    messages=[{\n        "role": "user",\n        "content": "Hello, Mycellios.",\n    }],\n)\nprint(response.choices[0].message.content)',
  JavaScript: 'import OpenAI from "openai";\n\nconst client = new OpenAI({\n  baseURL: "https://www.mycellios.com/v1",\n  apiKey: process.env.MYCELLIOS_API_KEY,\n});\n\nconst response = await client.chat.completions.create({\n  model: "MODEL_ID",\n  messages: [{\n    role: "user",\n    content: "Hello, Mycellios.",\n  }],\n});\nconsole.log(response.choices[0].message.content);',
  curl: 'curl https://www.mycellios.com/v1/chat/completions \\\n  -H "Authorization: Bearer $MYCELLIOS_API_KEY" \\\n  -H "Content-Type: application/json" \\\n  -d \'{\n    "model": "MODEL_ID",\n    "messages": [{\n      "role": "user",\n      "content": "Hello, Mycellios."\n    }]\n  }\'',
} as const;

export default function ApiQuickStart() {
  const [language, setLanguage] = useState<keyof typeof examples>("Python"), [status, setStatus] = useState("");
  const timer = useRef<number | undefined>(undefined);
  useEffect(() => () => window.clearTimeout(timer.current), []);
  async function copy() {
    window.clearTimeout(timer.current);
    try { await navigator.clipboard.writeText(examples[language]); setStatus("Example copied"); }
    catch { setStatus("Select the code to copy it manually."); }
    timer.current = window.setTimeout(() => setStatus(""), 3000);
  }
  return <div className="api-quick-start" data-ui="api-example"><header><Heading as="h3">Your first request</Heading><Button variant="ghost" className="api-copy" aria-label="Copy API example" onClick={() => void copy()}>{status === "Example copied" ? <Check size={16} /> : <Copy size={16} />}</Button></header><div className="api-languages" role="group" aria-label="API example language">{(Object.keys(examples) as Array<keyof typeof examples>).map(value => <Button key={value} variant="ghost" className="marketing-toggle" aria-pressed={language === value} onClick={() => { setLanguage(value); setStatus(""); }}>{value}</Button>)}</div><pre tabIndex={0} aria-label={`${language} API example`}><code>{examples[language]}</code></pre><Text className="api-example-hint">Replace MODEL_ID with a chat model available to your API key. Keep your API key on your server.</Text><div className="api-example-footer"><Text as="small" role="status">{status || "OpenAI-compatible API"}</Text><Link href="/docs">Read the quickstart<ArrowUpRight size={13} /></Link></div></div>;
}
