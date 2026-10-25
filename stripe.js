// Paiements Stripe sans SDK : Checkout, portail client, webhooks signés, droits d'accès (« entitlements »).
import crypto from 'node:crypto';

const API = 'https://api.stripe.com/v1';
const DAY = 864e5;

const enc = (o, prefix = '', out = []) => {
  for (const [k, v] of Object.entries(o)) {
    if (v == null) continue;
    const key = prefix ? `${prefix}[${k}]` : k;
    if (typeof v === 'object') enc(v, key, out);
    else out.push(`${encodeURIComponent(key)}=${encodeURIComponent(v)}`);
  }
  return out;
};

async function call(path, params, key, method = 'POST') {
  const r = await fetch(API + path, {
    method,
    headers: { Authorization: `Bearer ${key}`, 'Content-Type': 'application/x-www-form-urlencoded' },
    body: method === 'POST' ? enc(params || {}).join('&') : undefined,
  });
  const j = await r.json().catch(() => ({}));
  if (!r.ok) throw Object.assign(new Error(j?.error?.message || 'stripe_error'), { status: r.status, j });
  return j;
}

export const PLAN_IDS = ['monthly', 'yearly', 'pass'];

export function priceFor(plan, env = process.env) {
  return { monthly: env.STRIPE_PRICE_MONTHLY, yearly: env.STRIPE_PRICE_YEARLY, pass: env.STRIPE_PRICE_PASS }[plan];
}

export async function createCheckout(user, plan, baseUrl, env = process.env) {
  const key = env.STRIPE_SECRET_KEY, price = priceFor(plan, env);
  if (!key || !price) throw Object.assign(new Error('billing_not_configured'), { status: 503 });
  const sub = plan !== 'pass';
  const params = {
    mode: sub ? 'subscription' : 'payment',
    success_url: `${baseUrl}/?checkout=success`,
    cancel_url: `${baseUrl}/?checkout=cancel`,
    client_reference_id: user.id,
    line_items: { 0: { price, quantity: 1 } },
    allow_promotion_codes: 'true',
    locale: 'fr',
    metadata: { plan, user_id: user.id },
  };
  if (user.stripe_customer) params.customer = user.stripe_customer;
  else {
    params.customer_email = user.email;
    if (!sub) params.customer_creation = 'always';
  }
  if (sub) params.subscription_data = { metadata: { plan, user_id: user.id } };
  const s = await call('/checkout/sessions', params, key);
  return s.url;
}

export async function createPortal(user, baseUrl, env = process.env) {
  const key = env.STRIPE_SECRET_KEY;
  if (!key) throw Object.assign(new Error('billing_not_configured'), { status: 503 });
  if (!user.stripe_customer) throw Object.assign(new Error('no_customer'), { status: 400 });
  const s = await call('/billing_portal/sessions', { customer: user.stripe_customer, return_url: `${baseUrl}/` }, key);
  return s.url;
}

export async function cancelSubscription(user, env = process.env) {
  if (!env.STRIPE_SECRET_KEY || !user.stripe_sub) return;
  try { await call(`/subscriptions/${user.stripe_sub}`, null, env.STRIPE_SECRET_KEY, 'DELETE'); } catch (e) { console.warn('cancel sub:', e.message); }
}

// En-tête Stripe-Signature : t=timestamp,v1=signature[,v1=...]
export function verifyWebhook(raw, header, secret, toleranceSec = 300, now = Date.now()) {
  if (!secret || !header) return false;
  const parts = Object.fromEntries(header.split(',').map((p) => p.split('=')).filter((p) => p.length === 2).map(([k, v]) => [k, v]));
  const sigs = header.split(',').filter((p) => p.startsWith('v1=')).map((p) => p.slice(3));
  if (!parts.t || !sigs.length) return false;
  if (Math.abs(now / 1000 - Number(parts.t)) > toleranceSec) return false;
  const exp = crypto.createHmac('sha256', secret).update(`${parts.t}.${raw}`).digest('hex');
  return sigs.some((s) => s.length === exp.length && crypto.timingSafeEqual(Buffer.from(s), Buffer.from(exp)));
}

