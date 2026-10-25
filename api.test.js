import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import { createApp } from '../server/index.js';
import { verifyWebhook, entitlement } from '../server/stripe.js';
import { localNow } from '../server/push.js';

const WH = 'whsec_test_123';
let app, port, base;
const realFetch = globalThis.fetch;
const stripeCalls = [];
let cookieJar = '';

before(async () => {
  // Intercepte les appels sortants vers Stripe pour ne rien envoyer pour de vrai.
  globalThis.fetch = async (url, opts) => {
    if (String(url).startsWith('https://api.stripe.com')) {
      stripeCalls.push({ url: String(url), method: opts?.method, body: opts?.body, auth: opts?.headers?.Authorization });
      if (String(url).includes('/checkout/sessions')) return new Response(JSON.stringify({ url: 'https://checkout.stripe.test/s_1' }), { status: 200 });
      if (String(url).includes('/billing_portal/sessions')) return new Response(JSON.stringify({ url: 'https://billing.stripe.test/p_1' }), { status: 200 });
      return new Response(JSON.stringify({ id: 'sub_x', status: 'canceled' }), { status: 200 });
    }
    return realFetch(url, opts);
  };
  app = await createApp({ SQLITE_FILE: ':memory:', BASE_URL: 'http://localhost:0', STRIPE_SECRET_KEY: 'sk_test_x', STRIPE_WEBHOOK_SECRET: WH, STRIPE_PRICE_MONTHLY: 'price_m', STRIPE_PRICE_YEARLY: 'price_y', STRIPE_PRICE_PASS: 'price_p', REVENUECAT_WEBHOOK_AUTH: 'rc_secret' });
  port = await app.listen(0);
  base = `http://127.0.0.1:${port}`;
});
after(async () => { globalThis.fetch = realFetch; await app.close(); });

async function api(path, { method = 'GET', body, headers = {}, raw, jar = true } = {}) {
  const h = { ...headers };
  if (body !== undefined) h['Content-Type'] = 'application/json';
  if (jar && cookieJar) h.Cookie = cookieJar;
  const r = await realFetch(base + path, { method, headers: h, body: raw ?? (body !== undefined ? JSON.stringify(body) : undefined) });
  const sc = r.headers.get('set-cookie');
  if (sc && jar) cookieJar = sc.split(';')[0].endsWith('=') ? '' : sc.split(';')[0];
  const text = await r.text();
  let j = null; try { j = JSON.parse(text); } catch { /* pas du JSON */ }
  return { status: r.status, j, text, headers: r.headers };
}
const sign = (payload, secret = WH, t = Math.floor(Date.now() / 1000)) => `t=${t},v1=${crypto.createHmac('sha256', secret).update(`${t}.${payload}`).digest('hex')}`;
const hook = (ev, secret) => { const raw = JSON.stringify(ev); return api('/api/webhooks/stripe', { method: 'POST', raw, headers: { 'Stripe-Signature': sign(raw, secret) }, jar: false }); };

test('santé et fichiers statiques', async () => {
  assert.equal((await api('/healthz')).j.ok, true);
  const idx = await api('/');
  assert.equal(idx.status, 200);
  assert.match(idx.headers.get('content-security-policy'), /default-src 'self'/);
  assert.equal((await api('/inexistant.png')).status, 404);
  assert.ok([403, 404].includes((await api('/..%2f..%2fpackage.json')).status));
});

test('accès refusé sans connexion', async () => {
  cookieJar = '';
  assert.equal((await api('/api/me')).status, 401);
  assert.equal((await api('/api/state')).status, 401);
  assert.equal((await api('/api/billing/checkout', { method: 'POST', body: { plan: 'monthly' } })).status, 401);
});

