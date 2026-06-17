/**
 * getFounderSpots.js
 * Returns the number of FOUNDER20 spots remaining.
 * Counts rows in discount_uses where code = 'FOUNDER20',
 * then subtracts from the cap (20).
 */

const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_KEY = process.env.SUPABASE_SERVICE_KEY;
const FOUNDER_CAP  = 20;
const FOUNDER_CODE = 'FOUNDER20';

exports.handler = async () => {
  const headers = {
    'Access-Control-Allow-Origin': '*',
    'Content-Type': 'application/json',
    'Cache-Control': 'no-store'
  };

  if (!SUPABASE_URL || !SUPABASE_KEY) {
    // Env vars not set — return static fallback
    return { statusCode: 200, headers, body: JSON.stringify({ spots: FOUNDER_CAP, source: 'fallback' }) };
  }

  try {
    // Count rows in discount_uses table where code = FOUNDER20
    const res = await fetch(
      `${SUPABASE_URL}/rest/v1/discount_uses?code=eq.${FOUNDER_CODE}&select=id`,
      {
        headers: {
          'apikey': SUPABASE_KEY,
          'Authorization': `Bearer ${SUPABASE_KEY}`,
          'Prefer': 'count=exact',
          'Range': '0-0'
        }
      }
    );

    // Supabase returns count in Content-Range header: "0-0/N"
    const range = res.headers.get('content-range') || '';
    const match = range.match(/\/(\d+)$/);
    const used  = match ? parseInt(match[1], 10) : 0;
    const spots = Math.max(0, FOUNDER_CAP - used);

    return { statusCode: 200, headers, body: JSON.stringify({ spots, used, source: 'live' }) };
  } catch (e) {
    console.error('getFounderSpots error:', e.message);
    return { statusCode: 200, headers, body: JSON.stringify({ spots: FOUNDER_CAP, source: 'fallback' }) };
  }
};
