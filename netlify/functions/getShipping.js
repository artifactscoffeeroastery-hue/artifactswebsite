/**
 * getShipping.js
 * Fetches live courier rates from Bob Go (/v2/rates).
 * Bob Go aggregates multiple couriers (TCG, Fastway, RAM, SkyNet, etc.)
 * through a single API call.
 *
 * Required env var:
 *   BOBGO_API_KEY — API key from Bob Go Sales Channels > Bob Go API channel
 *
 * Note: The Sales Channel API key requires a `bobgo-channel-identifier`
 * header set to the store identifier (artifactscoffee.co.za).
 */

const BOBGO_API = 'https://api.bobgo.co.za/v2/rates';
const BOBGO_KEY = process.env.BOBGO_API_KEY;

// Artifacts Coffee collection address (Roodepoort)
const COLLECTION = {
  street_address: '864 Bongo Street',
  company:        'Artifacts Coffee Roastery',
  local_area:     'Allens Nek',
  city:           'Roodepoort',
  zone:           'Gauteng',
  country:        'ZA',
  code:           '1709',
};

function weightKgToParcel(kg) {
  const w = Math.max(Number(kg) || 0.1, 0.1);
  if (w <= 0.2) return { description: 'Coffee', submitted_length_cm: 20, submitted_width_cm: 14, submitted_height_cm: 4,  submitted_weight_kg: w };
  if (w <= 0.5) return { description: 'Coffee', submitted_length_cm: 25, submitted_width_cm: 16, submitted_height_cm: 6,  submitted_weight_kg: w };
  if (w <= 1.5) return { description: 'Coffee', submitted_length_cm: 32, submitted_width_cm: 22, submitted_height_cm: 9,  submitted_weight_kg: w };
  return              { description: 'Coffee', submitted_length_cm: 40, submitted_width_cm: 28, submitted_height_cm: 12, submitted_weight_kg: w };
}

exports.handler = async (event) => {
  if (event.httpMethod !== 'POST') return { statusCode: 405, body: 'Method Not Allowed' };

  let body;
  try { body = JSON.parse(event.body); }
  catch { return { statusCode: 400, body: 'Bad JSON' }; }

  const { destination, totalWeightKg = 0.2, subtotal = 0 } = body;

  const parcel = weightKgToParcel(totalWeightKg);

  const deliveryAddress = {
    street_address: destination.line1    || '',
    local_area:     destination.suburb   || destination.city || '',
    city:           destination.city     || '',
    zone:           destination.province || '',
    country:        'ZA',
    code:           String(destination.postalCode || '0000'),
  };

  let liveRates = [];

  if (BOBGO_KEY) {
    try {
      const res = await fetch(BOBGO_API, {
        method: 'POST',
        headers: {
          'Content-Type':            'application/json',
          'Authorization':           `Bearer ${BOBGO_KEY}`,
          'bobgo-channel-identifier': 'artifactscoffee.co.za',
        },
        body: JSON.stringify({
          collection_address: COLLECTION,
          delivery_address:   deliveryAddress,
          parcels:            [parcel],
          declared_value:     subtotal || 100,
          timeout:            10000,
        }),
      });

      if (res.ok) {
        const data = await res.json();
        console.log('Bob Go raw response:', JSON.stringify(data).slice(0, 3000)); // TEMP DEBUG — remove once rates confirmed working
        for (const provider of (data.provider_rate_requests || [])) {
          if (provider.status !== 'success') continue;
          for (const r of (provider.responses || [])) {
            if (r.status !== 'success') continue;
            if (r.pickup_point_location_id > 0) continue; // skip locker rates
            liveRates.push({
              code:               `bobgo-${provider.provider_slug}-${r.service_level_code}`,
              label:              `${provider.provider_name}: ${r.service_level.name}`,
              amount:             Math.ceil(r.rate_amount),          // already VAT-inclusive
              service_level_code: r.service_level_code,
              provider_slug:      provider.provider_slug,
            });
          }
        }
        liveRates.sort((a, b) => a.amount - b.amount);
      } else {
        console.error('Bob Go rates error:', res.status, await res.text());
      }
    } catch (e) {
      console.error('Bob Go fetch error:', e.message);
    }
  } else {
    console.warn('BOBGO_API_KEY not set — falling back to PUDO only');
  }

  // Always offer PUDO as the first (cheapest) option
  const pudo   = { code: 'pudo', label: 'PUDO Locker (Collect)', amount: 60 };
  const quotes = liveRates.length ? [pudo, ...liveRates] : fallback();

  return {
    statusCode: 200,
    body: JSON.stringify({ quotes, source: liveRates.length ? 'live' : 'fallback' }),
  };
};

// If Bob Go is unreachable, only the fixed PUDO rate is safe to show
// (door-to-door guesses risk charging less than the courier bills)
function fallback() {
  return [{ code: 'pudo', label: 'PUDO Locker (Collect)', amount: 60 }];
}
