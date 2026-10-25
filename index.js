// Serveur Tendra : API (comptes, état, abonnement, notifications) + fichiers statiques. Aucune dépendance obligatoire hors « pg » (prod).
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { openDb } from './db.js';
import { hashPw, checkPw, newToken, sha, uid, validEmail, validPw, limited } from './auth.js';
import { entitlement, createCheckout, createPortal, cancelSubscription, verifyWebhook, handleEvent, PLAN_IDS } from './stripe.js';
import { sendMail } from './mail.js';
import { initPush, pushKey, saveSub, startScheduler } from './push.js';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const PUB = path.join(HERE, '..', 'public');
const DAY = 864e5;
const MIME = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.json': 'application/json; charset=utf-8', '.webmanifest': 'application/manifest+json', '.png': 'image/png', '.svg': 'image/svg+xml', '.ico': 'image/x-icon', '.mp4': 'video/mp4', '.webm': 'video/webm', '.txt': 'text/plain; charset=utf-8' };

export async function createApp(env = process.env) {
  const db = await openDb({ url: env.DATABASE_URL, file: env.SQLITE_FILE });
  const BASE = (env.BASE_URL || `http://localhost:${env.PORT || 3000}`).replace(/\/$/, '');
  const SECURE = BASE.startsWith('https://');
  const CORS = (env.CORS_ORIGINS || 'capacitor://localhost,https://localhost,http://localhost').split(',').map((s) => s.trim());
  const pushOn = await initPush(env);

  const send = (res, code, body, headers = {}) => {
    const data = typeof body === 'string' || Buffer.isBuffer(body) ? body : JSON.stringify(body);
    res.writeHead(code, { 'Content-Type': typeof body === 'object' && !Buffer.isBuffer(body) ? 'application/json; charset=utf-8' : 'text/plain; charset=utf-8', 'Cache-Control': 'no-store', ...headers });
    res.end(data);
  };
  const cookie = (token, maxAge) => `tendra_session=${token}; HttpOnly; Path=/; SameSite=Lax; Max-Age=${maxAge}${SECURE ? '; Secure' : ''}`;

  const readBody = (req, limit = 400 * 1024) => new Promise((resolve, reject) => {
    const chunks = []; let n = 0;
    req.on('data', (c) => { n += c.length; if (n > limit) { reject(Object.assign(new Error('too_large'), { status: 413 })); req.destroy(); } else chunks.push(c); });
    req.on('end', () => resolve(Buffer.concat(chunks)));
    req.on('error', reject);
  });

  const parseCookies = (h = '') => Object.fromEntries(h.split(';').map((c) => c.trim().split('=')).filter((p) => p[0]).map(([k, ...v]) => [k, v.join('=')]));

  async function userFrom(req) {
    const auth = req.headers.authorization || '';
    const token = auth.startsWith('Bearer ') ? auth.slice(7) : parseCookies(req.headers.cookie).tendra_session;
    if (!token) return null;
    const rows = await db.q('SELECT u.* FROM sessions s JOIN users u ON u.id=s.user_id WHERE s.token_hash=$1 AND s.expires>$2', [sha(token), Date.now()]);
    return rows[0] || null;
  }

  async function openSession(res, user, native) {
    const token = newToken();
    await db.q('INSERT INTO sessions(token_hash,user_id,expires) VALUES($1,$2,$3)', [sha(token), user.id, Date.now() + 30 * DAY]);
    res.setHeader('Set-Cookie', cookie(token, 30 * 86400));
    return native ? token : undefined;
  }

  const publicUser = (u) => ({ id: u.id, email: u.email, name: u.name });
  const me = (u) => ({ user: publicUser(u), entitlement: entitlement(u), prefs: { remindOn: !!u.remind_on, remindTime: u.remind_time, tz: u.tz } });

  const routes = {};
  const route = (m, p, fn) => { routes[`${m} ${p}`] = fn; };

  route('GET', '/healthz', async (c) => send(c.res, 200, { ok: true, push: pushOn }));

  route('POST', '/api/auth/register', async (c) => {
    const { email, password, name } = c.body;
    if (limited(`reg:${c.ip}`, 10)) return send(c.res, 429, { error: 'too_many_requests' });
    const e = String(email || '').trim().toLowerCase(), n = String(name || '').trim().slice(0, 60);
    if (!validEmail(e)) return send(c.res, 400, { error: 'invalid_email' });
    if (!validPw(password)) return send(c.res, 400, { error: 'invalid_password' });
    if (!n) return send(c.res, 400, { error: 'invalid_name' });
    if ((await db.q('SELECT id FROM users WHERE email=$1', [e])).length) return send(c.res, 409, { error: 'email_taken' });
    const id = uid(), now = Date.now();
    await db.q('INSERT INTO users(id,email,name,pw_hash,created_at,trial_end) VALUES($1,$2,$3,$4,$5,$6)', [id, e, n, await hashPw(password), now, now + 7 * DAY]);
    const [u] = await db.q('SELECT * FROM users WHERE id=$1', [id]);
    const token = await openSession(c.res, u, c.native);
    send(c.res, 201, { ...me(u), token });
  });

  route('POST', '/api/auth/login', async (c) => {
    if (limited(`login:${c.ip}`, 20)) return send(c.res, 429, { error: 'too_many_requests' });
    const e = String(c.body.email || '').trim().toLowerCase();
    const [u] = await db.q('SELECT * FROM users WHERE email=$1', [e]);
    const ok = u ? await checkPw(String(c.body.password || ''), u.pw_hash) : (await checkPw('x', 'scrypt$16384$8$1$00$00'), false);
    if (!ok) return send(c.res, 401, { error: 'invalid_credentials' });
    const token = await openSession(c.res, u, c.native);
    send(c.res, 200, { ...me(u), token });
  });

  route('POST', '/api/auth/logout', async (c) => {
    const auth = c.req.headers.authorization || '';
    const token = auth.startsWith('Bearer ') ? auth.slice(7) : parseCookies(c.req.headers.cookie).tendra_session;
    if (token) await db.q('DELETE FROM sessions WHERE token_hash=$1', [sha(token)]);
    send(c.res, 200, { ok: true }, { 'Set-Cookie': cookie('', 0) });
  });

  route('POST', '/api/auth/forgot', async (c) => {
    if (limited(`forgot:${c.ip}`, 5)) return send(c.res, 429, { error: 'too_many_requests' });
    const e = String(c.body.email || '').trim().toLowerCase();
    const [u] = validEmail(e) ? await db.q('SELECT * FROM users WHERE email=$1', [e]) : [];
    if (u) {
      const t = newToken();
      await db.q('INSERT INTO resets(token_hash,user_id,expires) VALUES($1,$2,$3)', [sha(t), u.id, Date.now() + 3600e3]);
      const link = `${BASE}/?reset=${t}`;
      sendMail({ to: u.email, subject: 'Réinitialiser ton mot de passe Tendra', text: `Pour choisir un nouveau mot de passe, ouvre ce lien (valable 1 heure) : ${link}`, html: `<p>Pour choisir un nouveau mot de passe, <a href="${link}">clique ici</a> (lien valable 1 heure).</p>` }, env).catch((er) => console.warn('mail:', er.message));
    }
    send(c.res, 200, { ok: true }); // même réponse que le compte existe ou non
  });

  route('POST', '/api/auth/reset', async (c) => {
    if (limited(`reset:${c.ip}`, 10)) return send(c.res, 429, { error: 'too_many_requests' });
    const { token, password } = c.body;
    if (!validPw(password)) return send(c.res, 400, { error: 'invalid_password' });
    const [r] = await db.q('SELECT * FROM resets WHERE token_hash=$1 AND expires>$2', [sha(String(token || '')), Date.now()]);
    if (!r) return send(c.res, 400, { error: 'invalid_token' });
    await db.q('UPDATE users SET pw_hash=$1 WHERE id=$2', [await hashPw(password), r.user_id]);
    await db.q('DELETE FROM sessions WHERE user_id=$1', [r.user_id]);
    await db.q('DELETE FROM resets WHERE user_id=$1', [r.user_id]);
    send(c.res, 200, { ok: true });
  });

  const authed = (fn) => async (c) => {
    const u = await userFrom(c.req);
    if (!u) return send(c.res, 401, { error: 'unauthenticated' });
    c.user = u;
    return fn(c);
  };

  route('GET', '/api/me', authed(async (c) => send(c.res, 200, me(c.user))));

  route('GET', '/api/state', authed(async (c) => {
    const [s] = await db.q('SELECT data,updated_at FROM states WHERE user_id=$1', [c.user.id]);
    send(c.res, 200, s ? { state: JSON.parse(s.data), updatedAt: s.updated_at } : { state: null, updatedAt: 0 });
  }));

  route('PUT', '/api/state', authed(async (c) => {
    const { state, updatedAt } = c.body;
    if (!state || typeof state !== 'object') return send(c.res, 400, { error: 'invalid_state' });
    const t = Number(updatedAt) || Date.now();
    const [cur] = await db.q('SELECT data,updated_at FROM states WHERE user_id=$1', [c.user.id]);
    if (cur && cur.updated_at > t) return send(c.res, 409, { conflict: true, state: JSON.parse(cur.data), updatedAt: cur.updated_at });
    await db.q('INSERT INTO states(user_id,data,updated_at) VALUES($1,$2,$3) ON CONFLICT(user_id) DO UPDATE SET data=excluded.data, updated_at=excluded.updated_at', [c.user.id, JSON.stringify(state), t]);
    send(c.res, 200, { ok: true, updatedAt: t });
  }));

  route('PUT', '/api/prefs', authed(async (c) => {
    const { remindOn, remindTime, tz } = c.body;
    if (!/^([01]\d|2[0-3]):[0-5]\d$/.test(String(remindTime || ''))) return send(c.res, 400, { error: 'invalid_time' });
    let zone = 'Europe/Paris';
    try { new Intl.DateTimeFormat('en', { timeZone: tz }); zone = tz; } catch { /* fuseau invalide : valeur par défaut */ }
    await db.q('UPDATE users SET remind_on=$1, remind_time=$2, tz=$3 WHERE id=$4', [remindOn ? 1 : 0, remindTime, zone, c.user.id]);
    send(c.res, 200, { ok: true });
  }));

  route('GET', '/api/push/key', authed(async (c) => send(c.res, 200, { key: pushKey() })));
  route('POST', '/api/push/subscribe', authed(async (c) => send(c.res, (await saveSub(db, c.user.id, c.body)) ? 200 : 400, { ok: true })));

  route('POST', '/api/billing/checkout', authed(async (c) => {
    if (!PLAN_IDS.includes(c.body.plan)) return send(c.res, 400, { error: 'invalid_plan' });
    try { send(c.res, 200, { url: await createCheckout(c.user, c.body.plan, BASE, env) }); }
    catch (e) { send(c.res, e.status === 503 ? 503 : 502, { error: e.message }); }
  }));

  route('POST', '/api/billing/portal', authed(async (c) => {
    try { send(c.res, 200, { url: await createPortal(c.user, BASE, env) }); }
    catch (e) { send(c.res, e.status || 502, { error: e.message }); }
  }));

  route('POST', '/api/webhooks/stripe', async (c) => {
    if (!verifyWebhook(c.raw.toString('utf8'), c.req.headers['stripe-signature'], env.STRIPE_WEBHOOK_SECRET)) return send(c.res, 400, { error: 'bad_signature' });
    let ev; try { ev = JSON.parse(c.raw.toString('utf8')); } catch { return send(c.res, 400, { error: 'bad_json' }); }
    send(c.res, 200, { received: true, result: await handleEvent(db, ev) });
  });

  // Achats via les stores (RevenueCat) : l'identifiant d'utilisateur RevenueCat = identifiant Tendra.
  route('POST', '/api/webhooks/revenuecat', async (c) => {
    if (!env.REVENUECAT_WEBHOOK_AUTH || c.req.headers.authorization !== env.REVENUECAT_WEBHOOK_AUTH) return send(c.res, 401, { error: 'unauthorized' });
    const e = c.body.event || {};
    const [u] = await db.q('SELECT * FROM users WHERE id=$1', [e.app_user_id]);
    if (!u) return send(c.res, 200, { ignored: true });
    const exp = Number(e.expiration_at_ms) || 0;
    const active = ['INITIAL_PURCHASE', 'RENEWAL', 'UNCANCELLATION', 'PRODUCT_CHANGE', 'NON_RENEWING_PURCHASE'].includes(e.type);
    const gone = ['EXPIRATION'].includes(e.type);
    if (active) await db.q("UPDATE users SET plan='store', status='active', period_end=$1 WHERE id=$2", [exp || Date.now() + 33 * DAY, u.id]);
    else if (e.type === 'CANCELLATION') await db.q("UPDATE users SET status='canceled', period_end=$1 WHERE id=$2", [exp || u.period_end, u.id]);
    else if (gone) await db.q("UPDATE users SET status='canceled', period_end=$1 WHERE id=$2", [Math.min(exp || Date.now(), Date.now()), u.id]);
    send(c.res, 200, { ok: true });
  });

  route('GET', '/api/export', authed(async (c) => {
    const [s] = await db.q('SELECT data,updated_at FROM states WHERE user_id=$1', [c.user.id]);
    send(c.res, 200, { exportedAt: new Date().toISOString(), user: { ...publicUser(c.user), createdAt: c.user.created_at }, entitlement: entitlement(c.user), state: s ? JSON.parse(s.data) : null }, { 'Content-Disposition': 'attachment; filename="tendra-donnees.json"' });
  }));

  route('DELETE', '/api/account', authed(async (c) => {
    await cancelSubscription(c.user, env);
    await db.q('DELETE FROM users WHERE id=$1', [c.user.id]); // cascade : états, sessions, abonnements push
    send(c.res, 200, { ok: true }, { 'Set-Cookie': cookie('', 0) });
  }));

  function serveStatic(req, res, pathname) {
    let p = decodeURIComponent(pathname);
    if (p.endsWith('/')) p += 'index.html';
    let file = path.normalize(path.join(PUB, p));
    if (!file.startsWith(PUB)) return send(res, 403, 'forbidden');
    if (!fs.existsSync(file) || fs.statSync(file).isDirectory()) {
      if (path.extname(p)) return send(res, 404, 'not found');
      file = path.join(PUB, 'index.html'); // SPA
    }
    const ext = path.extname(file);
    const noCache = ['.html', '.webmanifest'].includes(ext) || file.endsWith('sw.js');
    res.writeHead(200, { 'Content-Type': MIME[ext] || 'application/octet-stream', 'Cache-Control': noCache ? 'no-cache' : 'public, max-age=3600' });
    fs.createReadStream(file).pipe(res);
  }

  const server = http.createServer(async (req, res) => {
    const url = new URL(req.url, BASE);
    const origin = req.headers.origin;
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('Referrer-Policy', 'strict-origin-when-cross-origin');
    res.setHeader('X-Frame-Options', 'DENY');
    res.setHeader('Content-Security-Policy', `default-src 'self'; script-src 'self' 'unsafe-inline'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; media-src 'self' blob: ${env.MEDIA_ORIGIN || ''}; connect-src 'self' ${BASE} ${env.API_ORIGIN || ''}; frame-ancestors 'none'; base-uri 'self'; form-action 'self'`);
    if (SECURE) res.setHeader('Strict-Transport-Security', 'max-age=31536000; includeSubDomains');
    if (origin && CORS.includes(origin)) {
      res.setHeader('Access-Control-Allow-Origin', origin);
      res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization, X-Client');
      res.setHeader('Access-Control-Allow-Methods', 'GET,POST,PUT,DELETE,OPTIONS');
      res.setHeader('Vary', 'Origin');
    }
    if (req.method === 'OPTIONS') return send(res, 204, '');
    try {
      if (!url.pathname.startsWith('/api/') && url.pathname !== '/healthz') {
        if (req.method !== 'GET' && req.method !== 'HEAD') return send(res, 405, 'method not allowed');
        return serveStatic(req, res, url.pathname);
      }
      // Protection CSRF : une requête qui modifie des données doit venir de notre domaine ou d'une appli native autorisée.
      if (req.method !== 'GET' && origin && !CORS.includes(origin) && new URL(origin).host !== new URL(BASE).host) return send(res, 403, { error: 'bad_origin' });
      const fn = routes[`${req.method} ${url.pathname}`];
      if (!fn) return send(res, 404, { error: 'not_found' });
      const raw = ['GET', 'DELETE'].includes(req.method) ? Buffer.alloc(0) : await readBody(req);
      let body = {};
      if (raw.length && !url.pathname.startsWith('/api/webhooks/stripe')) {
        try { body = JSON.parse(raw.toString('utf8')); } catch { return send(res, 400, { error: 'bad_json' }); }
      }
      const ip = (req.headers['x-forwarded-for'] || req.socket.remoteAddress || '').toString().split(',')[0].trim();
      await fn({ req, res, body, raw, ip, native: req.headers['x-client'] === 'native' });
    } catch (e) {
      console.error('[err]', req.method, url.pathname, e.message);
      if (!res.headersSent) send(res, e.status || 500, { error: e.status ? e.message : 'server_error' });
    }
  });

  const stopSched = startScheduler(db);
  return {
    server, db, base: BASE,
    listen: (port = Number(env.PORT) || 3000) => new Promise((r) => server.listen(port, '0.0.0.0', () => r(server.address().port))),
    close: async () => { stopSched(); await new Promise((r) => server.close(r)); await db.close(); },
  };
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const app = await createApp();
  const port = await app.listen();
  console.log(`Tendra écoute sur le port ${port} (${app.db.kind})`);
  for (const sig of ['SIGTERM', 'SIGINT']) process.on(sig, async () => { await app.close(); process.exit(0); });
}
