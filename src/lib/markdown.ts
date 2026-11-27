/**
 * The little Markdown the privacy policy uses (headings, paragraphs, bullet lists, bold, italics, code and links),
 * read into blocks the app can draw. Nothing is turned into HTML.
 */
export interface Span {
  text: string;
  bold?: boolean;
  italic?: boolean;
  code?: boolean;
  href?: string;
}

export type Block =
  | { kind: "h1"; text: string }
  | { kind: "h2"; text: string }
  | { kind: "p"; spans: Span[] }
  | { kind: "ul"; items: Span[][] };

const INLINE = /\*\*([^*]+)\*\*|\*([^*]+)\*|`([^`]+)`|\[([^\]]+)\]\(([^)\s]+)\)|<(https?:\/\/[^>\s]+)>|<([^>@\s]+@[^>\s]+)>/g;

export function spans(text: string): Span[] {
  const out: Span[] = [];
  let at = 0;
  for (const m of text.matchAll(INLINE)) {
    if (m.index > at) out.push({ text: text.slice(at, m.index) });
    const [whole, bold, italic, code, label, href, url, mail] = m;
    if (bold) out.push({ text: bold, bold: true });
    else if (italic) out.push({ text: italic, italic: true });
    else if (code) out.push({ text: code, code: true });
    else if (label) out.push({ text: label, href: href! });
    else if (url) out.push({ text: url, href: url });
    else out.push({ text: mail!, href: `mailto:${mail}` });
    at = m.index + whole.length;
  }
  if (at < text.length) out.push({ text: text.slice(at) });
  return out;
}

export function blocks(markdown: string): Block[] {
  const out: Block[] = [];
  for (const chunk of markdown.replace(/\r/g, "").split(/\n\s*\n/)) {
    const lines = chunk.split("\n").filter((l) => l.trim() && l.trim() !== "---");
    if (!lines.length) continue;
    const heading = lines[0]!.match(/^(##?) (.*)$/);
    if (heading) {
      out.push({ kind: heading[1] === "#" ? "h1" : "h2", text: heading[2]!.trim() });
      lines.shift();
      if (!lines.length) continue;
    }
    if (lines[0]!.startsWith("- ")) {
      // A line that does not start a new bullet continues the one above.
      const items: string[] = [];
      for (const line of lines) {
        if (line.startsWith("- ")) items.push(line.slice(2).trim());
        else items[items.length - 1] += ` ${line.trim()}`;
      }
      out.push({ kind: "ul", items: items.map(spans) });
    } else out.push({ kind: "p", spans: spans(lines.map((l) => l.trim()).join(" ")) });
  }
  return out;
}
