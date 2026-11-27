import { HELP } from "../data/help";
import { t } from "../lib/i18n";
import { setState, useStore } from "../app/store";
import { Page } from "./Page";

export function HelpPage({ onClose, onFeedback }: { onClose: () => void; onFeedback: () => void }) {
  const s = useStore();
  return (
    <Page title={t(s.lang, "help")} onClose={onClose}>
      {HELP[s.lang].map((section) => (
        <section key={section.id}>
          <h2 class="sheet-label">{section.title}</h2>
          {section.items.map((item) => (
            <details class="faq" key={item.q}>
              <summary>{item.q}</summary>
              {item.a.map((paragraph) => <p key={paragraph}>{paragraph}</p>)}
            </details>
          ))}
        </section>
      ))}
      <h2 class="sheet-label">{t(s.lang, "stillStuck")}</h2>
      <ul class="menu-list page-actions">
        <li><button type="button" onClick={onFeedback}>{t(s.lang, "reportProblem")}</button></li>
        <li><button type="button" onClick={() => { onClose(); setState({ onboarded: false }); }}>{t(s.lang, "replayTour")}</button></li>
      </ul>
    </Page>
  );
}
