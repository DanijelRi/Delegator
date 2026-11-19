// Jedan endpoint za podatke prijavljenog korisnika.
// GET  /api/data            -> vraća sve podatke korisnika
// POST /api/data {op, ...}  -> izvrši operaciju i vrati sve podatke
// Svaki upit je ograničen na user_id prijavljenog korisnika — nitko ne vidi tuđe podatke.
import { del } from '@vercel/blob';
import { randomBytes } from 'node:crypto';
import { sql, currentUser, readBody, txt } from './_lib.js';

// Osoba „Ja“ (sam korisnik) — napravi je ako je još nema.
const ME = 'Ja';
const ensureMe = (uid) => sql`INSERT INTO people (user_id, name, is_me) VALUES (${uid}, ${ME}, true)
                               ON CONFLICT (user_id) WHERE is_me DO NOTHING`;

async function loadAll(uid) {
  let data = await loadRows(uid);
  if (!data.people.some((p) => p.is_me)) { await ensureMe(uid); data = await loadRows(uid); }
  return data;
}

async function loadRows(uid) {
  const [people, topics, tasks, notes, pnotes, attachments, subtasks, templates] = await Promise.all([
    sql`SELECT id, name, role, email, is_demo, is_me FROM people WHERE user_id = ${uid} ORDER BY is_me DESC, name`,
    sql`SELECT id, parent_id, title, description, color, archived, is_demo FROM topics WHERE user_id = ${uid} ORDER BY archived, created_at`,
    sql`SELECT t.id, t.topic_id, t.title, t.description, t.status, t.priority,
               to_char(t.due_date, 'YYYY-MM-DD') AS due_date, to_char(t.start_date, 'YYYY-MM-DD') AS start_date,
               t.repeat, t.created_at, t.completed_at,
               COALESCE(array_agg(tp.person_id) FILTER (WHERE tp.person_id IS NOT NULL), '{}') AS people
        FROM tasks t LEFT JOIN task_people tp ON tp.task_id = t.id
        WHERE t.user_id = ${uid}
        GROUP BY t.id ORDER BY t.created_at`,
    sql`SELECT id, task_id, person_id, body, from_person, seen, created_at FROM notes WHERE user_id = ${uid} ORDER BY created_at`,
    sql`SELECT id, title, body, color, pinned, is_demo, created_at, updated_at FROM pnotes WHERE user_id = ${uid} ORDER BY pinned DESC, updated_at DESC`,
    sql`SELECT id, task_id, note_id, topic_id, pnote_id, name, mime, size, created_at FROM attachments WHERE user_id = ${uid} ORDER BY created_at`,
    sql`SELECT id, task_id, title, done, pos FROM subtasks WHERE user_id = ${uid} ORDER BY pos, id`,
    sql`SELECT id, name, created_at, jsonb_array_length(data->'tasks') AS task_count, jsonb_array_length(data->'topics') AS topic_count
        FROM templates WHERE user_id = ${uid} ORDER BY name`,
  ]);
  return { people, topics, tasks, notes, pnotes, attachments, subtasks, templates };
}

const ids = (a) => (Array.isArray(a) ? a.map(Number).filter(Number.isInteger) : []);
const email = (v) => {
  const e = txt(v);
  if (e && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(e)) throw Object.assign(new Error('Neispravna e-mail adresa'), { status: 400 });
  return e;
};
const day = (v) => (/^\d{4}-\d{2}-\d{2}$/.test(v || '') ? v : null);
const REPEATS = ['daily', 'weekly', 'biweekly', 'monthly', 'yearly'];
const repeatOf = (v) => (REPEATS.includes(v) ? v : null);
// Početak ne smije biti iza roka; bez roka početak nema smisla.
const span = (b) => {
  const due = day(b.due_date);
  let start = due ? day(b.start_date) : null;
  if (start && start >= due) start = null;
  return { due, start };
};