const subStatus = (s) => ({ active: 'active', trialing: 'active', past_due: 'past_due', canceled: 'canceled', unpaid: 'canceled', incomplete_expired: 'canceled', incomplete: 'trial', paused: 'canceled' }[s] || 'canceled');

export async function handleEvent(db, ev) {
  const seen = await db.q('SELECT id FROM events WHERE id=$1', [ev.id]);
  if (seen.length) return 'duplicate';
  await db.q('INSERT INTO events(id,at) VALUES($1,$2)', [ev.id, Date.now()]);
  const o = ev.data?.object || {};
  const now = Date.now();
  if (ev.type === 'checkout.session.completed') {
    const uid = o.client_reference_id;
    if (!uid) return 'ignored';
    const [u] = await db.q('SELECT * FROM users WHERE id=$1', [uid]);
    if (!u) return 'ignored';
    if (o.customer) await db.q('UPDATE users SET stripe_customer=$1 WHERE id=$2', [o.customer, uid]);
    if (o.mode === 'payment' && o.payment_status === 'paid') {
      const base = Math.max(now, u.pass_until || 0);
      await db.q('UPDATE users SET pass_until=$1, plan=$2 WHERE id=$3', [base + 42 * DAY, 'pass', uid]);
    } else if (o.mode === 'subscription') {
      const plan = o.metadata?.plan === 'yearly' ? 'yearly' : 'monthly';
      const provisional = now + (plan === 'yearly' ? 367 : 33) * DAY;
      await db.q('UPDATE users SET stripe_sub=$1, plan=$2, status=$3, period_end=$4 WHERE id=$5', [o.subscription || null, plan, 'active', Math.max(u.period_end || 0, provisional), uid]);
    }
    return 'checkout';
  }
  if (ev.type.startsWith('customer.subscription.')) {
    const uid = o.metadata?.user_id;
    const rows = uid ? await db.q('SELECT * FROM users WHERE id=$1', [uid]) : await db.q('SELECT * FROM users WHERE stripe_customer=$1', [o.customer]);
    const u = rows[0];
    if (!u) return 'ignored';
    const end = (o.current_period_end ?? o.items?.data?.[0]?.current_period_end) * 1000 || u.period_end;
    const interval = o.items?.data?.[0]?.price?.recurring?.interval;
    const plan = o.metadata?.plan || (interval === 'year' ? 'yearly' : 'monthly');
    const status = ev.type === 'customer.subscription.deleted' ? 'canceled' : subStatus(o.status);
    await db.q('UPDATE users SET stripe_customer=$1, stripe_sub=$2, plan=$3, status=$4, period_end=$5 WHERE id=$6', [o.customer || u.stripe_customer, o.id || u.stripe_sub, plan, status, end, u.id]);
    return 'subscription';
  }
  if (ev.type === 'invoice.payment_failed') {
    await db.q("UPDATE users SET status='past_due' WHERE stripe_customer=$1 AND status='active'", [o.customer]);
    return 'payment_failed';
  }
  return 'ignored';
}

// Droit d'accès : essai, abonnement (avec petite tolérance), pass 6 semaines.
export function entitlement(u, now = Date.now()) {
  const grace = u.status === 'past_due' ? 3 * DAY : 2 * DAY;
  const subUntil = ['active', 'past_due', 'canceled'].includes(u.status) && u.period_end ? u.period_end + (u.status === 'canceled' ? 0 : grace) : 0;
  const accessUntil = Math.max(u.trial_end || 0, u.pass_until || 0, subUntil);
  const access = now < accessUntil;
  let status = 'expired';
  if (access) status = now < (u.pass_until || 0) ? 'pass' : (subUntil > now ? (u.status === 'canceled' ? 'canceled' : 'active') : 'trial');
  return { access, status, plan: u.plan || null, trialEnd: u.trial_end || 0, periodEnd: u.period_end || 0, passUntil: u.pass_until || 0, accessUntil, canManage: !!u.stripe_customer };
}
