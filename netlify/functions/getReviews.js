/**
 * getReviews.js
 * Fetches Google Place reviews from the Places Details API.
 *
 * Requires:
 *   GOOGLE_PLACES_SERVER_KEY — unrestricted (or IP-restricted) Places API key
 *   GOOGLE_PLACE_ID          — e.g. "ChIJxxxxxxxxxxxxxxxx" from your GBP listing
 *
 * Returns up to 5 reviews as selected by Google (most relevant).
 * Cached for 1 hour via Cache-Control header.
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
    const url = `https://maps.googleapis.com/maps/api/place/details/json?place_id=${PLACE_ID}&fields=rating,user_ratings_total,reviews&reviews_sort=newest&key=${API_KEY}`;
    const res = await fetch(url);
    const data = await res.json();

    if (data.status !== 'OK') {
      console.error('Places API error:', data.status, data.error_message);
      return { statusCode: 200, headers, body: JSON.stringify({ reviews: [], source: 'api_error', status: data.status }) };
    }

    const { rating, user_ratings_total, reviews = [] } = data.result;

    const mapped = reviews.map(r => ({
      author:    r.author_name,
      avatar:    r.profile_photo_url,
      rating:    r.rating,
      text:      r.text,
      time:      r.relative_time_description,
      url:       r.author_url,
    }));

    return {
      statusCode: 200,
      headers,
      body: JSON.stringify({ rating, total: user_ratings_total, reviews: mapped, source: 'live' }),
    };
  } catch (e) {
    console.error('getReviews error:', e.message);
    return { statusCode: 200, headers, body: JSON.stringify({ reviews: [], source: 'error' }) };
  }
};
