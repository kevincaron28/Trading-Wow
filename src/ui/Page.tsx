import type { ComponentChildren } from "preact";
import { useEffect, useRef } from "preact/hooks";
import { onBack } from "../app/back";
import { t } from "../lib/i18n";
import { useStore } from "../app/store";
import { Icon } from "./parts";

/** A full screen over the app with a back arrow; Android Back closes it too. */
export function Page({ title, onClose, children }: { title: string; onClose: () => void; children: ComponentChildren }) {
  const s = useStore();
  const close = useRef(onClose);
  close.current = onClose;
  useEffect(() => onBack(() => close.current()), []);
  return (
    <div class="overlay page" role="dialog" aria-modal="true" aria-label={title}>
      <header class="topbar page-bar">
        <button type="button" class="icon-btn" onClick={onClose} aria-label={t(s.lang, "back")}>
          <Icon name="back" />
        </button>
        <h1 class="title">{title}</h1>
      </header>
      <div class="page-body">{children}</div>
    </div>
  );
}
