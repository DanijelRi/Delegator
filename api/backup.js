// Sigurnosne kopije za administratora (kartica „Korisnici“).
// GET  /api/backup              -> popis kopija
// GET  /api/backup?file=NAZIV   -> preuzimanje kopije (JSON)
// POST /api/backup              -> napravi kopiju odmah
import { get } from '@vercel/blob';
import { Readable } from 'node:stream';
import { currentUser } from './_lib.js';
import { runBackup, listBackups, BACKUP_DAYS } from './_backup.js';

export default async function handler(req, res) {
  res.setHeader('Cache-Control', 'no-store');
  try {
    const me = await currentUser(req);
    if (!me) return res.status(401).json({ error: 'Prijavi se' });
    if (!me.is_admin) return res.status(403).json({ error: 'Samo za administratora' });
    const q = req.query || Object.fromEntries(new URL(req.url, 'http://x').searchParams);
    if (req.method === 'POST') {
      if (!String(req.headers['content-type'] || '').includes('application/json')) return res.status(415).json({ error: 'Očekujem JSON' });
      return res.status(200).json({ ok: true, ...(await runBackup()) });
    }
    if (q.file) {
      if (!/^delegator-\d{4}-\d{2}-\d{2}\.json$/.test(q.file)) return res.status(400).json({ error: 'Neispravan naziv' });
      const r = await get(`backups/${q.file}`, { access: 'private' });
      if (!r || r.statusCode !== 200) return res.status(404).json({ error: 'Kopija nije pronađena' });
      res.setHeader('Content-Type', 'application/json');
      res.setHeader('Content-Disposition', `attachment; filename="${q.file}"`);
      res.statusCode = 200;
      return Readable.fromWeb(r.stream).pipe(res);
    }
    return res.status(200).json({ backups: await listBackups(), days: BACKUP_DAYS });
  } catch (e) {
    console.error(e);
    return res.status(500).json({ error: 'Greška pri radu s kopijama' });
  }
}
