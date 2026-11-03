import { expect, it } from "vitest";
import { isUnsafeRunRetry, unsafeRunRetryText } from "./retry-error";
it("recognizes the older server's no-replay rejection", () => {
 const message = "This request already produced output or actions. Continue in the chat to avoid repeating them.";
 expect(isUnsafeRunRetry(new Error(message))).toBe(true);
 expect(isUnsafeRunRetry({code:"CONFLICT", message})).toBe(true);
});
it("does not misclassify other failures", () => {
 for (const error of [null, undefined, "CONFLICT", new Error("Network failure"), {code:"CONFLICT"}]) expect(isUnsafeRunRetry(error)).toBe(false);
});
it("explains continuing with a new message instead of replaying actions", () => {
 expect(unsafeRunRetryText()).toContain("Send a new message to continue");
});

it('never classifies an explicit authentication refusal as a no-replay conflict',()=>{
 expect(isUnsafeRunRetry({code:'FORBIDDEN',message:'This request already produced output or actions. Continue in the chat to avoid repeating them.'})).toBe(false);
});
