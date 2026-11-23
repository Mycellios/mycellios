import { createPrivateKey, createPublicKey, type KeyObject } from "node:crypto";

import type { PinnedComponentUpdateKey } from "../contracts/component-update-manifest.js";
import { nodeComponentUpdatesSchema } from "../contracts/node-configuration.js";
import {
  COMPONENT_UPDATE_PUBLIC_KEY_SCHEMA,
  type ComponentSigningIdentity,
} from "./component-update-publisher.js";

/**
 * Stable node component releases (specs/node-runtime-auto-update). The private
 * key is generated offline by the owner and reaches only the protected release
 * job. The public trust anchor is the same value the installers embed, so CI
 * can sign only with a key the nodes already pin.
 */
export const STABLE_SIGNING_KEY_ENV = "MYCELLIOS_COMPONENT_STABLE_SIGNING_KEY";
export const NODE_COMPONENT_TRUST_ENV = "MYCELLIOS_NODE_COMPONENT_TRUST";
/** Secrets that must never reach child processes of a release build. */
export const RELEASE_SECRET_ENVIRONMENT = Object.freeze([
  STABLE_SIGNING_KEY_ENV,
  "MYCELLIOS_MODEL_ADMIN_TOKEN",
]);

export interface StableReleaseSigning {
  identity: ComponentSigningIdentity;
  pinnedStableKeys: readonly PinnedComponentUpdateKey[];
  feedUrl: string;
}

/**
 * Fails closed: without the trust anchor, without the private key, or with a
 * key that is not Ed25519 or not pinned for stable, nothing can be signed.
 * Errors carry fixed codes and never key material.
 */
export function resolveStableReleaseSigning(
  environment: NodeJS.ProcessEnv,
): StableReleaseSigning {
  const trustValue = environment[NODE_COMPONENT_TRUST_ENV]?.trim();
  if (!trustValue) throw new Error("component_release_stable_trust_missing");
  let trust: ReturnType<typeof nodeComponentUpdatesSchema.parse>;
  try {
    trust = nodeComponentUpdatesSchema.parse(JSON.parse(trustValue));
  } catch {
    throw new Error("component_release_stable_trust_invalid");
  }
  if (new URL(trust.feedUrl).protocol !== "https:") {
    throw new Error("component_release_stable_trust_invalid");
  }
  const pinnedStableKeys = trust.pinnedKeys.stable;
  if (pinnedStableKeys.length === 0) {
    throw new Error("component_release_stable_trust_missing");
  }

  const pem = environment[STABLE_SIGNING_KEY_ENV]?.trim();
  if (!pem) throw new Error("component_release_stable_signing_key_missing");
  let privateKey: KeyObject;
  try {
    privateKey = createPrivateKey({ key: pem, format: "pem" });
  } catch {
    throw new Error("component_release_stable_signing_key_invalid");
  }
  if (privateKey.type !== "private" || privateKey.asymmetricKeyType !== "ed25519") {
    throw new Error("component_release_stable_signing_key_invalid");
  }
  const spki = createPublicKey(privateKey)
    .export({ format: "der", type: "spki" })
    .toString("base64url");
  const pinned = pinnedStableKeys.find((key) => key.spki === spki);
  if (!pinned) throw new Error("component_release_stable_signing_key_not_pinned");
  return {
    identity: {
      privateKey,
      enrollment: {
        schema: COMPONENT_UPDATE_PUBLIC_KEY_SCHEMA,
        channel: "stable",
        keyId: pinned.keyId,
        spki,
      },
    },
    pinnedStableKeys,
    feedUrl: trust.feedUrl,
  };
}

/** A copy of the environment without release secrets, for child processes. */
export function releaseChildEnvironment(
  environment: NodeJS.ProcessEnv,
): NodeJS.ProcessEnv {
  const copy = { ...environment };
  for (const name of RELEASE_SECRET_ENVIRONMENT) delete copy[name];
  return copy;
}
