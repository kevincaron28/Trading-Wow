/**
 * The privacy policy shipped inside the app: PRIVACY.md, the same text as the page Google Play links to (the `legal`
 * branch), English first and French after the rule. It can be read offline.
 */
import policy from "../../PRIVACY.md?raw";
import type { Lang } from "./i18n";
import { blocks, type Block } from "./markdown";

export function policyBlocks(lang: Lang, markdown: string = policy): Block[] {
  const [en, fr] = markdown.replace(/\r/g, "").split(/\n---\n/);
  // The jump to the other language belongs to the web page: the app shows one language at a time.
  const part = ((lang === "fr" ? fr : en) ?? en ?? "").replace(/ · \[[^\]]*\]\(#[^)]*\)/g, "");
  return blocks(part);
}

/** The support address the policy publishes, so feedback and the policy can never disagree. */
export const SUPPORT_EMAIL: string = policy.match(/Support email: <([^>]+)>/)?.[1] ?? "";
