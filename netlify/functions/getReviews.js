/**
 * getReviews.js
 * Fetches Google Place reviews via Places API (New).
 *
 * Requires:
 *   GOOGLE_PLACES_SERVER_KEY — unrestricted (or IP-restricted), restricted to Places API (New)
 *   GOOGLE_PLACE_ID          — e.g. "ChIJIyPU3GuflR4RaiAdpoJEYEI"
 */

const API_KEY  = process.env.GOOGLE_PLACES_SERVER_KEY;
const PLACE_ID = process.env.GOOGLE_PLACE_ID;

exports.handler = async () => {
  const headers = {
    'Access-Control-Allow-Origin': '*',
    'Content-Type': 'application/json',
    'Cache-Control': 'public, max-age=3600',
  };

  if (!API_KEY || !PLACE_ID) {
    console.error('Missing GOOGLE_PLACES_SERVER_KEY or GOOGLE_PLACE_ID env vars');
    return { statusCode: 200, headers, body: JSON.stringify({ reviews: [], source: 'env_missing' }) };
  }

  try {
    const url = `https://places.googleapis.com/v1/places/${PLACE_ID}`;
    const res = await fetch(url, {
      headers: {
        'X-Goog-Api-Key': API_KEY,
        'X-Goog-FieldMask': 'rating,userRatingCount,reviews',
      },
    });

    if (!res.ok) {
      const err = await res.text();
      console.error('Places API (New) error:', res.status, err);
      return { statusCode: 200, headers, body: JSON.stringify({ reviews: [], source: 'api_error' }) };
    }

    const data = await res.json();
    const { rating, userRatingCount, reviews = [] } = data;

    const mapped = reviews.map(r => ({
      author:  r.authorAttribution?.displayName || 'Anonymous',
      avatar:  r.authorAttribution?.photoUri || null,
      rating:  r.rating,
      text:    r.text?.text || '',
      time:    r.relativePublishTimeDescription || '',
      url:     r.authorAttribution?.uri || null,
    }));

    return {
      statusCode: 200,
      headers,
      body: JSON.stringify({ rating, total: userRatingCount, reviews: mapped, source: 'live' }),
    };
  } catch (e) {
    console.error('getReviews error:', e.message);
    return { statusCode: 200, headers, body: JSON.stringify({ reviews: [], source: 'error' }) };
  }
};