// ---- ponavljanje: sljedeći rok ----
const todayZg = () => new Date().toLocaleDateString('sv-SE', { timeZone: 'Europe/Zagreb' });
// n-ti termin od izvornog datuma (uvijek od izvornika, da 31. u mjesecu ne "klizi" na 28.)
function addPeriod(iso, repeat, n = 1) {
  const [y, m, d] = iso.split('-').map(Number);
  const days = { daily: 1, weekly: 7, biweekly: 14 }[repeat];
  if (days) return new Date(Date.UTC(y, m - 1, d + days * n)).toISOString().slice(0, 10);
  const months = (m - 1) + (repeat === 'yearly' ? 12 * n : n);
  const ny = y + Math.floor(months / 12), nm = months % 12;
  const last = new Date(Date.UTC(ny, nm + 1, 0)).getUTCDate();
  return `${ny}-${String(nm + 1).padStart(2, '0')}-${String(Math.min(d, last)).padStart(2, '0')}`;
}
const daysBetween = (a, b) => Math.round((Date.parse(b) - Date.parse(a)) / 864e5);
// Zadatak koji se ponavlja upravo je završen: napravi sljedeći (isti ljudi, tema, opis), bez bilježaka.
export async function spawnNext(id, uid) {
  const [k] = await sql`SELECT id, topic_id, title, description, priority, repeat,
      to_char(due_date, 'YYYY-MM-DD') AS due, to_char(start_date, 'YYYY-MM-DD') AS start
    FROM tasks WHERE id = ${id} AND user_id = ${uid}`;
  if (!k?.repeat) return null;
  const today = todayZg();
  let n = 1, due = addPeriod(k.due || today, k.repeat, n);
  while (due <= today && n < 5000) due = addPeriod(k.due || today, k.repeat, ++n); // preskoči propuštene termine
  const start = k.start && k.due ? new Date(Date.parse(k.start) + daysBetween(k.due, due) * 864e5).toISOString().slice(0, 10) : null;
  const [created] = await sql`
    WITH t AS (
      INSERT INTO tasks (user_id, topic_id, title, description, priority, start_date, due_date, repeat)
      VALUES (${uid}, ${k.topic_id}, ${k.title}, ${k.description}, ${k.priority}, ${start}, ${due}, ${k.repeat}) RETURNING id),
    tp AS (INSERT INTO task_people (task_id, person_id) SELECT t.id, person_id FROM t, task_people WHERE task_id = ${k.id})
    SELECT id FROM t`;
  await sql`INSERT INTO subtasks (user_id, task_id, title, pos) SELECT ${uid}, ${created.id}, title, pos FROM subtasks WHERE task_id = ${k.id}`;
  await sql`UPDATE tasks SET repeat = NULL WHERE id = ${k.id}`; // ponavljanje prelazi na novi zadatak
  return { next_id: created.id, next_due: due };
}

// Prije brisanja retka uzmi adrese njegovih priloga, a nakon brisanja obriši i same datoteke iz Bloba.
async function purge(rows) {
  const urls = rows.flatMap((r) => [r.blob_url, r.thumb_url]).filter(Boolean);
  if (urls.length) await del(urls).catch((e) => console.error('Blob del', e.message));
}