test('inscription : validation, doublon, essai de 7 jours', async () => {
  assert.equal((await api('/api/auth/register', { method: 'POST', body: { email: 'pas-un-mail', password: 'motdepasse1', name: 'A' } })).status, 400);
  assert.equal((await api('/api/auth/register', { method: 'POST', body: { email: 'a@b.fr', password: 'court', name: 'A' } })).status, 400);
  const r = await api('/api/auth/register', { method: 'POST', body: { email: 'Test@Exemple.fr', password: 'motdepasse1', name: 'Léa' } });
  assert.equal(r.status, 201);
  assert.equal(r.j.user.email, 'test@exemple.fr');
  assert.equal(r.j.entitlement.access, true);
  assert.equal(r.j.entitlement.status, 'trial');
  const days = (r.j.entitlement.trialEnd - Date.now()) / 864e5;
  assert.ok(days > 6.9 && days <= 7.01);
  assert.match(r.headers.get('set-cookie'), /HttpOnly/);
  assert.equal((await api('/api/auth/register', { method: 'POST', body: { email: 'test@exemple.fr', password: 'motdepasse1', name: 'Bis' } })).status, 409);
});

test('session, état synchronisé, conflit', async () => {
  const me = await api('/api/me');
  assert.equal(me.status, 200);
  assert.equal(me.j.user.name, 'Léa');
  assert.deepEqual((await api('/api/state')).j, { state: null, updatedAt: 0 });
  const t1 = Date.now();
  assert.equal((await api('/api/state', { method: 'PUT', body: { state: { day: 3, logs: [{ d: 1 }] }, updatedAt: t1 } })).status, 200);
  assert.equal((await api('/api/state')).j.state.day, 3);
  const old = await api('/api/state', { method: 'PUT', body: { state: { day: 1 }, updatedAt: t1 - 5000 } });
  assert.equal(old.status, 409);
  assert.equal(old.j.state.day, 3);
  assert.equal((await api('/api/state', { method: 'PUT', body: { state: 'pas un objet' } })).status, 400);
});

test('déconnexion puis connexion, mauvais mot de passe', async () => {
  await api('/api/auth/logout', { method: 'POST', body: {} });
  assert.equal((await api('/api/me')).status, 401);
  assert.equal((await api('/api/auth/login', { method: 'POST', body: { email: 'test@exemple.fr', password: 'mauvais-mdp' } })).status, 401);
  assert.equal((await api('/api/auth/login', { method: 'POST', body: { email: 'inconnu@exemple.fr', password: 'motdepasse1' } })).status, 401);
  assert.equal((await api('/api/auth/login', { method: 'POST', body: { email: 'test@exemple.fr', password: 'motdepasse1' } })).status, 200);
  assert.equal((await api('/api/me')).status, 200);
});

test('mode natif : jeton Bearer (appli iOS/Android) et CORS', async () => {
  const r = await api('/api/auth/login', { method: 'POST', body: { email: 'test@exemple.fr', password: 'motdepasse1' }, headers: { 'X-Client': 'native' }, jar: false });
  assert.ok(r.j.token && r.j.token.length > 20);
  assert.equal((await api('/api/me', { headers: { Authorization: `Bearer ${r.j.token}` }, jar: false })).status, 200);
  const pre = await realFetch(base + '/api/me', { method: 'OPTIONS', headers: { Origin: 'capacitor://localhost' } });
  assert.equal(pre.headers.get('access-control-allow-origin'), 'capacitor://localhost');
  const bad = await realFetch(base + '/api/auth/login', { method: 'POST', headers: { Origin: 'https://site-malveillant.example', 'Content-Type': 'application/json' }, body: '{}' });
  assert.equal(bad.status, 403);
});

test('préférences de rappel', async () => {
  assert.equal((await api('/api/prefs', { method: 'PUT', body: { remindOn: true, remindTime: '25:99', tz: 'Europe/Paris' } })).status, 400);
  assert.equal((await api('/api/prefs', { method: 'PUT', body: { remindOn: true, remindTime: '07:30', tz: 'Europe/Paris' } })).status, 200);
  assert.deepEqual((await api('/api/me')).j.prefs, { remindOn: true, remindTime: '07:30', tz: 'Europe/Paris' });
});

