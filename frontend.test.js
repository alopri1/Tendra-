// Test d'intégration : l'application (public/index.html) face au vrai serveur, avec un navigateur simulé.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createApp } from '../server/index.js';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const html = fs.readFileSync(path.join(HERE, '..', 'public', 'index.html'), 'utf8');
const js = html.split('<script>').pop().split('</script>')[0].replace(/^(const|let) /gm, 'var ').replace(/\nboot\(\);\s*$/, '\n');

let app, base, A; // A = environnement de l'appli simulée
const realFetch = globalThis.fetch;
const ls = new Map();
const appEl = { innerHTML: '', appendChild() {} };
const jar = new Map();
const log = [];

before(async () => {
  app = await createApp({ SQLITE_FILE: ':memory:', BASE_URL: 'http://localhost:0' });
  const port = await app.listen(0);
  base = `http://127.0.0.1:${port}`;
  globalThis.window = { scrollTo() {}, matchMedia: () => ({ matches: false }), TENDRA_API: '' };
  globalThis.document = { querySelector: () => appEl, createElement: () => ({ getContext: () => ({}), setAttribute() {}, style: {}, addEventListener() {}, click() {}, remove() {} }), body: { appendChild() {} } };
  globalThis.localStorage = { getItem: (k) => (ls.has(k) ? ls.get(k) : null), setItem: (k, v) => ls.set(k, String(v)), removeItem: (k) => ls.delete(k) };
  globalThis.location = { search: '', pathname: '/', href: '/' };
  globalThis.history = { replaceState() {} };
  globalThis.confirm = () => true;
  globalThis.requestAnimationFrame = () => {};
  globalThis.getComputedStyle = () => ({ getPropertyValue: () => '' });
  globalThis.fetch = async (url, opts = {}) => {
    const u = String(url).startsWith('/') ? base + url : url;
    const h = { ...(opts.headers || {}) };
    if (jar.size) h.Cookie = [...jar].map(([k, v]) => `${k}=${v}`).join('; ');
    const r = await realFetch(u, { ...opts, headers: h });
    for (const c of r.headers.getSetCookie?.() || []) { const [kv] = c.split(';'); const [k, v] = kv.split('='); if (v) jar.set(k, v); else jar.delete(k); }
    return r;
  };
  const origLog = console.log; console.log = (...a) => log.push(a.join(' '));
  A = new Function(`${js}\n return {get S(){return S},get ME(){return ME},get ENT(){return ENT},get F(){return F},boot,render,signup,login,logout,delAcc,forgot,doReset,mkProfile,go,startSession,step,endSet,rate,items,V,streak,refreshEnt,checkout,tg,pick,save,get G(){return G},set rem(v){S.rem=v},cyc,get SYNC(){return SYNC}};`)();
  console.log = origLog;
});
after(async () => { globalThis.fetch = realFetch; await app.close(); });

const wait = (ms) => new Promise((r) => setTimeout(r, ms));

test('démarrage hors connexion : écran d\'accueil', async () => {
  await A.boot();
  assert.equal(A.S.screen, 'welcome');
  assert.match(appEl.innerHTML, /Créer mon compte/);
  assert.match(appEl.innerHTML, /J’ai déjà un compte/);
});

test('inscription réelle puis questionnaire et profil', async () => {
  A.go('signup');
  A.F.name = 'Léa'; A.F.email = 'lea@exemple.fr'; A.F.pw = 'motdepasse1'; A.F.c1 = true; A.F.c2 = true;
  await A.signup();
  assert.equal(A.ME.email, 'lea@exemple.fr');
  assert.equal(A.S.screen, 'safety');
  assert.equal(A.ENT.status, 'trial');
  A.F.tendon = 'achille'; A.F.obj = ['ren', 'perf']; A.F.lvl = 'conf'; A.F.age = '28'; A.F.sp = true; A.F.sport = 'Sprint';
  A.mkProfile();
  assert.equal(A.S.screen, 'plan');
  assert.equal(A.S.profile.tendon, 'achille');
  assert.match(appEl.innerHTML, /Ton plan sur 6 semaines/);
});

