/**
 * officeEnquiry.js
 * Saves an Office Coffee Programme lead to Supabase
 * and sends a notification email via Resend.
 */

const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_KEY = process.env.SUPABASE_SERVICE_KEY;
const RESEND_KEY   = process.env.RESEND_API_KEY;
const NOTIFY_EMAIL = 'artifacts.coffee.roastery@gmail.com';

exports.handler = async (event) => {
  if (event.httpMethod !== 'POST') return { statusCode: 405, body: 'Method Not Allowed' };

  let body;
  try { body = JSON.parse(event.body); } catch { return { statusCode: 400, body: 'Bad JSON' }; }

  const { name, company, email, teamSize, plan } = body;
  if (!name || !company || !email || !teamSize) {
    return { statusCode: 400, body: 'Missing required fields' };
  }

  const headers = { 'Content-Type': 'application/json' };

  // 1. Save to Supabase
  if (SUPABASE_URL && SUPABASE_KEY) {
    try {
      await fetch(`${SUPABASE_URL}/rest/v1/office_leads`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          apikey: SUPABASE_KEY,
          Authorization: `Bearer ${SUPABASE_KEY}`,
          Prefer: 'return=minimal'
        },
        body: JSON.stringify({ name, company, email, team_size: teamSize, plan: plan || null })
      });
    } catch (e) {
      console.error('Supabase lead save error:', e.message);
    }
  }

  // 2. Send notification email via Resend
  if (RESEND_KEY) {
    try {
      await fetch('https://api.resend.com/emails', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${RESEND_KEY}` },
        body: JSON.stringify({
          from: 'Artifacts Coffee <onboarding@resend.dev>',
          to: [NOTIFY_EMAIL],
          subject: `New Office Enquiry — ${company}`,
          html: `
            <p><strong>Name:</strong> ${name}</p>
            <p><strong>Company:</strong> ${company}</p>
            <p><strong>Email:</strong> ${email}</p>
            <p><strong>Team Size:</strong> ${teamSize}</p>
            <p><strong>Interested Plan:</strong> ${plan || 'Not specified'}</p>
          `
        })
      });
    } catch (e) {
      console.error('Resend notify error:', e.message);
    }
  }

  return { statusCode: 200, headers, body: JSON.stringify({ ok: true }) };
};
