# Artifacts Coffee — Project Context

**Repo:** artifactscoffeeroastery-hue/artifactswebsite  
**Live site:** https://artifactscoffee.co.za  
**Stack:** Static HTML/CSS/JS · Netlify · Supabase · PayFast  
**Last updated:** 2026-06-19

---

## Architecture

| Layer | Detail |
|-------|--------|
| Frontend | Single-page `index.html` + `css/main.css` + `js/main.js` |
| Serverless | `netlify/functions/` — Node.js handlers |
| Database | Supabase (PostgreSQL) — tables: `discount_uses`, `office_leads`, `orders`, `point_events` |
| Payments | PayFast — merchant_id `34420469`, merchant_key `q6qjvvpwgddvi` |
| Shipping | Bob Go API via `getShipping.js` |
| Maps | Google Places Autocomplete — key served via `getConfig.js` (never in source) |

---

## Netlify Functions

| File | Purpose |
|------|---------|
| `getConfig.js` | Serves `GOOGLE_PLACES_KEY` env var to frontend |
| `getFounderSpots.js` | Returns remaining founder spots from Supabase |
| `officeEnquiry.js` | Submits office coffee lead to Supabase |
| `payfast-notify.js` | PayFast ITN webhook handler |
| `getShipping.js` | Fetches Bob Go shipping quotes |

**Env vars required in Netlify:**
- `GOOGLE_PLACES_KEY` — domain-restricted in Google Cloud Console
- `SUPABASE_URL`, `SUPABASE_KEY`
- `BOBGO_API_KEY`

---

## CSS Custom Properties

```css
--cyan    /* Guatemala / GT accent */
--yellow  /* Mexico / MX accent */
--white   /* Nicaragua / NI accent */
--black   /* page background */
--off     /* card / drawer background */
--border  /* subtle borders */
--muted   /* secondary text */
```

**Breakpoints:** 960px · 768px · 600px · 380px

---

## Product State (as of 2026-06-19)

All 3 coffees are **Sold Out**. Old full-height product sections removed.  
Replaced with compact 3-column origin card grid (`.origins-grid` / `.oc`).

| Code | Origin | Coffee | Status |
|------|--------|--------|--------|
| GT · 001 | Guatemala · Huehuetenango | Blue Ayarza | Sold Out |
| MX · 002 | Mexico · Chiapas | Ki Saya (Organic) | Sold Out |
| NI · 003 | Nicaragua · Nueva Segovia | Rajuanse Estates | Sold Out |

Coming soon banner added above the origin cards.

---

## Cart Drawer Architecture

```
.cart-drawer (flex column, overflow:hidden)
├── .cart-header       (flex-shrink:0)
├── #step-account      (flex:1, overflow-y:auto)
├── #step-shipping     (flex:1, overflow-y:auto)
│   ├── .ship-tabs     (Deliver / Collect PUDO toggle)
│   ├── phone input    (always visible)
│   ├── #ship-address-wrap  (hidden in collect mode)
│   └── #pudo-info     (hidden in deliver mode)
└── .cart-footer       (flex-shrink:0, sticky)
```

**Deliver mode:** shows door-to-door rates, full address fields required.  
**Collect mode:** shows PUDO rate only, only phone required.

---

## Key JS Patterns

- `loadPlacesAutocomplete()` — async, fetches key from `/.netlify/functions/getConfig` before injecting Maps script
- `tryAutoApplyDiscount()` — restores discount from `sessionStorage` (`ac_disc`) across delivery mode switches
- `setDeliverMode(mode)` — toggles tabs, shows/hides address vs PUDO UI, re-renders shipping options
- `autoFetchIfReady()` — triggers shipping fetch on province `change` + postal code `blur`, shows "Loading rates…" immediately
- `lastQuotes` — cached shipping response, re-filtered on mode switch without re-fetching

---

## Milestones Completed

### Session 1–2
- Resolved git lock files (`index.lock`, `HEAD.lock`)
- Rotated exposed Google Places API key; moved to Netlify env var via `getConfig.js`
- Set up SSH key for `artifactscoffeeroastery-hue` GitHub account

### Session 2–3 (Cart/UX audit)
- Discount persistence across delivery method changes (sessionStorage)
- Auto-refresh shipping rates on field blur (removed manual button)
- Collect/Deliver tab split in cart drawer
- Promo banner overflow fix on mobile
- Autocomplete wired through serverless key fetch
- Sticky checkout footer (flex column layout, no JS scroll logic)

### Session 3 (Visual fixes)
- Founder cart banner: padding/alignment fixed (`margin:0 -40px; padding:10px 40px 12px`)
- Footer mobile: centered logo, links, copy text
- Product size buttons: hover + selected states with per-theme outline colours
- Product section boundaries: full-width top border in theme colour (GT=cyan, MX=yellow, NI=white)

### Session 5 (Structured Data + Email)
- Fixed 5 Google Search Console structured data errors in JSON-LD
- `brand` corrected to `{ "@type": "Brand" }` (was invalid `@id` reference)
- All offers: added `hasMerchantReturnPolicy` (shared `#returnpolicy` node, 7-day return window)
- All offers: added `shippingDetails` (R85 starting rate, 2–5 day transit, ZA)
- All products: added `aggregateRating` + `review` nodes from real site testimonials
- All offers: `availability` updated to `OutOfStock`
- Org `contactPoint.email` updated to `hello@artifactscoffee.co.za`
- Org `sameAs` populated with Instagram URL
- Email signature created (`email-signature.html`) — Denzel · Founder, table-based Gmail-safe HTML
- Send As setup guide written: Cloudflare Email Routing (inbound) + Resend SMTP (outbound)
- Cloudflare domain pending verification — nameservers need updating at domain registrar

### Session 4 (Sold Out + Origin Cards)
- All 4 products (GT, MX, NI, Discovery Pack) set to Sold Out
- "Something New Coming Soon" banner added (`.coming-soon-bar`)
- Old full-height product sections replaced with compact 3-column origin card grid
- Old GT legacy div, MX section, NI section, Discovery Pack section removed from `index.html`
- Coming soon banner made more prominent: Barlow Condensed 22px all-caps white text
- Origin card CSS written: 3col desktop → 2col tablet → 1col mobile

---

## Known / Watch Items

- `GOOGLE_PLACES_KEY` must be set in Netlify dashboard (UI → Site settings → Env vars)
- Hero origin cards in the hero section still link to `#mx`, `#ni`, `#gt` — these IDs now live on the `.oc` cards, so anchor scroll still works
- Discovery Pack removed from site; `btn-dp` / `dp-p` JS refs are harmless (no-ops if element missing)
