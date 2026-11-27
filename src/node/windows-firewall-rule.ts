/**
 * Inbound Windows Firewall rule for the installed node. The direct transport
 * listens on an ephemeral port and authenticates every channel, so the rule is
 * scoped to the node's own executable over TCP instead of to a port. Domain
 * networks are left to their administrators.
 */
export const NODE_FIREWALL_RULE_NAME = "Mycellios node direct transport";

/** `netsh` treats each argument as one token, so spaces need no extra quoting. */
export function addNodeFirewallRuleArguments(nodeExecutable: string): string[] {
  return ["advfirewall", "firewall", "add", "rule", `name=${NODE_FIREWALL_RULE_NAME}`, "dir=in", "action=allow",
    `program=${nodeExecutable}`, "protocol=TCP", "profile=private,public", "enable=yes",
    "description=Authenticated Mycellios direct streams and artifact seed transfers"];
}

export function deleteNodeFirewallRuleArguments(): string[] {
  return ["advfirewall", "firewall", "delete", "rule", `name=${NODE_FIREWALL_RULE_NAME}`];
}
