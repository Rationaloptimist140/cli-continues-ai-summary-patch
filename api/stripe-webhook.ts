/**
 * Vercel Edge Function: /api/stripe-webhook
 *
 * Listens for Stripe checkout.session.completed events.
 * On successful payment:
 *   1. Generates a unique CONTINUES_PRO_KEY
 *   2. Saves it to Vercel KV as active
 *   3. Sends a welcome email via Resend with the key + setup instructions
 *
 * Env vars needed:
 *   STRIPE_WEBHOOK_SECRET   — from Stripe Dashboard > Webhooks
 *   KV_URL                  — Vercel KV connection string
 *   KV_REST_API_TOKEN       — Vercel KV token
 *   RESEND_API_KEY          — from resend.com (free tier is fine)
 *   EMAIL_FROM              — e.g. "Continues Pro <pro@yourdomain.com>"
 */

export const config = { runtime: 'edge' };

const RESEND_API = 'https://api.resend.com/emails';

export default async function handler(req: Request): Promise<Response> {
  if (req.method !== 'POST') {
    return new Response('Method not allowed', { status: 405 });
  }

  const sig = req.headers.get('stripe-signature');
  const secret = process.env.STRIPE_WEBHOOK_SECRET;

  if (!sig || !secret) {
    return new Response('Missing signature', { status: 400 });
  }

  const body = await req.text();

  // Verify Stripe signature (edge-compatible)
  const isValid = await verifyStripeSignature(body, sig, secret);
  if (!isValid) {
    return new Response('Invalid signature', { status: 401 });
  }

  const event = JSON.parse(body);

  if (event.type === 'checkout.session.completed') {
    const session = event.data.object;
    const email = session.customer_details?.email;

    if (!email) {
      return new Response('No email in session', { status: 400 });
    }

    // Generate a unique pro key
    const proKey = generateProKey();

    // Save to KV
    await saveKeyToKV(proKey, email);

    // Email the key to the customer
    await sendWelcomeEmail(email, proKey);
  }

  return new Response('ok', { status: 200 });
}

function generateProKey(): string {
  const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
  const arr = new Uint8Array(32);
  crypto.getRandomValues(arr);
  return 'cpr_' + Array.from(arr).map(b => chars[b % chars.length]).join('');
}

async function saveKeyToKV(key: string, email: string): Promise<void> {
  const kvUrl = process.env.KV_URL;
  const token = process.env.KV_REST_API_TOKEN;
  if (!kvUrl || !token) return;

  await fetch(`${kvUrl}/set/${encodeURIComponent(`pro:${key}`)}`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ value: 'active', metadata: { email, created: Date.now() } }),
  });
}

async function sendWelcomeEmail(to: string, proKey: string): Promise<void> {
  const apiKey = process.env.RESEND_API_KEY;
  if (!apiKey) return;

  const html = `
<h2>Welcome to Continues Pro</h2>
<p>Your pro key is ready. Add it to your shell profile:</p>
<pre style="background:#1e1e1e;color:#d4d4d4;padding:16px;border-radius:8px;">
export CONTINUES_PRO_KEY=${proKey}
</pre>
<p>Then use the AI summary feature:</p>
<pre style="background:#1e1e1e;color:#d4d4d4;padding:16px;border-radius:8px;">
continues resume &lt;session-id&gt; --in claude --ai-summary
</pre>
<p><strong>Your key:</strong> <code>${proKey}</code></p>
<p>Keep this safe — it's tied to your subscription. If you need to regenerate it, reply to this email.</p>
<hr/>
<p style="color:#888;font-size:12px;">Continues Pro &bull; Unsubscribe anytime by cancelling in Stripe</p>
`;

  await fetch(RESEND_API, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${apiKey}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      from: process.env.EMAIL_FROM || 'Continues Pro <pro@continues.dev>',
      to,
      subject: 'Your Continues Pro key',
      html,
    }),
  });
}

/**
 * Verify Stripe webhook signature using Web Crypto API (edge-compatible).
 */
async function verifyStripeSignature(
  payload: string,
  header: string,
  secret: string,
): Promise<boolean> {
  try {
    const parts = Object.fromEntries(header.split(',').map(p => p.split('=')));
    const timestamp = parts['t'];
    const signature = parts['v1'];

    const signedPayload = `${timestamp}.${payload}`;
    const enc = new TextEncoder();

    const key = await crypto.subtle.importKey(
      'raw',
      enc.encode(secret),
      { name: 'HMAC', hash: 'SHA-256' },
      false,
      ['sign'],
    );

    const sig = await crypto.subtle.sign('HMAC', key, enc.encode(signedPayload));
    const computed = Array.from(new Uint8Array(sig))
      .map(b => b.toString(16).padStart(2, '0'))
      .join('');

    return computed === signature;
  } catch {
    return false;
  }
}
