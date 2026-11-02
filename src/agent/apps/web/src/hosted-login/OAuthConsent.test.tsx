// @vitest-environment jsdom
import { act } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import {
  AuthServiceError,
  EmailConfirmationRequired,
  loadAuthConfig,
  restoreAuthSession,
  signIn,
  signUp,
  validAuthSession,
} from "./auth";
import { OAuthConsent } from "./OAuthConsent";
import { getOAuthAuthorization } from "./oauth-consent";

vi.mock("./auth", async (original) => ({
  ...(await original<typeof import("./auth")>()),
  loadAuthConfig: vi.fn(),
  restoreAuthSession: vi.fn(),
  signIn: vi.fn(),
  signUp: vi.fn(),
  validAuthSession: vi.fn(),
}));
vi.mock("./first-party", () => ({
  loadFirstPartyClients: vi.fn(async () => []),
  isFirstPartyAuthorization: vi.fn(() => false),
  isFirstPartyReturn: vi.fn(() => false),
}));
vi.mock("./oauth-consent", async (original) => ({
  ...(await original<typeof import("./oauth-consent")>()),
  getOAuthAuthorization: vi.fn(),
  decideOAuthAuthorization: vi.fn(),
}));

const config = {
  enabled: true,
  url: "https://authority.example.test",
  anonKey: "public-fixture",
  providers: { email: true, google: false, twitter: false },
};
const session = {
  accessToken: "fixture-access",
  refreshToken: "fixture-refresh",
  expiresAt: Date.now() + 60_000,
  user: { id: "new-primary-user", email: "new@example.test" },
};
let host: HTMLDivElement, root: ReturnType<typeof createRoot>;
beforeEach(async () => {
  vi.clearAllMocks();
  localStorage.clear();
  window.history.replaceState(
    {},
    "",
    "/oauth/consent?authorization_id=fixture-authorization-12345",
  );
  vi.mocked(loadAuthConfig).mockResolvedValue(config);
  vi.mocked(restoreAuthSession).mockResolvedValue(null);
  vi.mocked(validAuthSession).mockResolvedValue(session);
  vi.mocked(signIn).mockResolvedValue(session);
  vi.mocked(signUp).mockResolvedValue(session);
  vi.mocked(getOAuthAuthorization).mockResolvedValue({
    authorization_id: "fixture-authorization-12345",
    client: { id: "external-client", name: "Client" },
    redirect_uri: "https://client.example.test/callback",
    scope: "openid email",
  });
  host = document.createElement("div");
  document.body.append(host);
  root = createRoot(host);
});
afterEach(async () => {
  await act(async () => root.unmount());
  host.remove();
});
async function render() {
  await act(async () => root.render(<OAuthConsent />));
  expect(host.querySelector('.login-brand')?.textContent).toBe('Mycellios');
}
async function click(text: string) {
  const b = [...host.querySelectorAll("button")].find((b) => b.textContent === text);
  expect(b).toBeDefined();
  await act(async () => b!.click());
}
async function submit() {
  const email = host.querySelector<HTMLInputElement>('[name="email"]')!;
  const password = host.querySelector<HTMLInputElement>('[name="password"]')!;
  email.value = "new@example.test";
  password.value = "a-strong-fixture-password";
  await act(async () =>
    host
      .querySelector("form")!
      .dispatchEvent(new Event("submit", { bubbles: true, cancelable: true })),
  );
}

