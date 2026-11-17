export type Lang = "en" | "fr";
export const LANGS: readonly Lang[] = ["en", "fr"];

const en = {
  tagline: "Auction house prices for WoW Forever",
  search: "Search an item or ID",
  noResults: "No item found",
  realm: "Realm",
  faction: "Faction",
  horde: "Horde",
  alliance: "Alliance",
  watchlist: "Watchlist",
  watchlistEmpty: "Star an item to follow it here.",
  addWatch: "Add to watchlist",
  removeWatch: "Remove from watchlist",
  timeframe: "Timeframe",
  chartType: "Chart",
  candles: "Candles",
  line: "Line",
  indicators: "Indicators",
  volume: "Listed qty",
  market: "Market price",
  minBuyout: "Lowest buyout",
  listed: "Quantity listed",
  auctions: "Auctions",
  change24h: "24h",
  avg7d: "7-day average",
  updated: "Snapshot",
  sampleBanner: "Sample data: generated prices to show the charts. Live Forever prices arrive once the Blizzard feed is connected.",
  listedNote: "The auction house shows listings, not sales: volume is the quantity listed.",
  language: "Français",
  languageLabel: "Passer en français",
  notFound: "This item is not tracked yet.",
} as const;

export type MessageKey = keyof typeof en;

const fr: Record<MessageKey, string> = {
  tagline: "Prix de l'hôtel des ventes pour WoW Forever",
  search: "Chercher un objet ou un ID",
  noResults: "Aucun objet trouvé",
  realm: "Royaume",
  faction: "Faction",
  horde: "Horde",
  alliance: "Alliance",
  watchlist: "Liste de suivi",
  watchlistEmpty: "Ajoutez une étoile à un objet pour le suivre ici.",
  addWatch: "Ajouter à la liste de suivi",
  removeWatch: "Retirer de la liste de suivi",
  timeframe: "Intervalle",
  chartType: "Graphique",
  candles: "Chandeliers",
  line: "Ligne",
  indicators: "Indicateurs",
  volume: "Qté en vente",
  market: "Prix du marché",
  minBuyout: "Achat immédiat le plus bas",
  listed: "Quantité en vente",
  auctions: "Enchères",
  change24h: "24 h",
  avg7d: "Moyenne sur 7 jours",
  updated: "Relevé",
  sampleBanner: "Données d'exemple : prix générés pour montrer les graphiques. Les vrais prix de Forever arriveront quand le flux de Blizzard sera branché.",
  listedNote: "L'hôtel des ventes montre les annonces, pas les ventes : le volume est la quantité mise en vente.",
  language: "English",
  languageLabel: "Switch to English",
  notFound: "Cet objet n'est pas encore suivi.",
};

export const MESSAGES: Record<Lang, Record<MessageKey, string>> = { en, fr };

export function t(lang: Lang, key: MessageKey): string {
  return MESSAGES[lang][key];
}

/** French for any fr-* browser language, English otherwise. */
export function detectLang(preferred: readonly string[]): Lang {
  for (const tag of preferred) {
    const base = tag.toLowerCase().split("-")[0];
    if (base === "fr") return "fr";
    if (base === "en") return "en";
  }
  return "en";
}
