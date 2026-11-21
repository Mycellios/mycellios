import { AdapterError } from "../adapters/base.js";

/**
 * A failure description that is safe to write to the PC's log files and to
 * send in `task.fail` (specs/node-owner-privacy, D6).
 *
 * Error messages can quote what was being processed: on Node 24 a JSON parse
 * error repeats the start of its input, and a runtime error body can echo a
 * request. Only short messages built from a plain character set survive;
 * everything else is reduced to the adapter code or the error class name.
 */
const SAFE_MESSAGE = /^[A-Za-z0-9 _.,:;()/+=-]{1,160}$/;

export function contentFreeFailure(error: unknown): string {
  if (error instanceof SyntaxError) return "invalid_runtime_output";
  if (error instanceof AdapterError) {
    return SAFE_MESSAGE.test(error.message) ? `${error.code}: ${error.message}` : error.code;
  }
  if (error instanceof Error) {
    const name = /^[A-Za-z][A-Za-z0-9_]{0,63}$/.test(error.name) ? error.name : "Error";
    return SAFE_MESSAGE.test(error.message) ? `${name}: ${error.message}` : name;
  }
  return "adapter_error";
}