it("offers registration before any login, with English as the first-visit default", async () => {
  await render();
  expect(host.querySelector("h1")?.textContent).toBe("Sign in");
  expect(host.textContent).toContain("New to Mycellios?");
  expect(host.querySelector(".login-switch")?.textContent).toBe("Create account");
  expect(signUp).not.toHaveBeenCalled();
  expect(signIn).not.toHaveBeenCalled();
});
it("uses the primary Mycellios registration and continues the same pending authorization", async () => {
  await render();
  await click("Create account");
  expect(host.querySelector('[name="password"]')?.getAttribute("autocomplete")).toBe(
    "new-password",
  );
  await submit();
  expect(signUp).toHaveBeenCalledWith(config, "new@example.test", "a-strong-fixture-password");
  expect(signIn).not.toHaveBeenCalled();
  expect(getOAuthAuthorization).toHaveBeenCalledWith(
    expect.objectContaining({ anonKey: config.anonKey }),
    session,
    "fixture-authorization-12345",
  );
  expect(location.search).toBe("?authorization_id=fixture-authorization-12345");
  expect(host.querySelector("h1")?.textContent).toBe("Authorize access");
});
it("preserves existing-account sign-in", async () => {
  await render();
  expect(host.querySelector('[name="password"]')?.getAttribute("autocomplete")).toBe(
    "current-password",
  );
  await submit();
  expect(signIn).toHaveBeenCalledWith(config, "new@example.test", "a-strong-fixture-password");
  expect(signUp).not.toHaveBeenCalled();
});
it("allows returning to login without losing the email or the authorization", async () => {
  await render();
  host.querySelector<HTMLInputElement>('[name="email"]')!.value = "new@example.test";
  await click("Create account");
  await click("Sign in");
  expect(host.querySelector<HTMLInputElement>('[name="email"]')!.value).toBe("new@example.test");
  expect(location.search).toContain("authorization_id=fixture-authorization-12345");
});
it("does not pretend a confirmation-required signup is authenticated", async () => {
  vi.mocked(signUp).mockRejectedValue(new EmailConfirmationRequired());
  await render();
  await click("Create account");
  await submit();
  expect(host.querySelector('[role="status"]')?.textContent).toContain("Check your email");
  expect(host.querySelector("h1")?.textContent).toBe("Sign in");
  expect(getOAuthAuthorization).not.toHaveBeenCalled();
});
it("shows a useful registration error without exposing backend diagnostics", async () => {
  vi.mocked(signUp).mockRejectedValue(new Error("private server detail"));
  await render();
  await click("Create account");
  await submit();
  expect(host.querySelector('[role="alert"]')?.textContent).toContain(
    "Could not create your account",
  );
  expect(host.textContent).not.toContain("private server detail");
  expect(host.querySelector(".login-switch")?.textContent).toBe("Sign in");
});
it("explains duplicate registration and preserves the email for sign-in", async () => {
  vi.mocked(signUp).mockRejectedValue(
    new AuthServiceError("private detail", 422, "user_already_exists"),
  );
  await render();
  await click("Create account");
  await submit();
  expect(host.querySelector('[role="alert"]')?.textContent).toContain(
    "already has a Mycellios account",
  );
  expect(host.textContent).not.toContain("private detail");
  await click("Sign in");
  expect(host.querySelector<HTMLInputElement>('[name="email"]')!.value).toBe("new@example.test");
  expect(getOAuthAuthorization).not.toHaveBeenCalled();
});
it("disables switching and submission while registration is in progress", async () => {
  let reject!: (reason: Error) => void;
  vi.mocked(signUp).mockImplementation(
    () =>
      new Promise((_resolve, r) => {
        reject = r;
      }),
  );
  await render();
  await click("Create account");
  await submit();
  expect(host.querySelector<HTMLButtonElement>('[type="submit"]')!.disabled).toBe(true);
  expect(host.querySelector<HTMLButtonElement>(".login-switch")!.disabled).toBe(true);
  await act(async () => reject(new Error("fixture failure")));
});
it("respects the saved Spanish choice", async () => {
  localStorage.setItem("rakazo.uiLocale", "es");
  await render();
  expect(host.querySelector(".login-switch")?.textContent).toBe("Crear cuenta");
  await click("Crear cuenta");
  expect(host.querySelector("h1")?.textContent).toBe("Crear tu cuenta");
});
