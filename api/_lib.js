// Zajednički dijelovi API-ja: baza, lozinke, sesije (kolačić), čitanje tijela zahtjeva.
// Datoteka počinje s "_" pa je Vercel ne objavljuje kao zasebnu funkciju.
import { neon } from '@neondatabase/serverless';
import { randomBytes, scrypt as scryptCb, timingSafeEqual, createHash } from 'node:crypto';
import { promisify } from 'node:util';

export const sql = neon(process.env.DATABASE_URL);
const scrypt = promisify(scryptCb);

export const SESSION_DAYS = 60;
const COOKIE = 'sid';

export const newToken = () => randomBytes(32).toString('base64url');
export const hashToken = (t) => createHash('sha256').update(String(t)).digest('hex');

export async function hashPassword(pw) {
  const salt = randomBytes(16);
  const key = await scrypt(String(pw), salt, 64);
  return `scrypt$${salt.toString('base64')}$${key.toString('base64')}`;
}

export async function checkPassword(pw, stored) {
  const [alg, salt, key] = String(stored || '').split('$');
  if (alg !== 'scrypt' || !salt || !key) return false;
  const expected = Buffer.from(key, 'base64');
  const actual = await scrypt(String(pw), Buffer.from(salt, 'base64'), expected.length);
  return timingSafeEqual(expected, actual);
}

function readCookie(req, name) {
  const raw = req.headers.cookie || '';
  for (const part of raw.split(';')) {
    const i = part.indexOf('=');
    if (i > 0 && part.slice(0, i).trim() === name) return decodeURIComponent(part.slice(i + 1).trim());
  }
  return null;
}

// Na localhostu (http) kolačić ne smije biti "Secure", inače ga preglednik ne sprema.
const isLocal = (req) => /^(localhost|127\.0\.0\.1)(:\d+)?$/.test(req.headers.host || '');

export async function startSession(req, res, userId) {
  const token = newToken();
  await sql`INSERT INTO sessions (token_hash, user_id, expires_at)
            VALUES (${hashToken(token)}, ${userId}, now() + make_interval(days => ${SESSION_DAYS}))`;
  res.setHeader('Set-Cookie', `${COOKIE}=${token}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${SESSION_DAYS * 86400}${isLocal(req) ? '' : '; Secure'}`);
}

export async function endSession(req, res) {
  const token = readCookie(req, COOKIE);
  if (token) await sql`DELETE FROM sessions WHERE token_hash = ${hashToken(token)}`;
  res.setHeader('Set-Cookie', `${COOKIE}=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0${isLocal(req) ? '' : '; Secure'}`);
}

// Vrati prijavljenog korisnika {id, email, name, is_admin} ili null.
export async function currentUser(req) {
  const token = readCookie(req, COOKIE);
  if (!token) return null;
  const [u] = await sql`SELECT u.id, u.email, u.name, u.is_admin, u.onboarded
                        FROM sessions s JOIN users u ON u.id = s.user_id
                        WHERE s.token_hash = ${hashToken(token)} AND s.expires_at > now()`;
  return u || null;
}

// Tijelo POST zahtjeva. Prihvaćamo samo JSON (uz SameSite kolačić to štiti od CSRF-a).
export function readBody(req) {
  if (req.method !== 'POST') return {};
  if (!String(req.headers['content-type'] || '').includes('application/json')) {
    const err = new Error('Očekujem JSON'); err.status = 415; throw err;
  }
  return typeof req.body === 'string' ? JSON.parse(req.body || '{}') : req.body || {};
}

export const txt = (v) => (v == null || String(v).trim() === '' ? null : String(v).trim());

// Današnji datum u Hrvatskoj kao YYYY-MM-DD.
export const todayZagreb = () => new Date().toLocaleDateString('sv-SE', { timeZone: 'Europe/Zagreb' });
