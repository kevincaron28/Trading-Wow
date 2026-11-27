/**
 * Help & FAQ (Settings), English and French. Every number here comes from the code that does the work: the market tab's
 * rules (src/lib/overview.ts), alerts (src/lib/alerts.ts, dealAlerts.ts), the indexes (docs/INDEXES.md) and the price
 * files (docs/DATA.md). tests/help.test.ts holds the main ones to the code. Money is g/s/c in both languages.
 */
import type { Lang } from "../lib/i18n";

export interface HelpSection {
  id: "data" | "indexes" | "flips" | "alerts" | "app";
  title: string;
  items: { q: string; a: string[] }[];
}

const en: HelpSection[] = [
  {
    id: "data",
    title: "Prices and freshness",
    items: [
      {
        q: "Where do the prices come from?",
        a: ["From Blizzard's auction house data for World of Warcraft Forever, US (Americas) region: all 12 houses (PvP, Normal, RP and RP-PvP; Alliance, Horde and neutral Blackwater)."],
      },
      {
        q: "How fresh are they?",
        a: [
          "Blizzard's data changes about once an hour, and Goblin Ledger collects it each time. The screens show how long ago the prices were updated; the Watchlist also shows when the next update is expected. Pull down to refresh.",
          "Without a connection you see the last prices saved on your phone.",
        ],
      },
      {
        q: "What are market price and lowest buyout?",
        a: [
          "The lowest buyout is the cheapest unit on sale right now. The market price is the typical price of the cheapest part of the listings, so one absurd auction does not move it.",
          "Prices are in gold, silver and copper, like in the game: 1g = 100s = 10,000c. Example: 12g 50s 00c is twelve and a half gold.",
        ],
      },
      {
        q: "Are the sales real?",
        a: ["The auction house shows listings, not sales. “Volume” is the quantity listed. Sales per day are an estimate from auctions that disappear before they could expire (bought or cancelled)."],
      },
      {
        q: "How far back does the history go?",
        a: ["Daily prices go back to the launch week (4 November 2026) and hourly prices start on 18 November. The neutral Blackwater houses start later."],
      },
    ],
  },
  {
    id: "indexes",
    title: "Indexes and rebalancing",
    items: [
      {
        q: "What is Ledger 100?",
        a: ["A price index of the 100 items that trade the most gold in an auction house, much like a stock index. Other indexes follow herbs, ores and bars, cloth, leather, enchanting materials, elementals, consumables and raid preparation. 100 is the level at the start; 50 means the basket costs about half as much."],
      },
      {
        q: "How is it calculated?",
        a: ["Each item has a weight based on the gold it trades in a day, with a cap so that one item cannot rule the index. The index moves with the weighted geometric mean of the price changes, so a price that doubles and one that halves cancel out. Prices are smoothed over several hours and spikes are limited."],
      },
      {
        q: "When does the basket change?",
        a: [
          "Reviews happen at the weekly reset, Tuesday 15:00 UTC: each week during the launch (10, 17 and 24 November), then on the first reset of each month. In January, April, July and October the basket is rebuilt from the last 14 days.",
          "A review never moves the level: only prices do. The Indexes screen lists what each review added and removed.",
        ],
      },
      {
        q: "Why is an index missing in my house?",
        a: ["An index needs at least 5 actively traded items in that house."],
      },
    ],
  },
  {
    id: "flips",
    title: "Flips and crafts",
    items: [
      {
        q: "What counts as a flip on the Market tab?",
        a: [
          "An item that sells at least 3 a day whose lowest buyout is at least 15% under its 7-day average, where reselling still pays at least 10% and 10s after the auction house cut. The resale price is the market price, never above the 7-day average.",
          "Example: buy at 12g 50s, resell at 15g. The 5% cut takes 75s, so you receive 14g 25s: a profit of 1g 75s.",
        ],
      },
      {
        q: "How much is the auction house cut?",
        a: ["5% in the Alliance and Horde houses, 15% in the neutral Blackwater house. Deposits are not included in any profit."],
      },
      {
        q: "How is craft profit worked out?",
        a: [
          "The item's price after the cut, minus the cost of its materials: the cheapest recipe, with every reagent priced (merchant reagents at the merchant price).",
          "Example: materials 3g 20s, item sold at 4g. After the 5% cut you receive 3g 80s: a profit of 60s.",
        ],
      },
      {
        q: "Is the profit guaranteed?",
        a: ["No. The numbers show the market as it is now. Prices move, and other players may undercut you before your auction sells."],
      },
    ],
  },
  {
    id: "alerts",
    title: "Alerts",
    items: [
      {
        q: "How do I make a price alert?",
        a: ["Open an item's chart, tap the bell, choose “falls to” or “rises to” and enter a price in gold (12.5 means 12g 50s). The alert fires once; turn it on again from the Alerts tab."],
      },
      {
        q: "What are deal alerts?",
        a: ["On the Alerts tab, watch a whole watchlist: you are told when an item's lowest buyout is 20%, 30% or 50% under its 7-day average, if it sells every day and you would save at least 10s. The same item is reported again only after its price has recovered, and never twice within 12 hours."],
      },
      {
        q: "When are alerts checked?",
        a: ["While the app is open, and on Android about every 30 minutes in the background. The phone decides the exact time and battery savers can delay it. Allow notifications for Goblin Ledger in Android's settings."],
      },
    ],
  },
  {
    id: "app",
    title: "The app and your data",
    items: [
      {
        q: "Do I need an account?",
        a: ["No. There is no account, no advertising and no tracking. Your lists, alerts and settings stay on your phone, and uninstalling the app deletes them."],
      },
      {
        q: "Is this an official Blizzard app?",
        a: ["No. Goblin Ledger is an independent fan project, not affiliated with or endorsed by Blizzard Entertainment."],
      },
    ],
  },
];

