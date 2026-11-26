/** Lowercase, accents removed, so "etoffe" finds "Étoffe"; typographic apostrophes and œ/æ match what a keyboard types. */
export function normalize(text: string): string {
  return text
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[‘’]/g, "'")
    .replace(/œ/g, "oe")
    .replace(/æ/g, "ae")
    .trim();
}

/** The words of a typed query: "flask, titan" is flask and titan. */
export function queryWords(query: string): string[] {
  return query.split(/[\s,]+/).filter(Boolean);
}

/** Whether a name holds the query as typed, or every one of its words in any order (both already normalized). */
export function nameMatches(name: string, query: string): boolean {
  const words = queryWords(query);
  return name.includes(query) || (words.length > 0 && words.every((w) => name.includes(w)));
}
