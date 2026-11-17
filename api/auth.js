// Prijava, registracija na pozivnicu, nova lozinka i administracija korisnika.
// GET  /api/auth              -> {user, setup}  (setup = još nema nijednog korisnika)
// POST /api/auth {op, ...}    -> vidi objekt ops
import { sql, hashPassword, checkPassword, startSession, endSession, currentUser,
  readBody, newToken, hashToken, txt } from './_lib.js';

const INVITE_DAYS = 7;
const RESET_HOURS = 24;
const MIN_PW = 8;

const fail = (status, error) => Object.assign(new Error(error), { status });
const pause = (ms) => new Promise((r) => setTimeout(r, ms));

function checkNewPassword(pw) {
  if (String(pw || '').length < MIN_PW) throw fail(400, `Lozinka mora imati barem ${MIN_PW} znakova`);
}
function checkEmail(email) {
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email || '')) throw fail(400, 'Upiši ispravnu e-mail adresu');
}

async function findToken(token, kind) {
  if (!token) return null;
  const [row] = await sql`SELECT i.token_hash, i.kind, i.note, i.user_id, u.name, u.email
    FROM invites i LEFT JOIN users u ON u.id = i.user_id
    WHERE i.token_hash = ${hashToken(token)} AND i.kind = ${kind} AND i.used_at IS NULL AND i.expires_at > now()`;
  return row || null;
}

const userCount = async () => (await sql`SELECT count(*)::int AS n FROM users`)[0].n;

