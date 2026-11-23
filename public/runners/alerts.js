/*
 * Goblin Ledger background runner (Capacitor Background Runner): checks price alerts while the app is closed.
 * Android runs "checkAlerts" about every 30 minutes (the OS decides the exact time). Plain JS, no imports:
 * only fetch, CapacitorKV and CapacitorNotifications exist here. The app sends its alerts with "syncAlerts"
 * and collects the ones that fired with "popFired". Reads only public price files; sends nothing anywhere.
 */
// Cloudflare R2 first (docs/R2_DATA.md), then the GitHub copy.
var BASES = ["https://data.kcaron.top/", "https://raw.githubusercontent.com/kevincaron28/Trading-Wow/data/"];

async function latestItems(house) {
  for (var b = 0; b < BASES.length; b++) {
    try {
      var res = await fetch(BASES[b] + "latest/" + house + ".json?t=" + Math.floor(Date.now() / 600000));
      if (!res.ok) continue;
      var file = await res.json();
      // A stalled R2 copy (snapshot over 3 hours old) must not hide newer prices on GitHub.
      if (b < BASES.length - 1 && (file.t || 0) < Date.now() / 1000 - 3 * 3600) continue;
      return file.items || {};
    } catch (e) {
      // Next source.
    }
  }
  return null;
}

function readJson(key, fallback) {
  try {
    var v = CapacitorKV.get(key);
    return v && v.value ? JSON.parse(v.value) : fallback;
  } catch (e) {
    return fallback;
  }
}

function money(copper, lang) {
  var g = Math.floor(copper / 10000);
  var s = Math.floor((copper % 10000) / 100);
  var c = copper % 100;
  var u = lang === "fr" ? ["po", "pa", "pc"] : ["g", "s", "c"];
  if (g > 0) return g + u[0] + (s > 0 ? " " + s + u[1] : "");
  if (s > 0) return s + u[1] + (c > 0 ? " " + c + u[2] : "");
  return c + u[2];
}

addEventListener("syncAlerts", function (resolve, reject, args) {
  try {
    CapacitorKV.set("alerts", JSON.stringify((args && args.alerts) || []));
    CapacitorKV.set("lang", (args && args.lang) || "en");
    CapacitorKV.set("names", JSON.stringify((args && args.names) || {}));
    resolve();
  } catch (e) {
    reject(e);
  }
});

addEventListener("popFired", function (resolve, reject) {
  try {
    var fired = readJson("fired", []);
    CapacitorKV.set("fired", "[]");
    resolve({ fired: fired });
  } catch (e) {
    reject(e);
  }
});

addEventListener("checkAlerts", async function (resolve, reject) {
  try {
    var alerts = readJson("alerts", []);
    var active = alerts.filter(function (a) {
      return a.active;
    });
    if (active.length === 0) return resolve();
    var lang = (CapacitorKV.get("lang") || {}).value || "en";
    var names = readJson("names", {});
    var houses = [];
    active.forEach(function (a) {
      if (houses.indexOf(a.house) < 0) houses.push(a.house);
    });
    var quotes = {};
    for (var i = 0; i < houses.length; i++) {
      var items = await latestItems(houses[i]);
      if (items) quotes[houses[i]] = items;
    }
    var now = Math.floor(Date.now() / 1000);
    var fired = readJson("fired", []);
    var notes = [];
    alerts.forEach(function (a) {
      if (!a.active || !quotes[a.house]) return;
      var row = quotes[a.house][a.itemId];
      if (!row) return;
      var value = a.field === "min" ? row[0] : row[1];
      var met = a.op === "above" ? value >= a.price : value <= a.price;
      if (!met) return;
      a.active = false;
      a.triggeredAt = now;
      fired.push(a.id);
      var name = names[a.itemId] || "#" + a.itemId;
      var verb = lang === "fr" ? (a.op === "above" ? "dépasse" : "descend sous") : a.op === "above" ? "rose above" : "fell below";
      notes.push({
        id: (now % 1000000) + notes.length,
        title: lang === "fr" ? "Alerte de prix Goblin Ledger" : "Goblin Ledger price alert",
        body: name + " " + verb + " " + money(a.price, lang) + " (" + money(value, lang) + ")",
        autoCancel: true,
      });
    });
    if (notes.length > 0) {
      CapacitorKV.set("alerts", JSON.stringify(alerts));
      CapacitorKV.set("fired", JSON.stringify(fired));
      CapacitorNotifications.schedule(notes);
    }
    resolve();
  } catch (e) {
    reject(e);
  }
});
