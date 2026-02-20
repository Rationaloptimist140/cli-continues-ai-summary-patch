/**
 * Vercel Edge Function: /api/validate-key
 *
 * Receives a CONTINUES_PRO_KEY, checks it against KV store (or env list),
 * returns { valid: true } or { valid: false }.
 *
 * Deploy: vercel deploy
 * Env vars needed:
 *   PRO_KEYS_CSV   — comma-separated list of valid keys (simple), OR
 *   KV_URL         — Vercel KV connection string (production)
 *   STRIPE_WEBHOOK_SECRET — for the /api/stripe-webhook endpoint
 */

export const config = { runtime: 'edge' };

export default async function handler(req: Request): Promise<Response> {
  // CORS — CLI calls this from user machines
  const headers = {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type',
    'Content-Type': 'application/json',
  };

  if (req.method === 'OPTIONS') {
    return new Response(null, { status: 204, headers });
  }

  if (req.method !== 'POST') {
    return new Response(JSON.stringify({ valid: false, error: 'Method not allowed' }), {
      status: 405,
      headers,
    });
  }

  let body: { key?: string };
  try {
    body = await req.json();
  } catch {
    return new Response(JSON.stringify({ valid: false, error: 'Invalid JSON' }), {
      status: 400,
      headers,
    });
  }

  const { key } = body;
  if (!key || typeof key !== 'string' || key.length < 20) {
    return new Response(JSON.stringify({ valid: false, error: 'Missing or malformed key' }), {
      status: 400,
      headers,
    });
  }

  const isValid = await checkKey(key);

  return new Response(JSON.stringify({ valid: isValid }), {
    status: isValid ? 200 : 403,
    headers,
  });
}

/**
 * Check key validity.
 *
 * Two modes:
 * 1. Simple CSV env var (good for early stage / <100 customers)
 * 2. Vercel KV lookup (production scale)
 */
async function checkKey(key: string): Promise<boolean> {
  // Mode 1: CSV list in env (quick bootstrap)
  const csvKeys = (process.env.PRO_KEYS_CSV || '').split(',').map(k => k.trim()).filter(Boolean);
  if (csvKeys.length > 0) {
    return csvKeys.includes(key);
  }

  // Mode 2: Vercel KV (set key via /api/stripe-webhook after payment)
  const kvUrl = process.env.KV_URL;
  if (kvUrl) {
    try {
      const res = await fetch(`${kvUrl}/get/${encodeURIComponent(`pro:${key}`)}`, {
        headers: { Authorization: `Bearer ${process.env.KV_REST_API_TOKEN}` },
      });
      if (!res.ok) return false;
      const data = await res.json() as any;
      return data?.result === 'active';
    } catch {
      return false;
    }
  }

  return false;
}