const ops = {
  // --- bez prijave ---
  async login(b, req, res) {
    const email = txt(b.email)?.toLowerCase();
    const [u] = email ? await sql`SELECT id, password_hash FROM users WHERE lower(email) = ${email}` : [];
    if (!u || !(await checkPassword(b.password, u.password_hash))) {
      await pause(600); // usporava pogađanje lozinki
      throw fail(401, 'Pogrešan e-mail ili lozinka');
    }
    await startSession(req, res, u.id);
  },

  async logout(b, req, res) {
    await endSession(req, res);
  },

  // Što je u poveznici (?pozivnica= ili ?reset=) — da sučelje zna što prikazati.
  async tokenInfo(b) {
    const row = await findToken(b.token, b.kind === 'reset' ? 'reset' : 'invite');
    return row ? { valid: true, note: row.note, name: row.name, email: row.email } : { valid: false };
  },

  // Registracija. Prvi korisnik umjesto pozivnice upisuje APP_PASSWORD i postaje administrator.
  async signup(b, req, res) {
    const name = txt(b.name), email = txt(b.email)?.toLowerCase();
    if (!name) throw fail(400, 'Upiši ime');
    checkEmail(email);
    checkNewPassword(b.password);

    const first = (await userCount()) === 0;
    let invite = null;
    if (first) {
      if (!process.env.APP_PASSWORD || b.invite !== process.env.APP_PASSWORD) throw fail(403, 'Pogrešan kod za prvo postavljanje');
    } else {
      invite = await findToken(b.invite, 'invite');
      if (!invite) throw fail(403, 'Pozivnica ne vrijedi ili je već iskorištena');
    }
    const [exists] = await sql`SELECT 1 FROM users WHERE lower(email) = ${email}`;
    if (exists) throw fail(409, 'Korisnik s tim e-mailom već postoji — prijavi se');

    const [u] = await sql`INSERT INTO users (email, name, password_hash, is_admin)
                          VALUES (${email}, ${name}, ${await hashPassword(b.password)}, ${first}) RETURNING id`;
    if (invite) await sql`UPDATE invites SET used_by = ${u.id}, used_at = now() WHERE token_hash = ${invite.token_hash}`;
    // Prvi korisnik preuzima podatke unesene prije uvođenja korisničkih računa.
    if (first) await sql.transaction([
      sql`UPDATE people SET user_id = ${u.id} WHERE user_id IS NULL`,
      sql`UPDATE topics SET user_id = ${u.id} WHERE user_id IS NULL`,
      sql`UPDATE tasks  SET user_id = ${u.id} WHERE user_id IS NULL`,
      sql`UPDATE notes  SET user_id = ${u.id} WHERE user_id IS NULL`,
    ]);
    await startSession(req, res, u.id);
  },

  // Nova lozinka preko poveznice koju je napravio administrator.
  async resetPassword(b, req, res) {
    checkNewPassword(b.password);
    const row = await findToken(b.token, 'reset');
    if (!row) throw fail(403, 'Poveznica ne vrijedi ili je već iskorištena');
    await sql.transaction([
      sql`UPDATE users SET password_hash = ${await hashPassword(b.password)} WHERE id = ${row.user_id}`,
      sql`DELETE FROM sessions WHERE user_id = ${row.user_id}`,
      sql`UPDATE invites SET used_by = ${row.user_id}, used_at = now() WHERE token_hash = ${row.token_hash}`,
    ]);
    await startSession(req, res, row.user_id);
  },

  // --- prijavljeni korisnik ---
  async changePassword(b, req, res, me) {
    const [u] = await sql`SELECT password_hash FROM users WHERE id = ${me.id}`;
    if (!(await checkPassword(b.old_password, u.password_hash))) throw fail(400, 'Trenutna lozinka nije točna');
    checkNewPassword(b.password);
    await sql`UPDATE users SET password_hash = ${await hashPassword(b.password)} WHERE id = ${me.id}`;
  },

  // --- administrator ---
  async listUsers(b, req, res, me) {
    const [users, invites] = await Promise.all([
      sql`SELECT u.id, u.email, u.name, u.is_admin, u.created_at,
                 (SELECT count(*)::int FROM tasks t WHERE t.user_id = u.id) AS tasks
          FROM users u ORDER BY u.created_at`,
      sql`SELECT i.kind, i.note, i.expires_at, i.created_at, u.name AS for_name
          FROM invites i LEFT JOIN users u ON u.id = i.user_id
          WHERE i.used_at IS NULL AND i.expires_at > now() ORDER BY i.created_at DESC`,
    ]);
    return { users, invites };
  },

  async createInvite(b, req, res, me) {
    const token = newToken();
    await sql`INSERT INTO invites (token_hash, kind, note, created_by, expires_at)
              VALUES (${hashToken(token)}, 'invite', ${txt(b.note)}, ${me.id}, now() + make_interval(days => ${INVITE_DAYS}))`;
    return { token, days: INVITE_DAYS };
  },

  async createReset(b, req, res, me) {
    const [u] = await sql`SELECT id FROM users WHERE id = ${Number(b.user_id)}`;
    if (!u) throw fail(404, 'Nema tog korisnika');
    const token = newToken();
    await sql`INSERT INTO invites (token_hash, kind, user_id, created_by, expires_at)
              VALUES (${hashToken(token)}, 'reset', ${u.id}, ${me.id}, now() + make_interval(hours => ${RESET_HOURS}))`;
    return { token, hours: RESET_HOURS };
  },

  // Briše korisnika i SVE njegove podatke (teme, zadatke, ljude, bilješke).
  async deleteUser(b, req, res, me) {
    if (Number(b.user_id) === me.id) throw fail(400, 'Ne možeš obrisati sam sebe');
    await sql`DELETE FROM users WHERE id = ${Number(b.user_id)}`;
  },
};

const PUBLIC = new Set(['login', 'logout', 'tokenInfo', 'signup', 'resetPassword']);
const ADMIN = new Set(['listUsers', 'createInvite', 'createReset', 'deleteUser']);

export default async function handler(req, res) {
  res.setHeader('Cache-Control', 'no-store');
  try {
    if (req.method === 'GET') {
      const user = await currentUser(req);
      return res.status(200).json({ user, setup: !user && (await userCount()) === 0 });
    }
    if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

    const b = readBody(req);
    const fn = ops[b.op];
    if (!fn) return res.status(400).json({ error: `Nepoznata operacija: ${b.op}` });

    let me = null;
    if (!PUBLIC.has(b.op)) {
      me = await currentUser(req);
      if (!me) return res.status(401).json({ error: 'Prijavi se' });
      if (ADMIN.has(b.op) && !me.is_admin) return res.status(403).json({ error: 'Samo za administratora' });
    }
    const result = (await fn(b, req, res, me)) || {};
    return res.status(200).json({ ok: true, ...result });
  } catch (e) {
    if (!e.status) console.error(e);
    return res.status(e.status || 500).json({ error: e.status ? e.message : 'Greška na poslužitelju' });
  }
}
