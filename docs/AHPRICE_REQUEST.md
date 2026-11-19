# Request to ahprice.com (draft, for the owner to send)

**To:** support@ahprice.com (from the site's Developers page; they also have a Discord linked there)
**Subject:** Goldline (free WoW Forever price app): one-time history export or a temporary higher limit?

---

Hi,

I run Goldline, a free app that charts WoW Forever auction house prices (Android and web: https://kcaron.top/). It has
no ads, no accounts and no tracking.

We'd like to show price history from the 4 November launch onward. Our own hourly collection only starts on
18 November, so ahprice.com's data would fill in the first two weeks. Thank you for permitting this.

We use your public API politely:
- one request every 7 seconds;
- under 1,900 requests a day;
- a generic user agent, and no personal data.

At that pace, getting the daily history for every item in the eight US & AU markets takes about three weeks, because
each call covers one item in one market.

Would either of these be possible?

1. A one-time export of daily history (lowest price and quantity per day) from 4 to 18 November for the US & AU
   markets, in any format that suits you. We would download it once.
2. Or a temporarily higher daily limit for our requests, or permission to use the MCP endpoint's allowance for this
   one-time backfill, until we have caught up.

Either way, every chart that shows your data is labelled "ahprice.com (crowd-sourced addon scans)". We'd be glad to add
a link back to ahprice.com, or credit you in any other way you prefer.

Thanks for building ahprice. If you say no, we'll simply keep going at the current pace.

Kevin
Goldline (https://kcaron.top/)

---

Notes for the owner:
- Send it from your own address; nothing has been sent.
- Until they answer, the backfill stays at under 1,900 requests a day on GitHub Actions. It does not use the MCP
  endpoint or extra machines.
