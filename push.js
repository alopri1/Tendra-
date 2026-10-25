// Notifications push web (VAPID) : rappel quotidien. Nécessite le paquet « web-push » et les clés VAPID.
import { uid } from './auth.js';

let wp = null, PUBLIC = null;

export async function initPush(env = process.env) {
  if (!env.VAPID_PUBLIC || !env.VAPID_PRIVATE) return false;
  try {
    wp = (await import('web-push')).default;
    wp.setVapidDetails(env.VAPID_SUBJECT || 'mailto:contact@example.com', env.VAPID_PUBLIC, env.VAPID_PRIVATE);
    PUBLIC = env.VAPID_PUBLIC;
    return true;
  } catch (e) {
    console.warn('[push] web-push indisponible :', e.message);
    return false;
  }
}
export const pushKey = () => PUBLIC;

export async function saveSub(db, userId, sub) {
  if (!sub || !sub.endpoint || !sub.keys?.p256dh || !sub.keys?.auth) return false;
  await db.q('DELETE FROM push_subs WHERE endpoint=$1', [sub.endpoint]);
  await db.q('INSERT INTO push_subs(id,user_id,endpoint,p256dh,auth) VALUES($1,$2,$3,$4,$5)', [uid(), userId, sub.endpoint, sub.keys.p256dh, sub.keys.auth]);
  return true;
}

export function localNow(tz, date = new Date()) {
  const f = new Intl.DateTimeFormat('en-CA', { timeZone: tz, hour12: false, year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' });
  const p = Object.fromEntries(f.formatToParts(date).map((x) => [x.type, x.value]));
  const hh = p.hour === '24' ? '00' : p.hour;
  return { day: `${p.year}-${p.month}-${p.day}`, hm: `${hh}:${p.minute}`, minutes: Number(hh) * 60 + Number(p.minute) };
}

export async function sendToUser(db, userId, payload) {
  if (!wp) return 0;
  const subs = await db.q('SELECT * FROM push_subs WHERE user_id=$1', [userId]);
  let n = 0;
  for (const s of subs) {
    try {
      await wp.sendNotification({ endpoint: s.endpoint, keys: { p256dh: s.p256dh, auth: s.auth } }, JSON.stringify(payload));
      n++;
    } catch (e) {
      if (e.statusCode === 404 || e.statusCode === 410) await db.q('DELETE FROM push_subs WHERE id=$1', [s.id]);
    }
  }
  return n;
}

// Toutes les minutes : envoie le rappel du jour (une seule fois) dès que l'heure choisie est passée (dans les 3 h).
export async function tickReminders(db, now = new Date()) {
  const users = await db.q('SELECT id,remind_time,tz,last_push_day FROM users WHERE remind_on=1');
  let sent = 0;
  for (const u of users) {
    let ln;
    try { ln = localNow(u.tz, now); } catch { continue; }
    if (u.last_push_day === ln.day) continue;
    const [h, m] = String(u.remind_time).split(':').map(Number);
    const diff = ln.minutes - (h * 60 + m);
    if (diff < 0 || diff > 180) continue;
    const n = await sendToUser(db, u.id, { title: 'Tendra', body: 'C’est l’heure de ta séance.' });
    await db.q('UPDATE users SET last_push_day=$1 WHERE id=$2', [ln.day, u.id]);
    sent += n;
  }
  return sent;
}

export function startScheduler(db, every = 60000) {
  const t = setInterval(() => tickReminders(db).catch((e) => console.warn('[push]', e.message)), every);
  t.unref?.();
  return () => clearInterval(t);
}
