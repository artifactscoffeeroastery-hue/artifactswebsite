const TCG_API = 'https://api.portal.thecourierguy.co.za/rates';
const TCG_KEY = process.env.TCG_API_KEY;

// Artifacts Coffee collection address (Johannesburg)
const COLLECTION = {
  type: 'business',
  company: 'Artifacts Coffee Roastery',
  street_address: '12 Honey Street',
  local_area: 'Brixton',
  city: 'Johannesburg',
  zone: 'Gauteng',
  country: 'ZA',
  code: '2092'
};

function weightKgToParcel(kg) {
  // Estimate parcel dimensions based on weight
  if (kg <= 0.2)  return { submitted_length_cm: 20, submitted_width_cm: 14, submitted_height_cm: 4,  submitted_weight_kg: Math.max(kg, 0.1) };
  if (kg <= 0.5)  return { submitted_length_cm: 25, submitted_width_cm: 16, submitted_height_cm: 6,  submitted_weight_kg: kg };
  if (kg <= 1.5)  return { submitted_length_cm: 32, submitted_width_cm: 22, submitted_height_cm: 9,  submitted_weight_kg: kg };
  return           { submitted_length_cm: 40, submitted_width_cm: 28, submitted_height_cm: 12, submitted_weight_kg: kg };
}

exports.handler = async (event) => {
  if (event.httpMethod !== 'POST') return { statusCode: 405, body: 'Method Not Allowed' };

  let body;
  try { body = JSON.parse(event.body); } catch { return { statusCode: 400, body: 'Bad JSON' }; }

  const { destination, totalWeightKg = 1, subtotal = 0 } = body;

  if (!TCG_KEY) {
    return { statusCode: 200, body: JSON.stringify({ quotes: fallback(destination), source: 'fallback' }) };
  }

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

  try {
    const res = await fetch(TCG_API, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${TCG_KEY}` },
      body: JSON.stringify({
        collection_address: COLLECTION,
        delivery_address: delivery,
        parcels: [parcel],
        declared_value: subtotal || 100
      })
    });

    if (!res.ok) {
      const err = await res.text();
      console.error('TCG error:', res.status, err);
      return { statusCode: 200, body: JSON.stringify({ quotes: fallback(destination), source: 'fallback' }) };
    }

    const data = await res.json();
    const tcgQuotes = (data.rates || data || []).map(r => ({
      code: r.service_level?.code || r.code || 'tcg',
      label: r.service_level?.name || r.name || 'Courier',
      amount: Math.ceil(r.rate_excluding_vat ? r.rate_excluding_vat * 1.15 : r.total || r.amount || 100)
    }));

    // Always prepend PUDO as a fixed flat-rate collect option
    const pudo = { code: 'pudo', label: 'TCG PUDO Locker (Collect)', amount: 60 };
    const quotes = tcgQuotes.length ? [pudo, ...tcgQuotes] : fallback(destination);

    return {
      statusCode: 200,
      body: JSON.stringify({ quotes, source: tcgQuotes.length ? 'tcg' : 'fallback' })
    };
  } catch (e) {
    console.error('getShipping error:', e.message);
    return { statusCode: 200, body: JSON.stringify({ quotes: fallback(destination), source: 'fallback' }) };
  }
};

function fallback(dest) {
  const prov = (dest && dest.province || '').toLowerCase();
  return [
    { code: 'pudo',          label: 'TCG PUDO Locker',          amount: 60  },
    { code: 'door-gauteng',  label: 'Gauteng Door-to-Door',     amount: 100 },
    { code: 'door-national', label: 'Rest of SA Door-to-Door',  amount: 150 }
  ];
}
