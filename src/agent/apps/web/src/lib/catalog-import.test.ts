import { setupI18n } from "@lingui/core";
import type { Messages } from "@lingui/core";
import { expect, it } from "vitest";
import { messages as english } from "../locales/en/messages.po";
import { messages as spanish } from "../locales/es/messages.po";

it("compiles shipped PO catalogs during related-test discovery", () => {
  for (const [locale, messages] of [["en", english], ["es", spanish]] as const) {
    const i18n = setupI18n({ locale, messages: messages as Messages });
    expect(i18n._("integration.comingSoon")).toBe("Coming soon");
  }
});
