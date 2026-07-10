# Artifacts Coffee — Project Context

**Repo:** artifactscoffeeroastery-hue/artifactswebsite  
**Live site:** https://artifactscoffee.co.za  
**Stack:** Static HTML/CSS/JS · Netlify · Supabase · PayFast  
**Last updated:** 2026-06-30 (Session 10)

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
- `ADMIN_ORDER_KEY` — secret gate code for `admin-order.html` / `createManualOrder.js`
- `DATABASE_URL` — **must be the Supabase transaction pooler URL**, NOT the direct connection. Direct host `db.<ref>.supabase.co:5432` no longer resolves from Netlify (IPv4-only env → ENOTFOUND). Correct form: `postgresql://postgres.hwfwnzsjcblleykegiay:[pw]@aws-0-eu-central-2.pooler.supabase.com:6543/postgres`. Username must be `postgres.<ref>` (bare `postgres` fails auth). **Env var changes require a redeploy** — Netlify snapshots them at deploy time.
- `RESEND_API_KEY` — transactional email (office leads, collection alerts, customer receipts)
- `MAIL_FROM` — customer receipt sender; defaults to `onboarding@resend.dev` (sandbox → owner only). Set to `Artifacts Coffee <hello@artifactscoffee.co.za>` once the domain is verified in Resend.
- `TCG_API_KEY` — The Courier Guy / Shiplogic (live rates via `/rates`; same portal key is booking-capable via `POST /shipments` for the pending auto-book feature). `FASTWAY_API_KEY` optional second courier.

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
| KE · 004 | Kenya · Nyeri · Kiandu WS | Kiandu AB | **Live** — 200g R195 only |
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

### Session 10 (Admin Quote/Invoice System)
- **Fulfillment modes** — replaced courier/PUDO-only delivery section with 5-option select: Door-to-Door Courier, PUDO Locker, Customer Collection (free), Personal Delivery, PEP Stores Mossel Bay
- **Quote generation** — "Generate Quote" button builds `docState` object and renders inline dark preview in `#quote-screen` with items, totals, fulfilment label, accent-coloured total
- **Quote → Invoice conversion** — "Convert to Invoice" assigns `INV-{timestamp}` ref, toggles `qs-quote-actions` → `qs-invoice-actions`, reveals FNB banking details
- **Print-ready document** (`buildDocHTML`) — opens standalone white HTML page in new tab for either quote or invoice; has Print/Save PDF button; invoice includes banking section
- **Send actions** — `sendDocWhatsApp()` opens `wa.me` with formatted message; `sendDocEmail()` opens `mailto:` with full order breakdown
- **EFT from invoice** — triggers `payViaEFT()` → `createManualOrder.js` → `confirm-screen` with banking + WA draft
- Banking details: FNB · Artifacts Coffee Roastary · Acc `62929285692` · Branch `250655`
- `docState` object holds all order data (customer, items, totals, fulfilment, refs, dates) — persists through quote→invoice→payment flow

### Session 11 (EFT Flow Fixed)
- EFT button now works end-to-end — manual order `EFT-20260630-N6J3P` confirmed persisted to `orders` (id 4, status `awaiting_payment`)
- Root cause was a bad `DATABASE_URL`: it held the direct connection (`db.<ref>.supabase.co:5432`, ENOTFOUND from Netlify) then the pooler host with a bare `postgres` username (auth failed). Fixed to pooler host + `postgres.<ref>` username. See env-vars note above.
- Debug error passthrough in `createManualOrder.js` reverted: `DB error: ${e.message}` → `'Failed to save order'`
- `orders` table schema in project `hwfwnzsjcblleykegiay` verified — all 14 columns the INSERT targets exist

