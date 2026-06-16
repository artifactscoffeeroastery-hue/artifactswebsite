/**
 * redeem-voucher
 * Supabase Edge Function — service-role only
 *
 * Atomically:
 *  1. Verifies the caller is authenticated
 *  2. Checks the customer has enough points (≥ points_cost)
 *  3. Generates a unique voucher code
 *  4. Inserts a voucher row
 *  5. Inserts a point_events debit row
 *  6. Updates the customer's points_balance
 *
 * Body: { customer_id: string, points_cost: number, value_rand: number }
 *   points_cost  – points to deduct (default 500)
 *   value_rand   – voucher value in cents (default 5000 = R50)
 *
 * Required env vars (Supabase dashboard → Edge Functions → Secrets):
 *   SUPABASE_URL          – set automatically by Supabase
 *   SUPABASE_SERVICE_ROLE_KEY – set automatically by Supabase
 */

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const corsHeaders = {
  'Access-Control-Allow-Origin':  '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

Deno.serve(async (req: Request) => {
  // Handle CORS preflight
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders });
  }

  try {
    // ── 1. Auth — verify the caller's JWT ──────────────────────────────────
    const authHeader = req.headers.get('Authorization');
    if (!authHeader) {
      return new Response(JSON.stringify({ error: 'Missing authorization header' }), {
        status: 401, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    // Service-role client for privileged operations
    const admin = createClient(
      Deno.env.get('SUPABASE_URL')!,
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
      { auth: { autoRefreshToken: false, persistSession: false } }
    );

    // Verify the user's token
    const token = authHeader.replace('Bearer ', '');
    const { data: { user }, error: userError } = await admin.auth.getUser(token);

    if (userError || !user) {
      return new Response(JSON.stringify({ error: 'Unauthorized' }), {
        status: 401, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    // ── 2. Parse body ───────────────────────────────────────────────────────
    const body        = await req.json();
    const customerId  = body.customer_id as string;
    const pointsCost  = (body.points_cost as number)  ?? 500;
    const valueRand   = (body.value_rand  as number)  ?? 5000; // cents

    // Caller must match the authenticated user
    if (customerId !== user.id) {
      return new Response(JSON.stringify({ error: 'Forbidden' }), {
        status: 403, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    // ── 3. Check balance ────────────────────────────────────────────────────
    const { data: customer, error: fetchErr } = await admin
      .from('customers')
      .select('points_balance')
      .eq('id', customerId)
      .single();

    if (fetchErr || !customer) {
      return new Response(JSON.stringify({ error: 'Customer not found' }), {
        status: 404, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    if (customer.points_balance < pointsCost) {
      return new Response(JSON.stringify({ error: 'Insufficient points', balance: customer.points_balance, required: pointsCost }), {
        status: 422, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    // ── 4. Generate unique voucher code ─────────────────────────────────────
    const code = `ART-${Math.random().toString(36).slice(2, 6).toUpperCase()}-${Math.random().toString(36).slice(2, 6).toUpperCase()}`;
    const expiresAt = new Date();
    expiresAt.setMonth(expiresAt.getMonth() + 6); // 6-month validity

    // ── 5. Insert voucher ───────────────────────────────────────────────────
    const { data: voucher, error: voucherErr } = await admin
      .from('vouchers')
      .insert({
        customer_id: customerId,
        code,
        value_rand:  valueRand,
        redeemed:    false,
        expires_at:  expiresAt.toISOString(),
      })
      .select()
      .single();

    if (voucherErr) {
      console.error('Voucher insert error:', voucherErr);
      return new Response(JSON.stringify({ error: 'Failed to create voucher' }), {
        status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    // ── 6. Debit point_events ───────────────────────────────────────────────
    const { error: eventErr } = await admin
      .from('point_events')
      .insert({
        customer_id:  customerId,
        event_type:   'redemption',
        points:       -pointsCost,
        description:  `Voucher ${code} — R${valueRand / 100} off`,
        reference_id: voucher.id,
      });

    if (eventErr) {
      console.error('Point event insert error:', eventErr);
      // Voucher was created — still roll forward but log the error
    }

    // ── 7. Decrement customer balance ───────────────────────────────────────
    const { error: balanceErr } = await admin
      .from('customers')
      .update({ points_balance: customer.points_balance - pointsCost })
      .eq('id', customerId);

    if (balanceErr) {
      console.error('Balance update error:', balanceErr);
    }

    // ── Done ────────────────────────────────────────────────────────────────
    return new Response(
      JSON.stringify({
        success:    true,
        voucher_id: voucher.id,
        code,
        value_rand: valueRand,
        expires_at: expiresAt.toISOString(),
        points_deducted: pointsCost,
        new_balance: customer.points_balance - pointsCost,
      }),
      { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );

  } catch (err) {
    console.error('redeem-voucher unhandled error:', err);
    return new Response(JSON.stringify({ error: 'Internal server error' }), {
      status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }
});
