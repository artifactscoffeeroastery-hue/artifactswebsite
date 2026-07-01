const TCG_API      = 'https://api.portal.thecourierguy.co.za/rates';
const FASTWAY_API  = 'https://api.shiplogic.com/rates';
const TCG_KEY      = process.env.TCG_API_KEY;
const FASTWAY_KEY  = process.env.FASTWAY_API_KEY;

// Artifacts Coffee collection address (Roodepoort)
const COLLECTION = {
  type: 'business',
  company: 'Artifacts Coffee Roastery',
  street_address: '864 Bongo Street',
  local_area: 'Allens Nek',
  city: 'Roodepoort',
  zone: 'Gauteng',
  country: 'ZA',
  code: '1709'
};

function weightKgToParcel(kg) {
  if (kg <= 0.2)  return { submitted_length_cm: 20, submitted_width_cm: 14, submitted_height_cm: 4,  submitted_weight_kg: Math.max(kg, 0.1) };
  if (kg <= 0.5)  return { submitted_length_cm: 25, submitted_width_cm: 16, submitted_height_cm: 6,  submitted_weight_kg: kg };
  if (kg <= 1.5)  return { submitted_length_cm: 32, submitted_width_cm: 22, submitted_height_cm: 9,  submitted_weight_kg: kg };
  return           { submitted_length_cm: 40, submitted_width_cm: 28, submitted_height_cm: 12, submitted_weight_kg: kg };
}

async function fetchRates(apiUrl, apiKey, delivery, parcel, subtotal, label) {
  try {
    const res = await fetch(apiUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${apiKey}` },
      body: JSON.stringify({
        collection_address: COLLECTION,
        delivery_address: delivery,
        parcels: [parcel],
        declared_value: subtotal || 100
      })
    });
    if (!res.ok) { console.error(`${label} error:`, res.status, await res.text()); return []; }
    const data = await res.json();
    return (data.rates || data || []).map(r => ({
      code: `${label.toLowerCase()}-${r.service_level?.code || r.code || 'std'}`,
      label: `${label}: ${r.service_level?.name || r.name || 'Courier'}`,
      amount: Math.ceil(r.rate_excluding_vat ? r.rate_excluding_vat * 1.15 : r.total || r.amount || 100),
      service_level_code: r.service_level?.code || r.code || ''   // raw code needed to book a shipment
    }));
  } catch (e) {
    console.error(`${label} fetch error:`, e.message);
    return [];
  }
}

exports.handler = async (event) => {
  if (event.httpMethod !== 'POST') return { statusCode: 405, body: 'Method Not Allowed' };

  let body;
  try { body = JSON.parse(event.body); } catch { return { statusCode: 400, body: 'Bad JSON' }; }

  const { destination, totalWeightKg = 1, subtotal = 0 } = body;

  const delivery = {
    type: 'residential',
    street_address: destination.line1 || '',
    local_area: destination.suburb || destination.city || '',
    city: destination.city || '',
    zone: destination.province || '',
    country: 'ZA',
    code: String(destination.postalCode || '0000')
  };

  const parcel = weightKgToParcel(Number(totalWeightKg) || 1);

  // Fetch from both couriers in parallel
  const [tcgRates, fastwayRates] = await Promise.all([
    TCG_KEY     ? fetchRates(TCG_API,     TCG_KEY,     delivery, parcel, subtotal, 'TCG')     : Promise.resolve([]),
    FASTWAY_KEY ? fetchRates(FASTWAY_API, FASTWAY_KEY, delivery, parcel, subtotal, 'Fastway') : Promise.resolve([])
  ]);

  const allRates = [...tcgRates, ...fastwayRates];

  // Sort by price
  allRates.sort((a, b) => a.amount - b.amount);

  // Always include PUDO collect as first option
  const pudo = { code: 'pudo', label: 'TCG PUDO Locker (Collect)', amount: 60 };
  const quotes = allRates.length ? [pudo, ...allRates] : fallback(destination);

  return {
    statusCode: 200,
    body: JSON.stringify({ quotes, source: allRates.length ? 'live' : 'fallback' })
  };
};

// When live rates are unavailable we do NOT guess door-to-door prices
// (would risk charging less than TCG bills us). Only the fixed PUDO rate is offered.
function fallback(dest) {
  return [
    { code: 'pudo', label: 'TCG PUDO Locker (Collect)', amount: 60 }
  ];
}