// ---- probni podaci za dobrodošlicu ----
const dayFromToday = (n) => { const d = new Date(todayZg() + 'T12:00:00Z'); d.setUTCDate(d.getUTCDate() + n); return d.toISOString().slice(0, 10); };
async function createDemo(uid) {
  if ((await sql`SELECT 1 FROM topics WHERE user_id = ${uid} AND is_demo`).length) return;
  const [ana] = await sql`INSERT INTO people (user_id, name, role, is_demo) VALUES (${uid}, 'Ana (primjer)', 'marketing', true) RETURNING id`;
  const [marko] = await sql`INSERT INTO people (user_id, name, role, is_demo) VALUES (${uid}, 'Marko (primjer)', 'nabava', true) RETURNING id`;
  const topic = async (title, color, parent, description = null) => (await sql`INSERT INTO topics (user_id, parent_id, title, description, color, is_demo)
    VALUES (${uid}, ${parent}, ${title}, ${description}, ${color}, true) RETURNING id`)[0].id;
  const root = await topic('Primjer: Sajam 2027', '#4f6bed', null, 'Probna tema da vidiš kako sve izgleda. Kad ti više ne treba, obriši je jednim klikom (traka na vrhu).');
  const stand = await topic('Štand', '#4f6bed', root);
  const mkt = await topic('Marketing', '#d98b1a', root);
  const daysToMonday = ((8 - new Date(todayZg() + 'T12:00:00Z').getUTCDay()) % 7) || 7;
  const task = async (topicId, title, people, { due = null, start = null, status = 'todo', priority = 'normal', repeat = null, description = null } = {}) =>
    (await sql`WITH t AS (INSERT INTO tasks (user_id, topic_id, title, description, status, priority, start_date, due_date, repeat)
        VALUES (${uid}, ${topicId}, ${title}, ${description}, ${status}, ${priority}, ${start}, ${due}, ${repeat}) RETURNING id),
      tp AS (INSERT INTO task_people (task_id, person_id) SELECT t.id, p FROM t, unnest(${people}::int[]) AS p)
      SELECT id FROM t`)[0].id;
  const note = (taskId, personId, body) => sql`INSERT INTO notes (user_id, task_id, person_id, body) VALUES (${uid}, ${taskId}, ${personId}, ${body})`;
  const k1 = await task(stand, 'Naručiti štand 3×3 m', [marko.id], { due: dayFromToday(3), priority: 'high' });
  await note(k1, marko.id, 'Budžet do 2.000 €, traži barem dvije ponude.');
  await note(k1, null, 'Ovdje možeš dodati 📎 ponudu u PDF-u ili fotografiju.');
  const k2 = await task(mkt, 'Dizajn letka', [ana.id], { start: dayFromToday(0), due: dayFromToday(4), status: 'doing',
    description: 'Višednevni zadatak: ima datum početka i rok, pa se u kalendaru vidi kroz više dana.' });
  await note(k2, ana.id, 'Logo i boje sajma, format A5.');
  await task(root, 'Tjedni sastanak tima', [ana.id, marko.id], { due: dayFromToday(daysToMonday), repeat: 'weekly',
    description: 'Ponavlja se svaki tjedan: kad ga označiš gotovim, sam se napravi sljedeći.' });
  await task(stand, 'Poslati prijavu za sajam', [marko.id], { due: dayFromToday(-1) });
  await task(mkt, 'Objava na Instagramu', [ana.id], { due: dayFromToday(8), priority: 'low' });
  await task(root, 'Rezervirati smještaj', [marko.id], { due: dayFromToday(-3), status: 'done' });
  await sql`INSERT INTO pnotes (user_id, title, body, color, pinned, is_demo) VALUES (${uid}, 'Primjer bilješke',
    ${'Ovdje zapisuješ svoje ideje, sastanke i popise — vidiš ih samo ti.\n📌 prikvači važno · 🎨 odaberi boju · 🎤 izdiktiraj · 📎 dodaj fotografiju ili PDF'},
    '#fff8c5', true, true)`;
}

const notFound = () => Object.assign(new Error('Nije pronađeno'), { status: 404 });

// Provjera vlasništva prije izmjena koje dodiruju više tablica.
const own = {
  topic: async (id, uid) => { if (!(await sql`SELECT 1 FROM topics WHERE id = ${id} AND user_id = ${uid}`).length) throw notFound(); },
  task: async (id, uid) => { if (!(await sql`SELECT 1 FROM tasks WHERE id = ${id} AND user_id = ${uid}`).length) throw notFound(); },
  // osoba je opcionalna (null = opća bilješka)
  person: async (id, uid) => { if (id && !(await sql`SELECT 1 FROM people WHERE id = ${id} AND user_id = ${uid}`).length) throw notFound(); },
};
// Nadređena tema: mora biti korisnikova i ne smije biti sama tema ni njena podtema (petlja).
async function parentFor(b, uid, selfId = null) {
  const pid = Number(b.parent_id) || null;
  if (!pid) return null;
  await own.topic(pid, uid);
  if (selfId) {
    const [loop] = await sql`
      WITH RECURSIVE sub AS (
        SELECT id FROM topics WHERE id = ${selfId} AND user_id = ${uid}
        UNION SELECT t.id FROM topics t JOIN sub ON t.parent_id = sub.id)
      SELECT 1 AS x FROM sub WHERE id = ${pid}`;
    if (loop) throw Object.assign(new Error('Tema ne može biti podtema same sebe'), { status: 400 });
  }
  return pid;
}

