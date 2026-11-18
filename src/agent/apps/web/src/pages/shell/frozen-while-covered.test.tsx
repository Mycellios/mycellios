// @vitest-environment jsdom
import { act } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, expect, it } from "vitest";
import { FrozenWhileCovered } from "./frozen-while-covered";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
const container = document.createElement("div");
const root = createRoot(container);
afterEach(() => act(() => root.render(null)));

it("keeps the covered background and catches up once uncovered", async () => {
  let renders = 0;
  function Background({ label }: { label: string }) {
    renders += 1;
    return <p>{label}</p>;
  }
  const show = (covered: boolean, label: string) =>
    act(() => root.render(<FrozenWhileCovered covered={covered}><Background label={label} /></FrozenWhileCovered>));

  await show(false, "first");
  await show(true, "second");
  await show(true, "third");
  expect(container.textContent).toBe("first");
  expect(renders).toBe(1);

  await show(false, "latest");
  expect(container.textContent).toBe("latest");
  expect(renders).toBe(2);
});
