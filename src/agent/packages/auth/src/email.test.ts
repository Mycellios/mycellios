import { describe, expect, it } from "vitest";
import {
  accountDeletionEmail,
  passwordResetEmail,
  signInCodeEmail,
  spaceInvitationEmail,
  verificationEmail,
} from "./email.js";

describe("account email templates", () => {
  const url = "https://app.example.test/verify?token=fake-token&callbackURL=%2Fsign-in";

  it.each([
    ["verification", () => verificationEmail("user@example.test", url)],
    [
      "password reset",
      () => passwordResetEmail({ id: "user-1", email: "user@example.test", name: "Test" }, url),
    ],
  ] as const)("preserves the exact %s link in HTML and text", async (_name, create) => {
    const message = await create();
    expect(message.to).toBe("user@example.test");
    expect(message.text).toContain(url);
    expect(message.html).toContain(`href="${url.replaceAll("&", "&amp;")}"`);
  });

  it("keeps a Space invitation's names out of the subject and escapes them in the body", async () => {
    const link = "https://app.example.test/join#fake_token_0123456789abcdefghijklmnopqrstuv";
    const message = await spaceInvitationEmail("guest@example.test", {
      inviterName: "<b>Ana</b>",
      spaceName: "Launch <i>team</i>",
      url: link,
    });
    expect(message.to).toBe("guest@example.test");
    expect(message.subject).not.toMatch(/Ana|Launch/);
    expect(message.html).toContain(`href="${link}"`);
    expect(message.html).toContain("&lt;b&gt;Ana&lt;/b&gt;");
    expect(message.html).not.toContain("<i>");
    expect(message.text).toContain(link);
  });

  it.each([signInCodeEmail, accountDeletionEmail])(
    "escapes code content and includes a plain-text fallback",
    async (create) => {
      const message = await create("user@example.test", "<script>fake-code</script>");
      expect(message.text).toContain("<script>fake-code</script>");
      expect(message.html).toContain("&lt;script&gt;fake-code&lt;/script&gt;");
      expect(message.html).not.toContain("<script>");
      expect(message.html).not.toContain("<a ");
    },
  );
});
