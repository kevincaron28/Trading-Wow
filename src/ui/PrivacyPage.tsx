import { useRef } from "preact/hooks";
import type { Block, Span } from "../lib/markdown";
import { privacyUrl } from "../lib/links";
import { policyBlocks } from "../lib/policy";
import { t } from "../lib/i18n";
import { useStore } from "../app/store";
import { Page } from "./Page";

function Text({ spans }: { spans: Span[] }) {
  return (
    <>
      {spans.map((span, i) =>
        span.href ? <a key={i} href={span.href} target="_blank" rel="noopener">{span.text}</a>
        : span.bold ? <b key={i}>{span.text}</b>
        : span.italic ? <em key={i}>{span.text}</em>
        : span.code ? <code key={i}>{span.text}</code>
        : span.text,
      )}
    </>
  );
}

/** The privacy policy, readable inside the app and offline, with a jump to each section. */
export function PrivacyPage({ onClose }: { onClose: () => void }) {
  const s = useStore();
  const body = useRef<HTMLDivElement>(null);
  const content: Block[] = policyBlocks(s.lang);
  const sections = content.flatMap((b) => (b.kind === "h2" ? [b.text] : []));
  const jump = (title: string) => {
    const heading = [...(body.current?.querySelectorAll("h2") ?? [])].find((h) => h.textContent === title);
    heading?.scrollIntoView({ behavior: "smooth", block: "start" });
  };
  return (
    <Page title={t(s.lang, "privacyPolicy")} onClose={onClose}>
      <nav class="chips wrap policy-toc" aria-label={t(s.lang, "sections")}>
        {sections.map((title) => <button type="button" class="chip" key={title} onClick={() => jump(title)}>{title}</button>)}
      </nav>
      <div class="policy" ref={body}>
        {content.map((block, i) =>
          block.kind === "h1" ? null
          : block.kind === "h2" ? <h2 key={i}>{block.text}</h2>
          : block.kind === "p" ? <p key={i}><Text spans={block.spans} /></p>
          : <ul key={i}>{block.items.map((item, j) => <li key={j}><Text spans={item} /></li>)}</ul>,
        )}
        <p class="small"><a href={privacyUrl(s.lang)} target="_blank" rel="noopener">{t(s.lang, "openOnline")}</a></p>
      </div>
    </Page>
  );
}
