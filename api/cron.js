// Noćni/jutarnji posao (Vercel Cron, jednom dnevno — vidi vercel.json):
// 1) sigurnosna kopija baze u Blob, 2) jutarnji push sažetak rokova svakom korisniku koji je uključio obavijesti.
// Vercel šalje zaglavlje Authorization: Bearer <CRON_SECRET>; bez njega se ništa ne pokreće.
import { sql } from './_lib.js';
import { runBackup } from './_backup.js';
import { pushReady, pushToUser } from './_push.js';

async function morningPush() {
  if (!pushReady) return 0;
  const today = new Date().toLocaleDateString('sv-SE', { timeZone: 'Europe/Zagreb' });
  const rows = await sql`
    SELECT u.id,
      count(*) FILTER (WHERE t.due_date < ${today}::date) AS late,
      count(*) FILTER (WHERE t.due_date = ${today}::date) AS today,
      count(*) FILTER (WHERE t.due_date = ${today}::date + 1) AS tomorrow,
      (SELECT count(*) FROM notes n WHERE n.user_id = u.id AND n.from_person AND NOT n.seen) AS news,
      (array_agg(t.title ORDER BY t.priority = 'high' DESC, t.due_date) FILTER (WHERE t.due_date <= ${today}::date))[1] AS first
    FROM users u JOIN push_subs s ON s.user_id = u.id
    LEFT JOIN tasks t ON t.user_id = u.id AND t.status <> 'done' AND t.due_date IS NOT NULL
    GROUP BY u.id`;
  let sent = 0;
  for (const r of rows) {
    const [late, now, tom, news] = [r.late, r.today, r.tomorrow, r.news].map(Number);
    if (!late && !now && !tom && !news) continue; // ne budimo nikoga bez razloga
    const parts = [late && `${late} kasni`, now && `${now} danas`, tom && `${tom} sutra`, news && `${news} javljanja`].filter(Boolean);
    sent += await pushToUser(r.id, { title: `Dobro jutro ☀️ ${parts.join(' · ')}`, body: r.first ? `Prvo: ${r.first}` : 'Otvori Pregled za detalje.', url: '/?v=overview', tag: 'jutro' });
  }
  return sent;
}

export default async function handler(req, res) {
  if (!process.env.CRON_SECRET || req.headers.authorization !== `Bearer ${process.env.CRON_SECRET}`) {
    return res.status(401).json({ error: 'Nedopušteno' });
  }
  const out = {};
  try { out.backup = await runBackup(); } catch (e) { console.error('Kopija', e); out.backupError = e.message; }
  try { out.pushed = await morningPush(); } catch (e) { console.error('Push', e); out.pushError = e.message; }
  console.log('cron', JSON.stringify(out));
  return res.status(out.backupError ? 500 : 200).json(out);
}
