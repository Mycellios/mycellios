import { createRoot } from "react-dom/client";
import { useEffect, useState } from "react";
import { BotAvatar } from "@rakazo/ui-web";
import { companionAvatar } from "../../src/lib/companion-avatar";
import "../../src/styles.css";

const choices = ["#3f9f78", "#D47046::shape_1001", "#3f9f78::shape_1000", "#7046c0::shape_1002"];
function Fixture() {
  const [images,setImages] = useState<(string | undefined)[]>();
  useEffect(() => { void Promise.all(choices.map((color,i) => companionAvatar(color,"fixture-"+i))).then(setImages); },[]);
  return <main data-ready={Boolean(images)} className="flex gap-8 p-8">
    {choices.map((color,i) => <div key={color} className="flex flex-col gap-4">
      <BotAvatar color={color} identity={"fixture-"+i} size={64}/>
      {images ? <img data-avatar={i} src={images[i]} width={64} height={64} alt={color}/> : null}
    </div>)}
  </main>;
}
createRoot(document.getElementById("root")!).render(<Fixture/>);
