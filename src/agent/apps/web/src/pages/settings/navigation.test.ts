import { expect, it } from "vitest";
import { settingsKeywords, settingsMatch } from "./navigation";

it("finds the owner section from translated field names, accents and multiple terms", () => {
  expect(
    settingsMatch({ label: "Models", keywords: settingsKeywords.models }, "LÍMITES tokens"),
  ).toBe(true);
  expect(
    settingsMatch({ label: "Profile", keywords: settingsKeywords.profile }, "contraseña"),
  ).toBe(true);
  expect(
    settingsMatch({ label: "General", keywords: settingsKeywords.general }, "zona horaria"),
  ).toBe(true);
  expect(settingsMatch({ label: "Voice", keywords: settingsKeywords.voice }, "microfono")).toBe(
    true,
  );
  expect(settingsMatch({ label: "Models", keywords: settingsKeywords.models }, "microfono")).toBe(
    false,
  );
  expect(settingsMatch({ label: "Updates" }, "   ")).toBe(true);
  expect(settingsMatch({label:"Profile",keywords:settingsKeywords.profile},"uso costes")).toBe(true);
});