test('l\'état est sauvegardé sur le serveur', async () => {
  await wait(1800);
  const r = await realFetch(base + '/api/state', { headers: { Cookie: [...jar].map(([k, v]) => `${k}=${v}`).join('; ') } });
  const j = await r.json();
  assert.equal(j.state.profile.tendon, 'achille');
  assert.equal(A.SYNC, 'cloud');
});

test('séance guidée complète puis difficulté', async () => {
  A.go('home');
  A.S.logs.push({ d: 0, sleep: 2, energy: 2, mood: 2 });
  assert.match(appEl.innerHTML, /Programme du jour|Check-in/);
  A.startSession();
  let g = 0;
  while (A.G.on && g < 400000) { g++; if (A.G.ph === 'ready') { A.G.ph = 'work'; A.G.el = 0; A.G.reps = 0; } if (A.G.ph === 'work' && A.G.it[A.G.i].mode === 'dist' && A.G.el > 5000) A.endSet(); A.step(100); }
  assert.equal(A.G.on, false);
  assert.match(appEl.innerHTML, /Séance terminée/);
  A.rate(7);
  assert.equal(A.S.day, 1);
  assert.ok(A.streak() >= 1);
});

test('déconnexion puis reconnexion : le programme est retrouvé', async () => {
  await wait(1800);
  await A.logout();
  assert.equal(A.ME, null);
  assert.equal(A.S.screen, 'welcome');
  assert.equal(A.S.profile, null);
  A.go('login');
  A.F.email = 'lea@exemple.fr'; A.F.pw = 'mauvais';
  await A.login();
  assert.match(A.F.err, /incorrect/);
  A.F.pw = 'motdepasse1';
  await A.login();
  assert.equal(A.S.screen, 'home');
  assert.equal(A.S.profile.tendon, 'achille');
  assert.equal(A.S.day, 1);
});

test('programme sans fin : cycle suivant après 42 jours', () => {
  const week5 = A.items(28).map((x) => x[0]).join('|');
  A.S.day = 42;
  const next = A.items(42), next0 = A.items(0);
  assert.ok(next.length >= 2);
  assert.deepEqual(next.map((x) => x[0]), next0.map((x) => x[0]).length ? next.map((x) => x[0]) : []);
  A.S.logs.push({ d: 42, sleep: 2, energy: 2, mood: 2 });
  A.S.maxes = { 'Squat lesté lourd': 100 };
  A.go('home');
  assert.match(appEl.innerHTML, /Nouveau cycle 2/);
  A.cyc(true);
  assert.equal(A.S.maxes['Squat lesté lourd'], 105);
  assert.doesNotMatch(appEl.innerHTML, /Nouveau cycle 2/);
  assert.ok(week5.length > 0);
});

test('essai terminé : écran d\'abonnement et paiement non configuré', async () => {
  await app.db.q("UPDATE users SET trial_end=1 WHERE email='lea@exemple.fr'");
  await A.refreshEnt();
  A.S.day = 3;
  A.go('home');
  assert.equal(A.S.screen, 'paywall');
  assert.match(appEl.innerHTML, /Ton essai gratuit est terminé/);
  assert.match(appEl.innerHTML, /49,99/);
  await A.checkout();
  assert.match(A.F.err, /pas encore activé/);
});

test('mot de passe oublié puis nouveau mot de passe', async () => {
  const origLog = console.log; const lines = []; console.log = (...a) => lines.push(a.join(' '));
  A.go('forgot'); A.F.email = 'lea@exemple.fr';
  await A.forgot();
  await wait(60); console.log = origLog;
  assert.equal(A.F.sent, true);
  const tok = lines.join('\n').match(/\?reset=([\w-]+)/)[1];
  A.F.rtoken = tok; A.F.pw = 'nouveaumdp99';
  await A.doReset();
  assert.equal(A.S.screen, 'login');
  A.F.email = 'lea@exemple.fr'; A.F.pw = 'nouveaumdp99';
  await A.login();
  assert.equal(A.ME.email, 'lea@exemple.fr');
});

test('suppression du compte depuis l\'appli', async () => {
  await A.delAcc();
  assert.equal(A.ME, null);
  assert.equal(A.S.screen, 'welcome');
  assert.equal((await app.db.q('SELECT id FROM users')).length, 0);
});
