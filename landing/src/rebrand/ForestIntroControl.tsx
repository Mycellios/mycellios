import { useEffect, useState } from "react";
import { createPortal } from "react-dom";
import { Button } from "../ui/primitives";

export function ForestIntroControl() {
  const [target, setTarget] = useState(() => document.getElementById("forest-loader-actions"));
  useEffect(() => {
    const release = () => setTarget(null);
    window.addEventListener("mycellios:loader-released", release);
    return () => window.removeEventListener("mycellios:loader-released", release);
  }, []);
  return target ? createPortal(<Button variant="secondary" onClick={event => {
    if (event.detail > 0) event.currentTarget.blur();
    target.parentElement?.dispatchEvent(new Event("mycellios:forest-skip"));
  }}>Skip intro</Button>, target) : null;
}
