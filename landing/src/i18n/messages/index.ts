import * as account from "./account";
import * as contribute from "./contribute";
import * as downloads from "./downloads";
import * as history from "./history";
import * as overview from "./overview";
import * as shell from "./shell";

/** Each panel area owns one module; its keys start with the module name. */
export const panelMessageAreas = { account, contribute, downloads, history, overview, shell } as const;

const en = { ...shell.en, ...account.en, ...history.en, ...overview.en, ...contribute.en, ...downloads.en };
export type PanelMessageKey = keyof typeof en;
const es: Record<PanelMessageKey, string> = { ...shell.es, ...account.es, ...history.es, ...overview.es, ...contribute.es, ...downloads.es };

export const panelCatalogs: Readonly<Record<"en" | "es", Readonly<Record<PanelMessageKey, string>>>> = { en, es };
