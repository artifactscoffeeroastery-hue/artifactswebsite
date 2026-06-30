# Artifacts Coffee — Project Context

**Repo:** artifactscoffeeroastery-hue/artifactswebsite  
**Live site:** https://artifactscoffee.co.za  
**Stack:** Static HTML/CSS/JS · Netlify · Supabase · PayFast  
**Last updated:** 2026-06-30

---

## Architecture

| Layer | Detail |
|-------|--------|
| Frontend | Single-page `index.html` + `css/main.css` + `js/main.js` |
| Serverless | `netlify/functions/` — Node.js handlers |
| Database | Supabase (PostgreSQL) — tables: `discount_uses`, `office_leads`, `orders`, `point_events`, `waitlist` |
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
| `joinWaitlist.js` | Saves email to Supabase `waitlist` table |
| `getReviews.js` | Fetches live Google Place reviews via Places Details API |

**Env vars required in Netlify:**
- `GOOGLE_PLACES_KEY` — domain-restricted in Google Cloud Console
- `SUPABASE_URL`, `SUPABASE_SERVICE_KEY`
- `BOBGO_API_KEY`
- `GOOGLE_PLACES_SERVER_KEY` — no HTTP restrictions, restricted to Places API only (server-side key)
- `GOOGLE_PLACE_ID` — ChIJ... Place ID from Google Business Profile

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

## Product State (as of 2026-06-30)

Drop 004 Kenya is **Live**. GT/MX/NI remain Sold Out as compact origin cards.

| Code | Origin | Coffee | Status |
|------|--------|--------|--------|
| KE · 004 | Kenya · Nyeri · Kiandu WS | Kiandu AB | **Live** — 200g R260 / 1kg Bundle R1040 |
| GT · 001 | Guatemala · Huehuetenango | Blue Ayarza | Sold Out |
| MX · 002 | Mexico · Chiapas | Ki Saya (Organic) | Sold Out |
| NI · 003 | Nicaragua · Nueva Segovia | Rajuanse Estates | Sold Out |

Kenya tasting notes (from And Sons cupping sheet): Peach · Tropical Fruit · Orange Soda · Toffee  
Varietals: SL28, SL34 · Altitude: 1600–1700masl · Mutheka FCS  
Kenya visual: CSS gradient placeholder (`#1a0a0b → #3d1012 → #C8373E`) — no licensed image yet.  
Live bar replaces coming-soon bar above origin cards.

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

### Session 7 (Brand Edit Pass)
- Hero headline → "One Drop. One Standard." (was "Three Origins. One Standard.")
- Hero description updated to remove plural-origins language
- Hero GT/MX/NI origin cards removed entirely
- Ticker updated: Drop 004 · Kenya · Kiandu AB · Coming Soon · Score 88 (all old origin names removed)
- Founder banner removed from public page; FOUNDER20 lives silently in checkout cart drawer only
- Mobile nav "Founder Offer" link removed; cleaned up GT/MX/NI sub-links
- Office section replaced with lightweight `.office-strip` — 2-col layout: copy left, 3-input form right (name + email + company + send), no pricing shown, bulk discounts offered via email follow-up
- `submitOfficeLead()` validation updated to not require team size (field removed)

### Session 6 (Brand Audit Fixes)
- Full brand audit across 5 dimensions (5-second test, visual consistency, trust, differentiation, UX)
- P0: Hero waitlist form added — email capture feeds Supabase `waitlist` table via `joinWaitlist.js` Netlify function
- P0: Hero origin card prices ("from R150" etc.) replaced with "Sold Out" badges
- P0: Founder banner repurposed — "Join the Waitlist, Get R20 Off" (FOUNDER20 still valid for next drop)
- P1: Coming-soon banner made specific — "Drop 004 · Kenya · Kiandu AB · Coming Soon"
- P1: enTheos mini bar added between coming-soon banner and origin cards (brand differentiator surfaced earlier)
- P1: Instagram row added above footer — "Follow the roast @artifacts_coffee_roastery"
- P2: Aggregate star rating added above testimonials grid — "5.0 · 4 verified reviews"
- **Supabase action required:** Create `waitlist` table — SQL in `netlify/functions/joinWaitlist.js` header comment

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

### Session 8 (Google Reviews Integration)
- `netlify/functions/getReviews.js` created — fetches up to 5 reviews from Google Places Details API
- `loadReviews()` added to `main.js` — replaces static fallback cards with live Google reviews on load; silently fails to fallback if env vars missing or API errors
- Testimonials grid now has `id="testi-grid"` and `id="testi-agg-label"` for JS targeting
- Google badge link added to trust bar (links to Google review page)
- `testi-avatar`, `testi-google-badge`, `testi-meta` CSS added
- **Env vars required:** `GOOGLE_PLACES_SERVER_KEY` (no HTTP restrictions, Places API only) + `GOOGLE_PLACE_ID` (ChIJ... from GBP)
- **Pending:** Update `PLACE_ID_HERE` placeholder in trust bar link once Place ID is confirmed

### Session 9 (Kenya Drop 004 Live + Admin Order System)
- Drop 004 Kenya Kiandu AB flipped live — product section added with `ke-theme`, `--ke:#C8373E`
- Kenya tasting notes corrected to And Sons cupping sheet: Peach, Tropical Fruit, Orange Soda, Toffee
- Kenya visual: CSS gradient placeholder (no licensed image yet)
- `admin-order.html` created — hidden admin page (`noindex,nofollow`), key-gated, all 4 coffees available regardless of sold-out status
- `netlify/functions/createManualOrder.js` created — EFT/PayFast split, Supabase insert (`placed_by:'admin'`), EFT status `awaiting_payment`, returns banking details + WhatsApp draft
- `ADMIN_ORDER_KEY` env var added to Netlify (secret) — required for `createManualOrder.js`
- Dev artifact cleanup: `.gitignore` updated, lock files documented as recurring issue

## Known / Watch Items

- `GOOGLE_PLACES_KEY` must be set in Netlify dashboard (UI → Site settings → Env vars)
- `ADMIN_ORDER_KEY` must be set in Netlify as a secret — `admin-order.html` gate checks this server-side
- Hero origin cards in the hero section still link to `#mx`, `#ni`, `#gt` — these IDs now live on the `.oc` cards, so anchor scroll still works
- Discovery Pack removed from site; `btn-dp` / `dp-p` JS refs are harmless (no-ops if element missing)
- Kenya product image: using CSS gradient placeholder — replace with licensed photo when available
- Git lock files (`.git/index.lock`, `.git/HEAD.lock`) are a recurring issue in this repo — always `Remove-Item` before git operations if they appear
- Waitlist email to subscribers not yet sent (Drop 004 is live)
