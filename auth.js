import crypto from 'node:crypto';
import { promisify } from 'node:util';

const scrypt = promisify(crypto.scrypt);
const N = 16384, R = 8, P = 1;

export const newToken = () => crypto.randomBytes(32).toString('base64url');
export const sha = (s) => crypto.createHash('sha256').update(s).digest('hex');
export const uid = () => crypto.randomUUID();

export async function hashPw(pw) {
  const salt = crypto.randomBytes(16);
  const h = await scrypt(pw, salt, 64, { N, r: R, p: P });
  return `scrypt$${N}$${R}$${P}$${salt.toString('hex')}$${h.toString('hex')}`;
}

export async function checkPw(pw, stored) {
  try {
    const [alg, n, r, p, salt, hash] = String(stored).split('$');
    if (alg !== 'scrypt') return false;
    const h = await scrypt(pw, Buffer.from(salt, 'hex'), 64, { N: +n, r: +r, p: +p });
    const exp = Buffer.from(hash, 'hex');
    return h.length === exp.length && crypto.timingSafeEqual(h, exp);
  } catch {
    return false;
  }
}

export const validEmail = (e) => typeof e === 'string' && e.length <= 254 && /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(e);
export const validPw = (p) => typeof p === 'string' && p.length >= 8 && p.length <= 200;

// Limiteur très simple en mémoire (suffisant pour la bêta ; passer à Redis en production multi-instances).
const hits = new Map();
export function limited(key, max = 20, windowMs = 10 * 60 * 1000) {
  const now = Date.now();
  const arr = (hits.get(key) || []).filter((t) => now - t < windowMs);
  arr.push(now);
  hits.set(key, arr);
  if (hits.size > 5000) for (const [k, v] of hits) if (!v.some((t) => now - t < windowMs)) hits.delete(k);
  return arr.length > max;
}
