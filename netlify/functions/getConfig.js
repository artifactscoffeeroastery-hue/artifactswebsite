/**
 * getConfig.js
 * Returns non-sensitive runtime config to the frontend.
 * Keys here are still domain-restricted in Google Cloud Console —
 * this just keeps them out of the git history.
 */
exports.handler = async () => ({
  statusCode: 200,
  headers: { 'Content-Type': 'application/json', 'Cache-Control': 'public, max-age=3600' },
  body: JSON.stringify({
    googlePlacesKey: process.env.GOOGLE_PLACES_KEY || '',
  }),
});