// Od zadanih id-eva ljudi zadrži samo one koji pripadaju korisniku.
const myPeople = async (list, uid) => (list.length
  ? (await sql`SELECT id FROM people WHERE user_id = ${uid} AND id = ANY(${list}::int[])`).map((r) => r.id)
  : []);

const ops = {
  // --- ljudi ---
  addPerson: (b, uid) => sql`INSERT INTO people (user_id, name, role, email)
                             VALUES (${uid}, ${txt(b.name)}, ${txt(b.role)}, ${email(b.email)})`,
  // „Ja“ zadržava ime; brisati se ne može
  updatePerson: (b, uid) => sql`UPDATE people SET name = CASE WHEN is_me THEN name ELSE ${txt(b.name)} END, role = ${txt(b.role)}, email = ${email(b.email)}
                                WHERE id = ${b.id} AND user_id = ${uid}`,
  deletePerson: (b, uid) => sql`DELETE FROM people WHERE id = ${b.id} AND user_id = ${uid} AND NOT is_me`,
  // Osoba koju je korisnik ranije napravio za sebe (npr. svoje ime) → prebaci zadatke i bilješke na „Ja“ i obriši je.
  mergeIntoMe: async (b, uid) => {
    const [p] = await sql`SELECT id FROM people WHERE id = ${b.id} AND user_id = ${uid} AND NOT is_me`;
    if (!p) throw notFound();
    await ensureMe(uid);
    const [me] = await sql`SELECT id FROM people WHERE user_id = ${uid} AND is_me`;
    await sql.transaction([
      sql`INSERT INTO task_people (task_id, person_id) SELECT task_id, ${me.id} FROM task_people WHERE person_id = ${p.id} ON CONFLICT DO NOTHING`,
      sql`UPDATE notes SET person_id = ${me.id} WHERE person_id = ${p.id} AND user_id = ${uid}`,
      sql`DELETE FROM people WHERE id = ${p.id} AND user_id = ${uid}`,
    ]);
  },

  // --- teme ---
  addTopic: async (b, uid) => {
    const parent = await parentFor(b, uid);
    const [t] = await sql`INSERT INTO topics (user_id, parent_id, title, description, color)
                          VALUES (${uid}, ${parent}, ${txt(b.title)}, ${txt(b.description)}, ${b.color || '#4f6bed'}) RETURNING id`;
    return { topic_id: t.id };
  },
  updateTopic: async (b, uid) => {
    await own.topic(b.id, uid);
    const parent = await parentFor(b, uid, b.id);
    return sql`UPDATE topics SET title = ${txt(b.title)}, description = ${txt(b.description)}, parent_id = ${parent},
               color = ${b.color || '#4f6bed'}, archived = ${!!b.archived}
               WHERE id = ${b.id} AND user_id = ${uid}`;
  },
  deleteTopic: async (b, uid) => {
    const files = await sql`
      WITH RECURSIVE sub AS (
        SELECT id FROM topics WHERE id = ${b.id} AND user_id = ${uid}
        UNION SELECT t.id FROM topics t JOIN sub ON t.parent_id = sub.id),
      tk AS (SELECT id FROM tasks WHERE topic_id IN (SELECT id FROM sub)),
      nt AS (SELECT id FROM notes WHERE task_id IN (SELECT id FROM tk))
      SELECT blob_url, thumb_url FROM attachments WHERE user_id = ${uid}
        AND (topic_id IN (SELECT id FROM sub) OR task_id IN (SELECT id FROM tk) OR note_id IN (SELECT id FROM nt))`;
    await sql`DELETE FROM topics WHERE id = ${b.id} AND user_id = ${uid}`;
    await purge(files);
  },

  // --- zadaci ---
  addTask: async (b, uid) => {
    await own.topic(b.topic_id, uid);
    const people = await myPeople(ids(b.people), uid);
    return sql`
      WITH t AS (
        INSERT INTO tasks (user_id, topic_id, title, description, priority, start_date, due_date, repeat)
        VALUES (${uid}, ${b.topic_id}, ${txt(b.title)}, ${txt(b.description)}, ${b.priority || 'normal'},
                ${span(b).start}, ${span(b).due}, ${repeatOf(b.repeat)})
        RETURNING id)
      INSERT INTO task_people (task_id, person_id)
      SELECT t.id, p FROM t, unnest(${people}::int[]) AS p`;
  },
  updateTask: async (b, uid) => {
    await own.task(b.id, uid);
    await own.topic(b.topic_id, uid);
    const people = await myPeople(ids(b.people), uid);
    const [before] = await sql`SELECT status FROM tasks WHERE id = ${b.id}`;
    const { due, start } = span(b);
    await sql.transaction([
      sql`UPDATE tasks SET title = ${txt(b.title)}, description = ${txt(b.description)},
          status = ${b.status}, priority = ${b.priority}, due_date = ${due}, start_date = ${start},
          repeat = ${repeatOf(b.repeat)}, topic_id = ${b.topic_id},
          completed_at = CASE WHEN ${b.status} = 'done' THEN COALESCE(completed_at, now()) ELSE NULL END
          WHERE id = ${b.id} AND user_id = ${uid}`,
      sql`DELETE FROM task_people WHERE task_id = ${b.id}`,
      sql`INSERT INTO task_people (task_id, person_id) SELECT ${b.id}, unnest(${people}::int[])`,
    ]);
    if (b.status === 'done' && before.status !== 'done') return spawnNext(b.id, uid);
  },
  setStatus: async (b, uid) => {
    const [before] = await sql`SELECT status FROM tasks WHERE id = ${b.id} AND user_id = ${uid}`;
    if (!before) throw notFound();
    await sql`UPDATE tasks SET status = ${b.status},
      completed_at = CASE WHEN ${b.status} = 'done' THEN COALESCE(completed_at, now()) ELSE NULL END
      WHERE id = ${b.id} AND user_id = ${uid}`;
    if (b.status === 'done' && before.status !== 'done') return spawnNext(b.id, uid);
  },
  // Kalendar: novi rok (povlačenjem zadatka na drugi dan); prazno = bez roka.
  // Višednevni zadatak: s rokom se pomiče i početak (za isti broj dana).
  setDue: async (b, uid) => {
    const [k] = await sql`SELECT to_char(due_date, 'YYYY-MM-DD') AS due, to_char(start_date, 'YYYY-MM-DD') AS start
                          FROM tasks WHERE id = ${b.id} AND user_id = ${uid}`;
    if (!k) throw notFound();
    const due = day(b.due_date);
    const start = due && k.start && k.due ? new Date(Date.parse(k.start) + daysBetween(k.due, due) * 864e5).toISOString().slice(0, 10) : null;
    return sql`UPDATE tasks SET due_date = ${due}, start_date = ${start} WHERE id = ${b.id} AND user_id = ${uid}`;
  },
  deleteTask: async (b, uid) => {
    const files = await sql`SELECT blob_url, thumb_url FROM attachments WHERE user_id = ${uid}
      AND (task_id = ${b.id} OR note_id IN (SELECT id FROM notes WHERE task_id = ${b.id}))`;
    await sql`DELETE FROM tasks WHERE id = ${b.id} AND user_id = ${uid}`;
    await purge(files);
  },

  // --- brzi unos (potvrđeni AI prijedlog iz /api/parse) ---
  // {topic_id | new_topic, title, description, priority, due_date, people:[id], new_people:[ime],
  //  notes:[{person_id | person_name, body}]}
  quickAdd: async (b, uid) => {
    const byName = {};
    for (const name of (b.new_people || []).map(txt).filter(Boolean)) {
      const [p] = await sql`INSERT INTO people (user_id, name) VALUES (${uid}, ${name}) RETURNING id`;
      byName[name.toLowerCase()] = p.id;
    }
    let topicId = Number(b.topic_id) || null;
    if (topicId) await own.topic(topicId, uid);
    else {
      // AI može predložiti novu podtemu postojeće teme: "Sajam › Štand" -> podtema "Štand" pod "Sajam".
      const parts = String(txt(b.new_topic) || 'Bez teme').split('›').map((x) => x.trim()).filter(Boolean);
      const title = parts.pop() || 'Bez teme';
      let parent = null;
      if (parts.length) {
        const mine = await sql`SELECT id, parent_id, title FROM topics WHERE user_id = ${uid}`;
        const byId = Object.fromEntries(mine.map((t) => [t.id, t]));
        const path = (t, d = 0) => (t.parent_id && byId[t.parent_id] && d < 20 ? path(byId[t.parent_id], d + 1) + ' › ' : '') + t.title;
        const want = parts.join(' › ').toLowerCase();
        parent = mine.find((t) => path(t).toLowerCase() === want)?.id || null;
      }
      const [t] = await sql`INSERT INTO topics (user_id, parent_id, title) VALUES (${uid}, ${parent}, ${title}) RETURNING id`;
      topicId = t.id;
    }
    const mine = await myPeople(ids(b.people), uid);
    const people = [...new Set([...mine, ...Object.values(byName)])];
    const notes = (b.notes || []).filter((n) => txt(n.body));
    const notePeople = notes.map((n) => {
      const pid = Number(n.person_id) || byName[String(n.person_name || '').toLowerCase()] || 0;
      return people.includes(pid) ? pid : 0;
    });
    const [task] = await sql`
      WITH t AS (
        INSERT INTO tasks (user_id, topic_id, title, description, priority, due_date)
        VALUES (${uid}, ${topicId}, ${txt(b.title)}, ${txt(b.description)}, ${b.priority || 'normal'}, ${b.due_date || null})
        RETURNING id),
      tp AS (INSERT INTO task_people (task_id, person_id) SELECT t.id, p FROM t, unnest(${people}::int[]) AS p),
      nt AS (INSERT INTO notes (user_id, task_id, person_id, body)
        SELECT ${uid}, t.id, NULLIF(n.pid, 0), n.body FROM t, unnest(${notePeople}::int[], ${notes.map((n) => txt(n.body))}::text[]) AS n(pid, body))
      SELECT id FROM t`;
    const steps = (Array.isArray(b.steps) ? b.steps : []).map(txt).filter(Boolean).slice(0, 30);
    if (steps.length) await sql`INSERT INTO subtasks (user_id, task_id, title, pos)
      SELECT ${uid}, ${task.id}, s.title, s.pos FROM unnest(${steps}::text[]) WITH ORDINALITY AS s(title, pos)`;
    return { topic_id: topicId, task_id: task.id };
  },

  // --- bilješke (person_id = null -> opća bilješka zadatka) ---
  addNote: async (b, uid) => {
    await own.task(b.task_id, uid);
    await own.person(b.person_id, uid);
    return sql`INSERT INTO notes (user_id, task_id, person_id, body)
               VALUES (${uid}, ${b.task_id}, ${b.person_id || null}, ${txt(b.body)})`;
  },
  updateNote: (b, uid) => sql`UPDATE notes SET body = ${txt(b.body)} WHERE id = ${b.id} AND user_id = ${uid}`,
  deleteNote: async (b, uid) => {
    const files = await sql`SELECT blob_url, thumb_url FROM attachments WHERE user_id = ${uid} AND note_id = ${b.id}`;
    await sql`DELETE FROM notes WHERE id = ${b.id} AND user_id = ${uid}`;
    await purge(files);
  },

  // --- poveznica za osobu kojoj se delegira (/z/TOKEN) ---
  shareLink: async (b, uid) => {
    const [p] = await sql`SELECT id, share_token FROM people WHERE id = ${b.id} AND user_id = ${uid} AND NOT is_me`;
    if (!p) throw notFound();
    let token = p.share_token;
    if (!token || b.reset) {
      token = randomBytes(24).toString('base64url');
      await sql`UPDATE people SET share_token = ${token} WHERE id = ${p.id}`;
    }
    return { token };
  },
  // javljanja osoba (bilješke s from_person) označi pročitanima
  markSeen: (b, uid) => sql`UPDATE notes SET seen = true WHERE user_id = ${uid} AND NOT seen AND id = ANY(${ids(b.ids)}::int[])`,

  // --- koraci (podzadaci) ---
  addSub: async (b, uid) => {
    await own.task(b.task_id, uid);
    const title = txt(b.title)?.slice(0, 300);
    if (!title) throw Object.assign(new Error('Upiši korak'), { status: 400 });
    return sql`INSERT INTO subtasks (user_id, task_id, title, pos)
               VALUES (${uid}, ${b.task_id}, ${title}, (SELECT COALESCE(max(pos), 0) + 1 FROM subtasks WHERE task_id = ${b.task_id}))`;
  },
  toggleSub: (b, uid) => sql`UPDATE subtasks SET done = ${!!b.done} WHERE id = ${b.id} AND user_id = ${uid}`,
  renameSub: (b, uid) => sql`UPDATE subtasks SET title = ${txt(b.title)?.slice(0, 300)} WHERE id = ${b.id} AND user_id = ${uid} AND ${txt(b.title)} IS NOT NULL`,
  deleteSub: (b, uid) => sql`DELETE FROM subtasks WHERE id = ${b.id} AND user_id = ${uid}`,

  // --- predlošci: tema s podtemama, zadacima i koracima ---
  saveTemplate: async (b, uid) => {
    await own.topic(b.topic_id, uid);
    const topics = await sql`
      WITH RECURSIVE sub AS (
        SELECT id, parent_id, title, description, color, 0 AS depth FROM topics WHERE id = ${b.topic_id} AND user_id = ${uid}
        UNION ALL SELECT t.id, t.parent_id, t.title, t.description, t.color, sub.depth + 1 FROM topics t JOIN sub ON t.parent_id = sub.id WHERE sub.depth < 20)
      SELECT * FROM sub ORDER BY depth, id`;
    const ids = topics.map((t) => t.id);
    const tasks = await sql`SELECT t.id, t.topic_id, t.title, t.description, t.priority, t.repeat,
        (t.due_date - CURRENT_DATE) AS due_off, (t.start_date - CURRENT_DATE) AS start_off,
        COALESCE(array_agg(p.name) FILTER (WHERE p.id IS NOT NULL), '{}') AS people
      FROM tasks t LEFT JOIN task_people tp ON tp.task_id = t.id LEFT JOIN people p ON p.id = tp.person_id
      WHERE t.user_id = ${uid} AND t.topic_id = ANY(${ids}::int[]) GROUP BY t.id ORDER BY t.id`;
    const subs = await sql`SELECT task_id, title FROM subtasks WHERE user_id = ${uid} AND task_id = ANY(${tasks.map((t) => t.id)}::int[]) ORDER BY pos, id`;
    const data = {
      topics: topics.map((t) => ({ key: t.id, parent: t.id === Number(b.topic_id) ? null : t.parent_id, title: t.title, description: t.description, color: t.color })),
      tasks: tasks.map((t) => ({ topic: t.topic_id, title: t.title, description: t.description, priority: t.priority, repeat: t.repeat,
        due_off: t.due_off, start_off: t.start_off, people: t.people, steps: subs.filter((x) => x.task_id === t.id).map((x) => x.title) })),
    };
    const name = txt(b.name) || topics[0].title;
    const [tpl] = await sql`INSERT INTO templates (user_id, name, data) VALUES (${uid}, ${name}, ${JSON.stringify(data)}::jsonb) RETURNING id`;
    return { template_id: tpl.id };
  },
  // Nova tema iz predloška: rokovi = datum početka + spremljeni pomak; ljudi se spajaju po imenu s postojećima.
  useTemplate: async (b, uid) => {
    const [tpl] = await sql`SELECT data FROM templates WHERE id = ${b.template_id} AND user_id = ${uid}`;
    if (!tpl) throw notFound();
    const start = day(b.start_date) || todayZg();
    const shift = (off) => (off == null ? null : new Date(Date.parse(start + 'T12:00:00Z') + off * 864e5).toISOString().slice(0, 10));
    const parent = await parentFor({ parent_id: b.parent_id }, uid);
    const map = {};
    for (const t of tpl.data.topics) {
      const title = t.parent == null ? (txt(b.title) || t.title) : t.title;
      const [n] = await sql`INSERT INTO topics (user_id, parent_id, title, description, color)
        VALUES (${uid}, ${t.parent == null ? parent : map[t.parent] ?? null}, ${title}, ${t.description}, ${t.color}) RETURNING id`;
      map[t.key] = n.id;
    }
    const people = await sql`SELECT id, lower(name) AS n FROM people WHERE user_id = ${uid}`;
    for (const k of tpl.data.tasks) {
      const pids = (k.people || []).map((nm) => people.find((p) => p.n === String(nm).toLowerCase())?.id).filter(Boolean);
      const [n] = await sql`WITH t AS (INSERT INTO tasks (user_id, topic_id, title, description, priority, repeat, due_date, start_date)
          VALUES (${uid}, ${map[k.topic]}, ${k.title}, ${k.description}, ${k.priority || 'normal'}, ${k.repeat}, ${shift(k.due_off)}, ${k.due_off == null ? null : shift(k.start_off)}) RETURNING id),
        tp AS (INSERT INTO task_people (task_id, person_id) SELECT t.id, p FROM t, unnest(${pids}::int[]) AS p)
        SELECT id FROM t`;
      if (k.steps?.length) await sql`INSERT INTO subtasks (user_id, task_id, title, pos)
        SELECT ${uid}, ${n.id}, s.title, s.pos FROM unnest(${k.steps}::text[]) WITH ORDINALITY AS s(title, pos)`;
    }
    return { topic_id: map[tpl.data.topics[0].key] };
  },
  deleteTemplate: (b, uid) => sql`DELETE FROM templates WHERE id = ${b.id} AND user_id = ${uid}`,

  // --- dobrodošlica ---
  createDemo: (b, uid) => createDemo(uid),
  // Briše sve probne podatke (i zadatke koje je korisnik sam dodao u probnu temu) zajedno s prilozima.
  deleteDemo: async (b, uid) => {
    for (const t of await sql`SELECT id FROM topics WHERE user_id = ${uid} AND is_demo AND (parent_id IS NULL OR parent_id NOT IN (SELECT id FROM topics WHERE is_demo))`)
      await ops.deleteTopic({ id: t.id }, uid);
    for (const n of await sql`SELECT id FROM pnotes WHERE user_id = ${uid} AND is_demo`) await ops.deletePnote({ id: n.id }, uid);
    await sql`DELETE FROM people WHERE user_id = ${uid} AND is_demo`;
  },
  onboarded: (b, uid) => sql`UPDATE users SET onboarded = ${b.value !== false} WHERE id = ${uid}`,

  // --- osobne bilješke (kartica „Bilješke“, vidi ih samo autor) ---
  addPnote: async (b, uid) => {
    if (!txt(b.title) && !txt(b.body)) throw Object.assign(new Error('Bilješka je prazna'), { status: 400 });
    const [n] = await sql`INSERT INTO pnotes (user_id, title, body, color) VALUES (${uid}, ${txt(b.title)}, ${txt(b.body)}, ${txt(b.color)}) RETURNING id`;
    return { pnote_id: n.id };
  },
  updatePnote: (b, uid) => sql`UPDATE pnotes SET title = ${txt(b.title)}, body = ${txt(b.body)}, color = ${txt(b.color)}, updated_at = now()
                               WHERE id = ${b.id} AND user_id = ${uid}`,
  pinPnote: (b, uid) => sql`UPDATE pnotes SET pinned = ${!!b.pinned} WHERE id = ${b.id} AND user_id = ${uid}`,
  deletePnote: async (b, uid) => {
    const files = await sql`SELECT blob_url, thumb_url FROM attachments WHERE user_id = ${uid} AND pnote_id = ${b.id}`;
    await sql`DELETE FROM pnotes WHERE id = ${b.id} AND user_id = ${uid}`;
    await purge(files);
  },
};

export default async function handler(req, res) {
  res.setHeader('Cache-Control', 'no-store');
  try {
    const me = await currentUser(req);
    if (!me) return res.status(401).json({ error: 'Prijavi se' });

    let body = null, result = null;
    if (req.method === 'POST') {
      body = readBody(req);
      const fn = ops[body.op];
      if (!fn) return res.status(400).json({ error: `Nepoznata operacija: ${body.op}` });
      result = await fn(body, me.id);
    } else if (req.method !== 'GET') {
      return res.status(405).json({ error: 'Method not allowed' });
    }
    const data = await loadAll(me.id);
    data.user = me;
    if (['quickAdd', 'addTopic', 'setStatus', 'updateTask', 'addPnote', 'shareLink', 'saveTemplate', 'useTemplate'].includes(body?.op)) data.result = result || null;
    return res.status(200).json(data);
  } catch (e) {
    if (!e.status) console.error(e);
    return res.status(e.status || 500).json({ error: e.status ? e.message : e.message || 'Greška na poslužitelju' });
  }
}
