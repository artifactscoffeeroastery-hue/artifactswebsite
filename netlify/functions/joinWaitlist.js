/**
 * joinWaitlist.js
 * Saves an email address to the Supabase `waitlist` table.
 *
 * Supabase table required:
 *   CREATE TABLE waitlist (
 *     id          BIGSERIAL PRIMARY KEY,
 *     email       TEXT NOT NULL UNIQUE,
 *     source      TEXT,
 *     created_at  TIMESTAMPTZ DEFAULT NOW()
 *   );
 */

const { createClient } = require('@supabase/supabase-js');

exports.handler = async (event) => {
  if (event.httpMethod !== 'POST') {
    return { statusCode: 405, body: 'Method Not Allowed' };
  }

  let email, source;
  try {
    ({ email, source } = JSON.parse(event.body));
  } catch {
    return { statusCode: 400, body: JSON.stringify({ error: 'Invalid JSON' }) };
  }

  if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    return { statusCode: 400, body: JSON.stringify({ error: 'Invalid email address' }) };
  }

  const supabase = createClient(
    process.env.SUPABASE_URL,
    process.env.SUPABASE_KEY
  );

  const { error } = await supabase
    .from('waitlist')
    .upsert({ email: email.toLowerCase().trim(), source: source || 'hero' }, { onConflict: 'email' });

  if (error) {
    console.error('Supabase error:', error);
    return { statusCode: 500, body: JSON.stringify({ error: 'Could not save email' }) };
  }

  return {
    statusCode: 200,
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ success: true }),
  };
};