const fr: HelpSection[] = [
  {
    id: "data",
    title: "Prix et fraîcheur",
    items: [
      {
        q: "D’où viennent les prix?",
        a: ["Des données de l’hôtel des ventes de World of Warcraft Forever publiées par Blizzard pour la région des États-Unis (Amériques) : les 12 hôtels (JcJ, Normal, JdR et JdR-JcJ; Alliance, Horde et Bourbe-Noire neutre)."],
      },
      {
        q: "Sont-ils à jour?",
        a: [
          "Les données de Blizzard changent environ une fois par heure et Goblin Ledger les relève à chaque fois. Les écrans indiquent depuis quand les prix datent; la liste de suivi indique aussi quand la prochaine mise à jour est attendue. Tirez vers le bas pour actualiser.",
          "Sans connexion, vous voyez les derniers prix enregistrés sur votre téléphone.",
        ],
      },
      {
        q: "Prix du marché et achat immédiat le plus bas?",
        a: [
          "L’achat immédiat le plus bas est l’unité la moins chère en vente en ce moment. Le prix du marché est le prix typique de la partie la moins chère des annonces : une enchère absurde ne le fait pas bouger.",
          "Les prix sont en pièces d’or, d’argent et de cuivre, comme dans le jeu : 1g = 100s = 10 000c. Exemple : 12g 50s 00c vaut douze pièces d’or et demie.",
        ],
      },
      {
        q: "Les ventes sont-elles réelles?",
        a: ["L’hôtel des ventes montre les annonces, pas les ventes. Le « volume » est la quantité en vente. Les ventes par jour sont une estimation à partir des enchères disparues avant de pouvoir expirer (achetées ou annulées)."],
      },
      {
        q: "Jusqu’où remonte l’historique?",
        a: ["Les prix quotidiens remontent à la semaine du lancement (4 novembre 2026) et les prix horaires commencent le 18 novembre. Les hôtels neutres de Bourbe-Noire commencent plus tard."],
      },
    ],
  },
  {
    id: "indexes",
    title: "Indices et rééquilibrage",
    items: [
      {
        q: "Qu’est-ce que Ledger 100?",
        a: ["Un indice des prix des 100 objets qui échangent le plus d’or dans un hôtel des ventes, comme un indice boursier. D’autres indices suivent les herbes, les minerais et barres, le tissu, le cuir, les matériaux d’enchantement, les éléments, les consommables et la préparation aux raids. 100 est le niveau de départ; 50 veut dire que le panier coûte environ deux fois moins."],
      },
      {
        q: "Comment est-il calculé?",
        a: ["Chaque objet a un poids selon l’or qu’il échange en une journée, avec un plafond pour qu’aucun ne domine l’indice. L’indice suit la moyenne géométrique pondérée des variations de prix : un prix qui double et un prix qui diminue de moitié s’annulent. Les prix sont lissés sur plusieurs heures et les pointes sont limitées."],
      },
      {
        q: "Quand le panier change-t-il?",
        a: [
          "Les révisions ont lieu à la réinitialisation hebdomadaire, le mardi à 15 h UTC : chaque semaine pendant le lancement (10, 17 et 24 novembre), puis à la première réinitialisation de chaque mois. En janvier, avril, juillet et octobre, le panier est reconstruit sur les 14 derniers jours.",
          "Une révision ne fait jamais bouger le niveau : seuls les prix le font. L’écran des indices liste ce que chaque révision a ajouté et retiré.",
        ],
      },
      {
        q: "Pourquoi un indice manque-t-il dans mon hôtel?",
        a: ["Un indice demande au moins 5 objets activement échangés dans cet hôtel."],
      },
    ],
  },
  {
    id: "flips",
    title: "Reventes et artisanat",
    items: [
      {
        q: "Qu’est-ce qu’une revente dans l’onglet Marché?",
        a: [
          "Un objet vendu au moins 3 fois par jour dont l’achat immédiat le plus bas est au moins 15 % sous sa moyenne sur 7 jours, et dont la revente rapporte encore au moins 10 % et 10s après la commission. Le prix de revente est le prix du marché, jamais au-dessus de la moyenne sur 7 jours.",
          "Exemple : achat à 12g 50s, revente à 15g. La commission de 5 % prend 75s, vous recevez donc 14g 25s : un profit de 1g 75s.",
        ],
      },
      {
        q: "Quelle est la commission de l’hôtel des ventes?",
        a: ["5 % dans les hôtels de l’Alliance et de la Horde, 15 % à l’hôtel neutre de Bourbe-Noire. Les dépôts ne sont comptés dans aucun profit."],
      },
      {
        q: "Comment le profit de fabrication est-il calculé?",
        a: [
          "Le prix de l’objet après commission, moins le coût de ses matériaux : la recette la moins chère, avec chaque composant coté (les composants vendus par les marchands au prix du marchand).",
          "Exemple : matériaux 3g 20s, objet vendu 4g. Après la commission de 5 %, vous recevez 3g 80s : un profit de 60s.",
        ],
      },
      {
        q: "Le profit est-il garanti?",
        a: ["Non. Les chiffres montrent le marché tel qu’il est maintenant. Les prix bougent et d’autres joueurs peuvent vendre moins cher avant que votre enchère parte."],
      },
    ],
  },
  {
    id: "alerts",
    title: "Alertes",
    items: [
      {
        q: "Comment créer une alerte de prix?",
        a: ["Ouvrez le graphique d’un objet, touchez la cloche, choisissez « descend à » ou « monte à » et entrez un prix en or (12,5 veut dire 12g 50s). L’alerte se déclenche une fois; réactivez-la depuis l’onglet Alertes."],
      },
      {
        q: "Que sont les alertes d’aubaines?",
        a: ["Dans l’onglet Alertes, surveillez une liste entière : vous êtes averti quand l’achat immédiat le plus bas d’un objet est 20 %, 30 % ou 50 % sous sa moyenne sur 7 jours, s’il se vend chaque jour et que vous économiseriez au moins 10s. Le même objet n’est signalé de nouveau qu’après le retour de son prix, et jamais deux fois en moins de 12 heures."],
      },
      {
        q: "Quand les alertes sont-elles vérifiées?",
        a: ["Quand l’application est ouverte et, sur Android, environ toutes les 30 minutes en arrière-plan. Le téléphone décide du moment exact et les économiseurs de batterie peuvent le retarder. Autorisez les notifications de Goblin Ledger dans les réglages d’Android."],
      },
    ],
  },
  {
    id: "app",
    title: "L’application et vos données",
    items: [
      {
        q: "Faut-il un compte?",
        a: ["Non. Aucun compte, aucune publicité, aucun pistage. Vos listes, alertes et réglages restent sur votre téléphone; désinstaller l’application les supprime."],
      },
      {
        q: "Est-ce une application officielle de Blizzard?",
        a: ["Non. Goblin Ledger est un projet de fan indépendant, sans affiliation avec Blizzard Entertainment."],
      },
    ],
  },
];

export const HELP: Record<Lang, HelpSection[]> = { en, fr };
