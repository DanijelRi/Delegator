// Stranica za osobu kojoj se delegira (bez računa): pristup daje tajni token iz poveznice /z/TOKEN.
// GET  /api/guest?t=TOKEN                 -> zadaci te osobe (otvoreni + gotovi zadnjih 14 dana), upute, prilozi
// GET  /api/guest?t=TOKEN&file=ID[&dl=1]  -> prilog zadatka ili upute te osobe
// POST /api/guest { t, op: 'status', task_id, status } | { t, op: 'comment', task_id, body }
// Osoba vidi i mijenja SAMO zadatke na koje je dodijeljena; vlasnik dobije javljanje i push obavijest.
import { sql, readBody, txt } from './_lib.js';
import { streamAttachment } from './_files.js';
import { pushToUser } from './_push.js';
import { spawnNext } from './data.js';

const fail = (status, error) => Object.assign(new Error(error), { status });
const STATUS = { todo: 'Za napraviti', doing: 'U tijeku', done: 'Gotovo' };

async function personFor(token) {
  if (!token || String(token).length < 20) throw fail(404, 'Poveznica ne vrijedi');
  const [p] = await sql`SELECT p.id, p.name, p.user_id, u.name AS owner_name FROM people p JOIN users u ON u.id = p.user_id
                        WHERE p.share_token = ${String(token)}`;
  if (!p) throw fail(404, 'Poveznica ne vrijedi ili je zamijenjena novom');
  return p;
}
// zadatak mora pripadati vlasniku osobe i osoba mora biti na njemu
async function taskFor(p, taskId) {
  const [k] = await sql`SELECT t.id, t.title, t.status, t.topic_id FROM tasks t JOIN task_people tp ON tp.task_id = t.id
                        WHERE t.id = ${Number(taskId)} AND t.user_id = ${p.user_id} AND tp.person_id = ${p.id}`;
  if (!k) throw fail(404, 'Zadatak nije pronađen');
  return k;
}

export default async function handler(req, res) {
  res.setHeader('Cache-Control', 'no-store');
  res.setHeader('X-Robots-Tag', 'noindex');
  try {
    const q = req.query || Object.fromEntries(new URL(req.url, 'http://x').searchParams);
    if (req.method === 'GET') {
      const p = await personFor(q.t);
      if (q.file) {
        // prilog zadatka ili prilog uputa (opće bilješke ili bilješke baš za ovu osobu)
        const [a] = await sql`SELECT a.* FROM attachments a
          LEFT JOIN notes n ON n.id = a.note_id
          JOIN task_people tp ON tp.task_id = COALESCE(a.task_id, n.task_id) AND tp.person_id = ${p.id}
          WHERE a.id = ${Number(q.file)} AND a.user_id = ${p.user_id}
            AND (a.task_id IS NOT NULL OR n.person_id IS NULL OR n.person_id = ${p.id})`;
        if (!a) throw fail(404, 'Prilog nije pronađen');
        return streamAttachment(res, a, q);
      }
      const tasks = await sql`
        SELECT t.id, t.topic_id, t.title, t.description, t.status, t.priority, t.repeat,
               to_char(t.due_date, 'YYYY-MM-DD') AS due_date, to_char(t.start_date, 'YYYY-MM-DD') AS start_date
        FROM tasks t JOIN task_people tp ON tp.task_id = t.id AND tp.person_id = ${p.id}
        WHERE t.user_id = ${p.user_id} AND (t.status <> 'done' OR t.completed_at > now() - interval '14 days')
        ORDER BY t.due_date NULLS LAST, t.id`;
      const ids = tasks.map((t) => t.id);
      const [topics, notes, files, subtasks] = await Promise.all([
        sql`SELECT id, parent_id, title, color FROM topics WHERE user_id = ${p.user_id}`,
        sql`SELECT id, task_id, person_id, body, from_person, created_at FROM notes
            WHERE task_id = ANY(${ids}::int[]) AND (person_id IS NULL OR person_id = ${p.id}) ORDER BY created_at`,
        sql`SELECT a.id, a.task_id, a.note_id, a.name, a.mime, a.size FROM attachments a LEFT JOIN notes n ON n.id = a.note_id
            WHERE a.user_id = ${p.user_id} AND (a.task_id = ANY(${ids}::int[])
              OR (n.task_id = ANY(${ids}::int[]) AND (n.person_id IS NULL OR n.person_id = ${p.id})))`,
        sql`SELECT id, task_id, title, done FROM subtasks WHERE task_id = ANY(${ids}::int[]) ORDER BY pos, id`,
      ]);
      const byId = Object.fromEntries(topics.map((t) => [t.id, t]));
      const path = (t, d = 0) => (t?.parent_id && byId[t.parent_id] && d < 20 ? path(byId[t.parent_id], d + 1) + ' › ' : '') + (t?.title || '');
      return res.status(200).json({
        person: { name: p.name }, owner: p.owner_name,
        tasks: tasks.map((t) => ({ ...t, topic: path(byId[t.topic_id]), color: byId[t.topic_id]?.color })),
        notes, files, subtasks,
      });
    }
    if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

    const b = readBody(req);
    const p = await personFor(b.t);
    const k = await taskFor(p, b.task_id);
    let line, title;
    if (b.op === 'status') {
      if (!STATUS[b.status]) throw fail(400, 'Nepoznat status');
      if (b.status === k.status) return res.status(200).json({ ok: true });
      await sql`UPDATE tasks SET status = ${b.status}, completed_at = ${b.status === 'done' ? new Date().toISOString() : null} WHERE id = ${k.id}`;
      line = b.status === 'done' ? '✓ Označio/la gotovim' : `↻ Status: ${STATUS[b.status]}`;
      if (b.status === 'done') await spawnNext(k.id, p.user_id); // zadatak koji se ponavlja dobije nasljednika
      title = `${p.name}: ${b.status === 'done' ? '✓ gotovo' : STATUS[b.status].toLowerCase()}`;
    } else if (b.op === 'sub') {
      const [st] = await sql`UPDATE subtasks SET done = ${!!b.done} WHERE id = ${Number(b.sub_id)} AND task_id = ${k.id} RETURNING title`;
      if (!st) throw fail(404, 'Korak nije pronađen');
      return res.status(200).json({ ok: true }); // kvačica na koraku: bez javljanja, vlasnik vidi napredak u zadatku
    } else if (b.op === 'comment') {
      const body = txt(b.body)?.slice(0, 2000);
      if (!body) throw fail(400, 'Upiši poruku');
      line = `💬 ${body}`;
      title = `💬 ${p.name}`;
    } else throw fail(400, 'Nepoznata operacija');
    // javljanje ostaje zapisano kao bilješka osobe, nepročitano dok ga vlasnik ne vidi
    await sql`INSERT INTO notes (user_id, task_id, person_id, body, from_person, seen) VALUES (${p.user_id}, ${k.id}, ${p.id}, ${line}, true, false)`;
    await pushToUser(p.user_id, { title, body: `${k.title}${b.op === 'comment' ? ' — ' + line.slice(2, 120) : ''}`, url: '/?v=overview', tag: `javljanje-${k.id}` })
      .catch((e) => console.error('Push', e.message));
    return res.status(200).json({ ok: true });
  } catch (e) {
    if (!e.status) console.error(e);
    return res.status(e.status || 500).json({ error: e.status ? e.message : 'Greška na poslužitelju' });
  }
}