test('paiement : Checkout et portail via Stripe', async () => {
  assert.equal((await api('/api/billing/checkout', { method: 'POST', body: { plan: 'gratuit' } })).status, 400);
  const c = await api('/api/billing/checkout', { method: 'POST', body: { plan: 'yearly' } });
  assert.equal(c.j.url, 'https://checkout.stripe.test/s_1');
  const call = stripeCalls.at(-1);
  assert.equal(call.auth, 'Bearer sk_test_x');
  const params = new URLSearchParams(call.body);
  assert.equal(params.get('mode'), 'subscription');
  assert.equal(params.get('line_items[0][price]'), 'price_y');
  assert.equal(params.get('customer_email'), 'test@exemple.fr');
  assert.ok(params.get('client_reference_id'));
  await api('/api/billing/checkout', { method: 'POST', body: { plan: 'pass' } });
  assert.equal(new URLSearchParams(stripeCalls.at(-1).body).get('mode'), 'payment');
  assert.equal((await api('/api/billing/portal', { method: 'POST', body: {} })).status, 400);
});

test('webhook Stripe : signature, abonnement, annulation, idempotence', async () => {
  const [u] = await app.db.q('SELECT id FROM users WHERE email=$1', ['test@exemple.fr']);
  const done = { id: 'evt_1', type: 'checkout.session.completed', data: { object: { client_reference_id: u.id, customer: 'cus_1', mode: 'subscription', subscription: 'sub_1', metadata: { plan: 'yearly' } } } };
  assert.equal((await hook(done, 'mauvais_secret')).status, 400);
  assert.equal((await api('/api/webhooks/stripe', { method: 'POST', raw: JSON.stringify(done), jar: false })).status, 400);
  assert.equal((await hook(done)).status, 200);
  assert.equal((await hook(done)).j.result, 'duplicate');
  let m = (await api('/api/me')).j.entitlement;
  assert.equal(m.status, 'active'); assert.equal(m.plan, 'yearly'); assert.equal(m.canManage, true);
  assert.equal((await api('/api/billing/portal', { method: 'POST', body: {} })).j.url, 'https://billing.stripe.test/p_1');
  const end = Math.floor((Date.now() + 365 * 864e5) / 1000);
  await hook({ id: 'evt_2', type: 'customer.subscription.updated', data: { object: { id: 'sub_1', customer: 'cus_1', status: 'active', current_period_end: end, metadata: { user_id: u.id, plan: 'yearly' } } } });
  assert.equal((await api('/api/me')).j.entitlement.periodEnd, end * 1000);
  await hook({ id: 'evt_3', type: 'invoice.payment_failed', data: { object: { customer: 'cus_1' } } });
  assert.equal((await api('/api/me')).j.entitlement.access, true);
  await hook({ id: 'evt_4', type: 'customer.subscription.deleted', data: { object: { id: 'sub_1', customer: 'cus_1', status: 'canceled', current_period_end: Math.floor(Date.now() / 1000) - 3600, metadata: { user_id: u.id } } } });
  const [row] = await app.db.q('SELECT status FROM users WHERE id=$1', [u.id]);
  assert.equal(row.status, 'canceled');
});

test('pass 6 semaines : 42 jours d\'accès', async () => {
  const [u] = await app.db.q('SELECT id FROM users WHERE email=$1', ['test@exemple.fr']);
  await app.db.q("UPDATE users SET trial_end=0, status='trial', period_end=0, pass_until=0 WHERE id=$1", [u.id]);
  assert.equal((await api('/api/me')).j.entitlement.access, false);
  await hook({ id: 'evt_5', type: 'checkout.session.completed', data: { object: { client_reference_id: u.id, customer: 'cus_1', mode: 'payment', payment_status: 'paid', metadata: { plan: 'pass' } } } });
  const m = (await api('/api/me')).j.entitlement;
  assert.equal(m.status, 'pass'); assert.equal(m.access, true);
  const d = (m.passUntil - Date.now()) / 864e5;
  assert.ok(d > 41.9 && d <= 42.01);
});

