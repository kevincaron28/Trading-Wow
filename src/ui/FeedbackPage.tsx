import { useState } from "preact/hooks";
import { Capacitor } from "@capacitor/core";
import { FEEDBACK_KINDS, detailLines, deviceFrom, feedbackMessage, type AppDetails, type FeedbackKind } from "../lib/feedback";
import { issueUrl, mailUrl } from "../lib/links";
import { SUPPORT_EMAIL } from "../lib/policy";
import { t } from "../lib/i18n";
import { houseId, useStore } from "../app/store";
import { houseLabel } from "./AlertsScreen";
import { Page } from "./Page";

const KIND_LABEL = { problem: "fbProblem", idea: "fbIdea", question: "fbQuestion" } as const;
const KIND_HINT = { problem: "fbHintProblem", idea: "fbHintIdea", question: "fbHintQuestion" } as const;

/** Report a problem or send an idea: by e-mail, as a public GitHub issue, or copied. The user sends it. */
export function FeedbackPage({ onClose }: { onClose: () => void }) {
  const s = useStore();
  const [kind, setKind] = useState<FeedbackKind>("problem");
  const [text, setText] = useState("");
  const [include, setInclude] = useState(true);
  const [note, setNote] = useState("");
  const details: AppDetails = {
    version: __APP_VERSION__,
    platform: Capacitor.isNativePlatform() ? "Android app" : "Website",
    device: deviceFrom(navigator.userAgent),
    house: houseLabel(houseId(s), "en"),
    lang: s.lang,
  };
  const message = feedbackMessage(kind, text, include ? details : null);
  const ready = text.trim().length > 0;
  const copy = () => {
    void navigator.clipboard.writeText(`${message.subject}\n\n${message.body}`).then(
      () => setNote(`${t(s.lang, "fbCopied")} ${SUPPORT_EMAIL}`),
      () => setNote(`${t(s.lang, "fbCopyFailed")} ${SUPPORT_EMAIL}`),
    );
  };
  return (
    <Page title={t(s.lang, "reportProblem")} onClose={onClose}>
      <div class="feedback">
        <p class="sheet-label">{t(s.lang, "fbKind")}</p>
        <div class="seg" role="radiogroup">
          {FEEDBACK_KINDS.map((k) => (
            <button type="button" role="radio" aria-checked={k === kind} class={k === kind ? "on" : ""} onClick={() => setKind(k)}>{t(s.lang, KIND_LABEL[k])}</button>
          ))}
        </div>
        <label class="field">
          <span>{t(s.lang, "fbText")}</span>
          <textarea rows={6} maxLength={2000} value={text} placeholder={t(s.lang, KIND_HINT[kind])} onInput={(e) => setText((e.target as HTMLTextAreaElement).value)} />
        </label>
        <label class="toggle">
          <input type="checkbox" checked={include} onChange={(e) => setInclude((e.target as HTMLInputElement).checked)} />
          {t(s.lang, "fbDetails")}
        </label>
        {include && <p class="muted small details-preview">{detailLines(details).join("\n")}</p>}
        {!ready && <p class="muted small">{t(s.lang, "fbWriteFirst")}</p>}
        <button type="button" class="btn wide" disabled={!ready} onClick={() => { window.location.href = mailUrl(SUPPORT_EMAIL, message.subject, message.body); }}>{t(s.lang, "fbEmail")}</button>
        <button type="button" class="btn wide ghost" disabled={!ready} onClick={() => window.open(issueUrl(message.subject, message.body), "_blank", "noopener")}>{t(s.lang, "fbGithub")}</button>
        <button type="button" class="btn wide ghost" disabled={!ready} onClick={copy}>{t(s.lang, "fbCopy")}</button>
        {note && <p class="small" role="status">{note}</p>}
        <p class="muted small">{t(s.lang, "fbNote")}</p>
      </div>
    </Page>
  );
}