### Session 12 (Collect code, receipts, live-rate fix, Sheet CRM, order numbers)
- **Collect-from-us reworked into a discount code.** Public "Collect from us" cart tab removed; instead `discountCodes.FAMILY` (`type:'collect'`) unlocks free collection (full coffee price, R0 shipping) — hides delivery tabs, forces pickup mode, shows a WhatsApp button (`js/main.js`). `COLLECT_WHATSAPP='27613832478'`. `getDiscount` returns 0 for `type:'collect'`. Rename the code by editing the `FAMILY` key.
- **Customer receipt/tax-invoice email** — `payfast-notify.js` `sendCustomerInvoice()` emails the customer on every COMPLETE payment (Resend). Auto-labels "Tax Invoice" if `BIZ.vat` is set, else "Receipt". Sends from `MAIL_FROM` env (defaults to `onboarding@resend.dev` — sandbox only delivers to the account owner until a domain is verified in Resend; set `MAIL_FROM='Artifacts Coffee <hello@artifactscoffee.co.za>'` after verifying).
- **payfast-notify.js was truncated/broken** (missing catch + closing braces → syntax error, webhook not running). Rebuilt clean; also emails the roaster for collect-from-us orders (`notifyCollection`).
- **Admin live-rate bug fixed** — admin read `q.service`/`q.price` but `getShipping` returns `label`/`amount` → "undefined / R NaN". Now reads `label`/`amount` (tolerates both). Confirmed `getShipping` returns `source:'live'` (TCG key working).
- **PEP Stores (Mossel Bay) fulfilment option removed** from `admin-order.html` (option, section, and dead `pep` refs).
- **Google Sheet CRM logging** — `admin-order.html` `logToSheet()` posts every quote & invoice to a Google Apps Script Web App (`SHEET_LOG_URL`, secret `SHEET_LOG_TOKEN='aC7logKq9mZ2xR4t'`) → appends a row to the "Orders" tab. Script file: `google-sheet-logger.gs` (doPost token-guarded; doGet JSONP returns deduped client list). Columns include **Customer ID** (deterministic SHA-256 UUID from email), **Address Data** (JSON), **Order No**. Rows colour-coded: quotes blue `#d1ecf1`, invoices amber `#fff3cd`. CSP `script-src`+`connect-src` allow `script.google.com`/`script.googleusercontent.com`.
- **Client autofill** — admin loads the Sheet client list via JSONP on gate unlock; typing a name/email suggests past clients and fills name/email/phone + structured address (re-fetches courier rates).
- **Order numbers** — sequential `AC-####` (localStorage counter, timestamp fallback) assigned at quote generation, carried to its invoice; forced onto direct EFT (stored in `admin_notes`) and PayFast (`[ADMIN AC-####]` in description) orders; shown on preview, printed doc, confirmation, and Sheet.
- **NEXT / pending:** (1) auto-book Courier Guy shipments on any paid order with a shipping charge — TCG portal key is booking-capable (`POST /shipments`); build `bookShipment()`, trigger from webhook (normal) + post-payment (admin), idempotent, needs structured address carried through checkout. (2) These changes not yet all committed at time of writing. (3) Resend domain verification still pending for customer emails to actually deliver.

## Known / Watch Items

- **DB project mismatch:** the public site (`js/main.js`, `payfast-notify.js`, `.env.local`, CSP) uses Supabase project `xpxbldyrigqjkdmrfhvh`, but `createManualOrder.js` (via `DATABASE_URL`) writes to `hwfwnzsjcblleykegiay`. Customer PayFast orders and admin/manual orders land in **different databases** — reconcile to one project.
- `GOOGLE_PLACES_KEY` must be set in Netlify dashboard (UI → Site settings → Env vars)
- `ADMIN_ORDER_KEY` must be set in Netlify as a secret — `admin-order.html` gate checks this server-side
- Hero origin cards in the hero section still link to `#mx`, `#ni`, `#gt` — these IDs now live on the `.oc` cards, so anchor scroll still works
- Discovery Pack removed from site; `btn-dp` / `dp-p` JS refs are harmless (no-ops if element missing)
- Kenya product image: using CSS gradient placeholder — replace with licensed photo when available
- Git lock files (`.git/index.lock`, `.git/HEAD.lock`) are a recurring issue in this repo — always `Remove-Item` before git operations if they appear
- Waitlist email to subscribers not yet sent (Drop 004 is live)