test('droit d\'accès : essai terminé = bloqué', () => {
  const now = Date.now();
  assert.equal(entitlement({ trial_end: now - 1000, status: 'trial', period_end: 0, pass_until: 0 }).access, false);
  assert.equal(entitlement({ trial_end: now - 1000, status: 'canceled', period_end: now + 864e5, pass_until: 0 }).access, true);
  assert.equal(entitlement({ trial_end: now - 1000, status: 'canceled', period_end: now - 864e5, pass_until: 0 }).access, false);
});

test('signature de webhook : tolérance de temps', () => {
  const raw = '{"a":1}', t = Math.floor(Date.now() / 1000) - 1000;
  assert.equal(verifyWebhook(raw, sign(raw, WH, t), WH), false);
  assert.equal(verifyWebhook(raw, sign(raw, WH), WH), true);
});

test('webhook RevenueCat (achats des stores)', async () => {
  const [u] = await app.db.q('SELECT id FROM users WHERE email=$1', ['test@exemple.fr']);
  const ev = { event: { type: 'INITIAL_PURCHASE', app_user_id: u.id, expiration_at_ms: Date.now() + 30 * 864e5 } };
  assert.equal((await api('/api/webhooks/revenuecat', { method: 'POST', body: ev, jar: false })).status, 401);
  assert.equal((await api('/api/webhooks/revenuecat', { method: 'POST', body: ev, headers: { Authorization: 'rc_secret' }, jar: false })).status, 200);
  const m = (await api('/api/me')).j.entitlement;
  assert.equal(m.access, true); assert.equal(m.plan, 'store');
});

test('mot de passe oublié puis réinitialisation', async () => {
  const logs = []; const orig = console.log; console.log = (...a) => logs.push(a.join(' '));
  assert.equal((await api('/api/auth/forgot', { method: 'POST', body: { email: 'inconnu@x.fr' }, jar: false })).status, 200);
  assert.equal((await api('/api/auth/forgot', { method: 'POST', body: { email: 'test@exemple.fr' }, jar: false })).status, 200);
  await new Promise((r) => setTimeout(r, 50)); console.log = orig;
  const link = logs.join('\n').match(/\?reset=([\w-]+)/);
  assert.ok(link, 'le lien de réinitialisation doit être généré');
  assert.equal((await api('/api/auth/reset', { method: 'POST', body: { token: 'faux', password: 'nouveaumdp1' }, jar: false })).status, 400);
  assert.equal((await api('/api/auth/reset', { method: 'POST', body: { token: link[1], password: 'nouveaumdp1' }, jar: false })).status, 200);
  assert.equal((await api('/api/me')).status, 401);
  assert.equal((await api('/api/auth/login', { method: 'POST', body: { email: 'test@exemple.fr', password: 'nouveaumdp1' } })).status, 200);
  assert.equal((await api('/api/auth/reset', { method: 'POST', body: { token: link[1], password: 'autremdp123' }, jar: false })).status, 400);
});

test('rappels : calcul de l\'heure locale', () => {
  const l = localNow('Europe/Paris', new Date('2026-07-01T16:30:00Z'));
  assert.equal(l.hm, '18:30'); assert.equal(l.day, '2026-07-01');
  assert.equal(localNow('Asia/Tokyo', new Date('2026-07-01T16:30:00Z')).day, '2026-07-02');
});

test('export des données et suppression du compte', async () => {
  const ex = await api('/api/export');
  assert.equal(ex.status, 200);
  assert.equal(ex.j.user.email, 'test@exemple.fr');
  assert.equal(ex.j.state.day, 3);
  assert.equal((await api('/api/account', { method: 'DELETE' })).status, 200);
  assert.equal((await app.db.q('SELECT id FROM users')).length, 0);
  assert.equal((await app.db.q('SELECT user_id FROM states')).length, 0);
  assert.equal((await api('/api/me')).status, 401);
});
