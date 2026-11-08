import { i18n } from "@lingui/core";
import type { RunErrorTranslator } from "@rakazo/core";

/** Static descriptors keep shared run-error messages in Lingui extraction. */
export const translateRunError: RunErrorTranslator = (message, values) => {
  switch (message) {
    case "Mycellios encountered an internal error.":
      return i18n._({ id: "Mycellios encountered an internal error.", message: "Mycellios encountered an internal error.", values });
    case "Desktop could not confirm the result. Review what it already did before continuing.":
      return i18n._({ id: "Desktop could not confirm the result. Review what it already did before continuing.", message: "Desktop could not confirm the result. Review what it already did before continuing.", values });
    case "{provider} could not complete the request. The cause is unknown.":
      return i18n._({ id: "{provider} could not complete the request. The cause is unknown.", message: "{provider} could not complete the request. The cause is unknown.", values });
    case "{provider} reached its usage quota.":
      return i18n._({ id: "{provider} reached its usage quota.", message: "{provider} reached its usage quota.", values });
    case "{provider} returned a server error.":
      return i18n._({ id: "{provider} returned a server error.", message: "{provider} returned a server error.", values });
    case "{provider} is temporarily unavailable.":
      return i18n._({ id: "{provider} is temporarily unavailable.", message: "{provider} is temporarily unavailable.", values });
    case "The model hit its output limit before writing a response.":
      return i18n._({ id: "The model hit its output limit before writing a response.", message: "The model hit its output limit before writing a response.", values });
    case "This task needs a workspace. Cloud workspaces are not available here yet.":
      return i18n._({
        id: "This task needs a workspace. Cloud workspaces are not available here yet.",
        message: "This task needs a workspace. Cloud workspaces are not available here yet.",
        values,
      });
    case "This Mico needs a workspace to run this task.":
      return i18n._({
        id: "This Mico needs a workspace to run this task.",
        message: "This Mico needs a workspace to run this task.",
        values,
      });
    case "Open this chat in Mycellios Desktop on the PC with the project, then retry.":
      return i18n._({
        id: "Open this chat in Mycellios Desktop on the PC with the project, then retry.",
        message: "Open this chat in Mycellios Desktop on the PC with the project, then retry.",
        values,
      });
    case "Your OpenRouter":
      return i18n._({ id: "Your OpenRouter", message: "Your OpenRouter", values });
    case "Your OpenAI":
      return i18n._({ id: "Your OpenAI", message: "Your OpenAI", values });
    case "Your Anthropic":
      return i18n._({ id: "Your Anthropic", message: "Your Anthropic", values });
    case "Your model provider":
      return i18n._({ id: "Your model provider", message: "Your model provider", values });
    case "Connect a model in Settings before running bots.":
      return i18n._({
        id: "Connect a model in Settings before running bots.",
        message: "Connect a model in Settings before running bots.",
        values,
      });
    case "Connect your own API key in Models or choose Mycellios credits in Billing.":
      return i18n._({
        id: "Connect your own API key in Models or choose Mycellios credits in Billing.",
        message: "Connect your own API key in Models or choose Mycellios credits in Billing.",
        values,
      });
    case "The model provider returned an error.":
      return i18n._({
        id: "The model provider returned an error.",
        message: "The model provider returned an error.",
        values,
      });
    case "{provider} rejected this request because it exceeds the plan's tokens-per-minute limit. Choose another model.":
      return i18n._({
        id: "{provider} rejected this request because it exceeds the plan's tokens-per-minute limit. Choose another model.",
        message: "{provider} rejected this request because it exceeds the plan's tokens-per-minute limit. Choose another model.",
        values,
      });
    case "{provider} is rate limiting requests. Try again shortly.":
      return i18n._({
        id: "{provider} is rate limiting requests. Try again shortly.",
        message: "{provider} is rate limiting requests. Try again shortly.",
        values,
      });
    case "{summary} Resets {date}.":
      return i18n._({
        id: "{summary} Resets {date}.",
        message: "{summary} Resets {date}.",
        values,
      });
    case "{provider} rejected the API key. Check your connection settings.":
      return i18n._({
        id: "{provider} rejected the API key. Check your connection settings.",
        message: "{provider} rejected the API key. Check your connection settings.",
        values,
      });
    case "{provider} can't run this model.":
      return i18n._({
        id: "{provider} can't run this model.",
        message: "{provider} can't run this model.",
        values,
      });
    case "{provider} denied access to this model.":
      return i18n._({
        id: "{provider} denied access to this model.",
        message: "{provider} denied access to this model.",
        values,
      });
    case "The model returned an unusable response. Try again.":
      return i18n._({
        id: "The model returned an unusable response. Try again.",
        message: "The model returned an unusable response. Try again.",
        values,
      });
    case "The model hit its output limit before finishing its reply.":
      return i18n._({
        id: "The model hit its output limit before finishing its reply.",
        message: "The model hit its output limit before finishing its reply.",
        values,
      });
    case "This model's context window is too small. Choose another model.":
      return i18n._({
        id: "This model's context window is too small. Choose another model.",
        message: "This model's context window is too small. Choose another model.",
        values,
      });
    case "{provider} took too long to respond. Try again.":
      return i18n._({
        id: "{provider} took too long to respond. Try again.",
        message: "{provider} took too long to respond. Try again.",
        values,
      });
    case "{provider} couldn't be reached. Check that it's running.":
      return i18n._({
        id: "{provider} couldn't be reached. Check that it's running.",
        message: "{provider} couldn't be reached. Check that it's running.",
        values,
      });
    case "{provider} is overloaded right now. Try again in a moment.":
      return i18n._({
        id: "{provider} is overloaded right now. Try again in a moment.",
        message: "{provider} is overloaded right now. Try again in a moment.",
        values,
      });
    case "The request did not fit the model's context. Retry or choose a model with a larger context.":
      return i18n._({
        id: "The request did not fit the model's context. Retry or choose a model with a larger context.",
        message:
          "The request did not fit the model's context. Retry or choose a model with a larger context.",
        values,
      });
    case "{provider} key hit its limit.":
      return i18n._({
        id: "{provider} key hit its limit.",
        message: "{provider} key hit its limit.",
        values,
      });
    case "{provider} key hit its daily limit.":
      return i18n._({
        id: "{provider} key hit its daily limit.",
        message: "{provider} key hit its daily limit.",
        values,
      });
    case "{provider} key hit its weekly limit.":
      return i18n._({
        id: "{provider} key hit its weekly limit.",
        message: "{provider} key hit its weekly limit.",
        values,
      });
    case "{provider} key hit its monthly limit.":
      return i18n._({
        id: "{provider} key hit its monthly limit.",
        message: "{provider} key hit its monthly limit.",
        values,
      });
    case "{provider} reached its credit limit.":
      return i18n._({
        id: "{provider} reached its credit limit.",
        message: "{provider} reached its credit limit.",
        values,
      });
    case "{provider} reached its daily credit limit.":
      return i18n._({
        id: "{provider} reached its daily credit limit.",
        message: "{provider} reached its daily credit limit.",
        values,
      });
    case "{provider} reached its weekly credit limit.":
      return i18n._({
        id: "{provider} reached its weekly credit limit.",
        message: "{provider} reached its weekly credit limit.",
        values,
      });
    case "{provider} reached its monthly credit limit.":
      return i18n._({
        id: "{provider} reached its monthly credit limit.",
        message: "{provider} reached its monthly credit limit.",
        values,
      });
    case "{provider} reached its spending limit.":
      return i18n._({
        id: "{provider} reached its spending limit.",
        message: "{provider} reached its spending limit.",
        values,
      });
    case "{provider} reached its daily spending limit.":
      return i18n._({
        id: "{provider} reached its daily spending limit.",
        message: "{provider} reached its daily spending limit.",
        values,
      });
    case "{provider} reached its weekly spending limit.":
      return i18n._({
        id: "{provider} reached its weekly spending limit.",
        message: "{provider} reached its weekly spending limit.",
        values,
      });
    case "{provider} reached its monthly spending limit.":
      return i18n._({
        id: "{provider} reached its monthly spending limit.",
        message: "{provider} reached its monthly spending limit.",
        values,
      });
    case "{summary} Your backup models also failed.":
      return i18n._({
        id: "{summary} Your backup models also failed.",
        message: "{summary} Your backup models also failed.",
        values,
      });
    case "{summary} No backup model was usable for this request.":
      return i18n._({
        id: "{summary} No backup model was usable for this request.",
        message: "{summary} No backup model was usable for this request.",
        values,
      });
    case "{summary} Backup models failed or were unavailable for this request.":
      return i18n._({
        id: "{summary} Backup models failed or were unavailable for this request.",
        message: "{summary} Backup models failed or were unavailable for this request.",
        values,
      });
    default:
      return message;
  }
};
