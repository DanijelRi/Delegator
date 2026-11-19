// Push obavijesti za prijavljenog korisnika.
// GET  /api/push                          -> { publicKey, devices }
// POST /api/push { op: 'subscribe', sub } | { op: 'unsubscribe', endpoint } | { op: 'test' }
import { sql, currentUser, readBody } from './_lib.js';
import { pushReady, vapidPublicKey, pushToUser } from './_push.js';

export default async function handler(req, res) {
  res.setHeader('Cache-Control', 'no-store');
  try {
    const me = await currentUser(req);
    if (!me) return res.status(401).json({ error: 'Prijavi se' });
    if (!pushReady) return res.status(503).json({ error: 'Obavijesti još nisu podešene na poslužitelju' });
    if (req.method === 'GET') {
      const [{ n }] = await sql`SELECT count(*)::int AS n FROM push_subs WHERE user_id = ${me.id}`;
      return res.status(200).json({ publicKey: vapidPublicKey, devices: n });
    }
    const b = readBody(req);
    if (b.op === 'subscribe') {
      const s = b.sub || {};
      if (!/^https:\/\//.test(s.endpoint || '') || !s.keys?.p256dh || !s.keys?.auth) return res.status(400).json({ error: 'Neispravna pretplata' });
      await sql`INSERT INTO push_subs (user_id, endpoint, p256dh, auth) VALUES (${me.id}, ${s.endpoint}, ${s.keys.p256dh}, ${s.keys.auth})
                ON CONFLICT (endpoint) DO UPDATE SET user_id = EXCLUDED.user_id, p256dh = EXCLUDED.p256dh, auth = EXCLUDED.auth`;
      return res.status(200).json({ ok: true });
    }
    if (b.op === 'unsubscribe') {
      await sql`DELETE FROM push_subs WHERE user_id = ${me.id} AND endpoint = ${String(b.endpoint || '')}`;
      return res.status(200).json({ ok: true });
    }
    if (b.op === 'test') {
      const n = await pushToUser(me.id, { title: 'Delegator 🔔', body: 'Obavijesti rade! Svako jutro stiže sažetak rokova.', url: '/?v=overview', tag: 'test' });
      return res.status(200).json({ ok: true, sent: n });
    }
    return res.status(400).json({ error: 'Nepoznata operacija' });
  } catch (e) {
    console.error(e);
    return res.status(e.status || 500).json({ error: e.status ? e.message : 'Greška pri obavijestima' });
  }
}
