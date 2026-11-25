/**
 * Public legal documents. `[[...]]` marks unresolved facts in a draft.
 * The page highlights them and shows a draft notice while any remain.
 */
export interface LegalSection {
  id: string;
  heading: string;
  paragraphs?: readonly string[];
  list?: readonly string[];
}
export interface LegalDocument {
  kind: "terms" | "privacy";
  title: string;
  updated: string;
  intro: string;
  sections: readonly LegalSection[];
}

const COMPANY = "[[legal name of the company]]";
const ADDRESS = "[[registered address]]";
const CONTACT = "hello@mycellios.com";
const PRIVACY_CONTROLLER = (import.meta.env?.VITE_PRIVACY_CONTROLLER as string | undefined)?.trim()
  || "[[legal name of the company]]";
const PRIVACY_CONTACT = (import.meta.env?.VITE_PRIVACY_CONTACT as string | undefined)?.trim()
  || "[[privacy contact email]]";
const PRIVACY_MINIMUM_AGE = 16;

export const TERMS: LegalDocument = {
  kind: "terms",
  title: "Mycellios Terms of Service",
  updated: "[[date of publication]]",
  intro:
    "These terms govern your use of Mycellios: the Agent workspace on the web, the Desktop and Android apps, the API and the optional compute network. Please read them together with our Privacy Policy.",
  sections: [
    { id: "acceptance", heading: "Acceptance", paragraphs: [
      "By creating an account or using Mycellios you agree to these terms. If you use Mycellios for an organization, you confirm that you can accept them on its behalf.",
      "If you do not agree, do not use Mycellios.",
    ] },
    { id: "who-we-are", heading: "Who we are", paragraphs: [
      `Mycellios is provided by ${COMPANY}, ${ADDRESS} ("Mycellios", "we"). You can reach us at ${CONTACT}.`,
    ] },
    { id: "accounts", heading: "Accounts and eligibility", paragraphs: [
      "You must be at least [[minimum age]] years old to use Mycellios. You are responsible for your account, for keeping your password and devices secure and for the activity of the agents that you create.",
      "Tell us promptly if you believe someone else has accessed your account.",
    ] },
    { id: "services", heading: "The services", paragraphs: [
      "Mycellios lets you create AI agents called Micos, talk to them, give them files and tools, connect apps and run routines. Micos can use models from Mycellios or from providers that you connect. Some features, such as local projects and computer use, run on a computer that you allow.",
      "Many features are in preview. They can change, be limited or be withdrawn, and we describe their real status in our documentation.",
    ] },
    { id: "credits", heading: "Credits, Spore and payments", paragraphs: [
      "Paid top-ups buy Mycellios Credits at 1 US dollar per Credit. Credits pay for usage of Mycellios models and services as shown before you use them. They are not money, cannot be transferred outside Mycellios and, except where the law requires otherwise, are not refundable.",
      "Spore is the Mycellios token. It has not been launched and has no price. Trial Spore or Credits that we give as a welcome or promotion have no monetary value and can expire.",
      "Payments are processed by Stripe. Prices and taxes are shown before you pay.",
    ] },
    { id: "compute", heading: "Contributing compute", paragraphs: [
      "Contributing a device's compute to the network is optional and needs your explicit permission. You earn Credits only for work that is accepted and independently verified. Earnings, availability and the use of your device are not guaranteed.",
      "You must own the device or have permission to use it this way, and you can stop contributing at any time.",
    ] },
    { id: "acceptable-use", heading: "Acceptable use", paragraphs: ["Do not use Mycellios, or let your agents act, to:"], list: [
      "break the law or infringe the rights of others;",
      "create or spread malware, attack systems or access them without permission;",
      "harass, defraud or deceive people, including by impersonating others;",
      "produce content that sexualizes minors or promotes violence against people;",
      "abuse the compute network, our infrastructure or other users' accounts;",
      "get around usage limits, payment or security measures.",
    ] },
    { id: "your-content", heading: "Your content", paragraphs: [
      "You keep the rights to what you upload and create. You give us the permission we need to store, process and transmit it to provide Mycellios, including sending it to the model providers that run your agents.",
      "You are responsible for having the rights to the content and data that you give your agents.",
    ] },
    { id: "ai-output", heading: "AI output", paragraphs: [
      "Agents and models can be wrong, incomplete or out of date. Review their output before you rely on it, especially for legal, medical, financial or safety decisions. Output may be similar to output that other users receive.",
    ] },
    { id: "agents", heading: "Agents that act for you", paragraphs: [
      "When you allow it, a Mico can use your connected apps, run commands, edit files and use a computer. It acts on your instructions and within the permissions you give it, and you are responsible for those actions. Review approvals carefully and use the least access a task needs.",
    ] },
    { id: "third-parties", heading: "Third-party providers and integrations", paragraphs: [
      "Models, connected apps and other integrations are provided by third parties under their own terms and policies. We are not responsible for their services, and their availability can change.",
    ] },
    { id: "software", heading: "Software and source code", paragraphs: [
      "The Mycellios source code is published under the PolyForm Shield License 1.0.0, which lets you use and modify it but not to build a competing product; code from other projects keeps its own license. That license governs your use of the code. These terms govern the services we run. The Mycellios name and logo are ours and are not licensed for other products.",
    ] },
    { id: "termination", heading: "Suspension and termination", paragraphs: [
      "You can stop using Mycellios and delete your account at any time. We can suspend or close an account that breaks these terms, puts others at risk or where the law requires it. Where possible we will tell you why and give you a chance to export your data.",
    ] },
    { id: "liability", heading: "Availability and liability", paragraphs: [
      "We provide Mycellios as it is and as available. To the extent the law allows, we are not liable for indirect or consequential losses, lost data or lost profits, and our total liability is limited to the amount you paid us in the 12 months before the claim.",
      "Nothing in these terms limits rights that consumer law gives you and that cannot be waived.",
    ] },
    { id: "privacy", heading: "Privacy", paragraphs: [
      "Our Privacy Policy explains how we process personal data.",
    ] },
    { id: "changes", heading: "Changes to these terms", paragraphs: [
      "We may update these terms. For important changes we will notify you in the app or by email before they apply. If you keep using Mycellios after a change applies, the new terms apply to you.",
    ] },
    { id: "law", heading: "Governing law", paragraphs: [
      "These terms are governed by the laws of [[country]], and the courts of [[city or country]] have jurisdiction, without depriving consumers of the protection of the laws of their country of residence.",
    ] },
    { id: "contact", heading: "Contact", paragraphs: [`Questions about these terms: ${CONTACT}.`] },
  ],
};

