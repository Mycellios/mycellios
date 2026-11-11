import { useState } from "react";
import { createRoot } from "react-dom/client";
import { MICO_COMPACT_AVATAR_INDEXES, micoAvatarValue, withMicoAvatarPalette } from "@rakazo/contracts";
import { BotAvatar } from "@rakazo/ui-web";
import "../../src/styles.css";

const names = ["Guide", "Builder", "Research", "Planner", "Support", "Studio"];
const colors = ["#3F9F78", "#D47046", "#5C84CC", "#C55480", "#3F9F78", "#B679BC"];
function Fixture() {
  const [values, setValues] = useState(() => MICO_COMPACT_AVATAR_INDEXES.map((index, i) => micoAvatarValue(index, colors[i]!)));
  return (
    <main style={{ padding: 24, maxWidth: 780, margin: "auto" }}>
      <h1 style={{ fontSize: 20, marginBottom: 16 }}>Compact Micos</h1>
      <div style={{ display: "flex", gap: 12, marginBottom: 20 }}>
        <button onClick={() => setValues(values.map((v) => withMicoAvatarPalette(v, "#C94A51")))}>All red</button>
        <button onClick={() => setValues(values.map((v) => withMicoAvatarPalette(v, "#3D4C9E")))}>All blue</button>
        <button onClick={() => setValues(values.map((v, i) => withMicoAvatarPalette(v, colors[i]!)))}>Individual colors</button>
      </div>
      <section aria-label="Conversation list" style={{ width: 340, maxWidth: "100%" }}>
        {values.map((color, i) => (
          <button key={i} data-mico-avatar-hover="" data-testid={`mico-${i}`} aria-label={names[i]}
            style={{ display: "flex", width: "100%", alignItems: "center", gap: 12, padding: 12, textAlign: "left", borderRadius: 10,
              background: i === 0 ? "var(--secondary)" : "transparent" }}>
            <BotAvatar color={color} identity={`fixture-${i}`} size={36} />
            <span><span style={{ display: "block", fontSize: 15 }}>{names[i]}</span><span style={{ fontSize: 12, color: "var(--muted-foreground)" }}>Conversation preview</span></span>
          </button>
        ))}
      </section>
      <section aria-label="Compatibility" style={{ display: "flex", gap: 12, marginTop: 24 }}>
        <BotAvatar color={micoAvatarValue(1001, "#C94A51", { eyes: 0, finish: "flat", original: false })} size={36} />
        <BotAvatar color={micoAvatarValue(1001, "#C94A51", { eyes: 7, finish: "plush", original: false })} size={36} />
        <BotAvatar color={micoAvatarValue(1014, "#A67A51")} size={36} />
        <BotAvatar color={micoAvatarValue(1002, "#BC8B32", { eyes: 0, finish: "plush", original: true })} size={36} />
        <BotAvatar color="data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+a7WQAAAAASUVORK5CYII=" size={36} />
      </section>
      <section aria-label="Working" style={{ marginTop: 24 }}>
        <BotAvatar color={values[0]!} size={64} status="running" />
      </section>
    </main>
  );
}
createRoot(document.getElementById("root")!).render(<Fixture />);