export const PRIVACY: LegalDocument = {
  kind: "privacy",
  title: "Mycellios Privacy Policy",
  updated: "25 November 2026",
  intro:
    "This policy explains what personal data Mycellios processes, why, who receives it and the choices you have. It covers the website, the Agent workspace, the Chrome extension, the Desktop and Android apps, the API and the compute network.",
  sections: [
    { id: "controller", heading: "Who is responsible", paragraphs: [
      `${PRIVACY_CONTROLLER} (Andorran tax registration 393340G), Plaça Bartomeu Rebes Duran, 5, pis 0, AD500 Andorra la Vella, Andorra, is responsible for processing your personal data. Contact us at ${PRIVACY_CONTACT}.`,
    ] },
    { id: "data-we-collect", heading: "Data we collect", list: [
      "Account: your email address, name, password (stored hashed) and sign-in records.",
      "Your content: messages, chat history, Mico instructions, memories, files, attachments, screenshots and the content of apps that you connect.",
      "Payments: Credit purchases and balances. Card details are handled by Stripe; we do not receive full card numbers.",
      "Compute contribution: if you enable it, device and runtime information needed to schedule, verify and pay for work.",
      "Technical data: device and app version, IP address, error reports and logs needed to run, secure and fix the service.",
    ] },
    { id: "chrome-extension", heading: "Chrome extension", paragraphs: [
      "The extension checks whether you have a Mycellios session and displays the hosted Agent workspace in Chrome’s side panel. Sign-in opens on Mycellios in a separate browser tab.",
      "The extension’s site access is limited to www.mycellios.com. It does not read the contents of other sites, your tabs or your browsing history. Account information and anything you enter into Agent through the panel are handled as described in this policy.",
      "Our use of data obtained through the extension complies with the Chrome Web Store User Data Policy, including its Limited Use requirements.",
    ] },
    { id: "use", heading: "How we use it", list: [
      "to provide Mycellios and run your agents, routines and integrations;",
      "to process payments and keep Credit balances;",
      "to keep accounts and the network secure and to prevent abuse;",
      "to diagnose problems and improve reliability;",
      "to contact you about your account, security and important changes.",
    ], paragraphs: ["We do not sell your personal data, and we do not use your content to train models."] },
    { id: "legal-bases", heading: "Legal bases", paragraphs: [
      "We process data to perform our contract with you, to meet legal obligations, for our legitimate interests in securing and improving the service, and with your consent where we ask for it, which you can withdraw at any time.",
    ] },
    { id: "ai", heading: "Use of AI models", paragraphs: [
      "To run your agents, the content needed for each task is sent to the model provider that runs it: Mycellios models or a provider you connect. Voice recordings are sent for transcription, and text you play is sent to generate speech. Summaries, memories and searches are sent to store and recall context.",
      "In Account settings you can review which data your agents share with AI providers.",
    ] },
    { id: "sharing", heading: "Who receives data", paragraphs: ["We share data only as needed to provide Mycellios, with:"], list: [
      "AI model providers that run your agents, including the ones you connect;",
      "Stripe, for payments;",
      "our hosting, database and network providers, including Cloudflare;",
      "Sentry, for error reports;",
      "GitHub, which delivers app downloads;",
      "the apps and services you connect, when your agents use them;",
      "authorities, when the law requires it.",
    ] },
    { id: "local", heading: "Data on your devices", paragraphs: [
      "The Desktop app keeps some data on your computer, such as local projects, settings and drafts. When you allow computer use, a Mico can read and change files on that computer within the permissions you give it.",
    ] },
    { id: "transfers", heading: "International transfers", paragraphs: [
      "Some providers process data outside your country. When they do, we rely on appropriate safeguards, such as standard contractual clauses, where the law requires them.",
    ] },
    { id: "retention", heading: "Retention and deletion", paragraphs: [
      "We retain account information and content as needed to provide your account and the features you use. To delete your account, use the account deletion option in Mycellios settings or contact us. You can also request deletion of specific personal data.",
      "When you delete your account, Mycellios removes your account and cleans up the agents, storage and computing resources assigned to it. A shared Space can remain available to its other members. The time needed for cleanup depends on the resources in use and the services that store them.",
      "We may retain records that are required for accounting or other legal obligations, or that are needed to investigate fraud or resolve disputes. How long we keep those records depends on the applicable obligation or the time needed to resolve the issue.",
    ] },
    { id: "security", heading: "Security", paragraphs: [
      "We protect data with encryption in transit, access controls and isolated environments for agents. No system is completely secure; tell us at once if you find a problem.",
    ] },
    { id: "rights", heading: "Your rights", paragraphs: [
      `You can ask to access, correct, delete, restrict or port your data, and object to processing. Write to ${PRIVACY_CONTACT}. You can complain to the Andorran Data Protection Agency (APDA) or your competent data protection authority.`,
    ] },
    { id: "cookies", heading: "Cookies", paragraphs: [
      "We use cookies and local storage that are needed to sign you in and keep your preferences. We do not use advertising cookies.",
    ] },
    { id: "children", heading: "Children", paragraphs: [
      `Mycellios is not intended for people under ${PRIVACY_MINIMUM_AGE}. If you believe someone under that age has given us personal data, contact us so we can investigate and delete it as appropriate.`,
    ] },
    { id: "changes", heading: "Changes", paragraphs: [
      "We may update this policy. For important changes we will notify you in the app or by email.",
    ] },
    { id: "contact", heading: "Contact", paragraphs: [`Privacy questions can be sent to ${PRIVACY_CONTACT}.`] },
  ],
};

export function legalPlaceholders(document: LegalDocument): string[] {
  const text = JSON.stringify(document);
  return [...new Set([...text.matchAll(/\[\[([^\]]+)\]\]/g)].map((match) => match[1]!))];
}
