// Jedan endpoint za podatke prijavljenog korisnika.
// GET  /api/data            -> vraća sve podatke korisnika
// POST /api/data {op, ...}  -> izvrši operaciju i vrati sve podatke
// Svaki upit je ograničen na user_id prijavljenog korisnika — nitko ne vidi tuđe podatke.
import { sql, currentUser, readBody, txt } from './_lib.js';

async function loadAll(uid) {
  const [people, topics, tasks, notes] = await Promise.all([
    sql`SELECT id, name, role, email FROM people WHERE user_id = ${uid} ORDER BY name`,
    sql`SELECT id, title, description, color, archived FROM topics WHERE user_id = ${uid} ORDER BY archived, created_at`,
    sql`SELECT t.id, t.topic_id, t.title, t.description, t.status, t.priority,
               to_char(t.due_date, 'YYYY-MM-DD') AS due_date, t.created_at,
               COALESCE(array_agg(tp.person_id) FILTER (WHERE tp.person_id IS NOT NULL), '{}') AS people
        FROM tasks t LEFT JOIN task_people tp ON tp.task_id = t.id
        WHERE t.user_id = ${uid}
        GROUP BY t.id ORDER BY t.created_at`,
    sql`SELECT id, task_id, person_id, body, created_at FROM notes WHERE user_id = ${uid} ORDER BY created_at`,
  ]);
  return { people, topics, tasks, notes };
}

const ids = (a) => (Array.isArray(a) ? a.map(Number).filter(Number.isInteger) : []);
const email = (v) => {
  const e = txt(v);
  if (e && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(e)) throw Object.assign(new Error('Neispravna e-mail adresa'), { status: 400 });
  return e;
};
const notFound = () => Object.assign(new Error('Nije pronađeno'), { status: 404 });

// Provjera vlasništva prije izmjena koje dodiruju više tablica.
const own = {
  topic: async (id, uid) => { if (!(await sql`SELECT 1 FROM topics WHERE id = ${id} AND user_id = ${uid}`).length) throw notFound(); },
  task: async (id, uid) => { if (!(await sql`SELECT 1 FROM tasks WHERE id = ${id} AND user_id = ${uid}`).length) throw notFound(); },
  // osoba je opcionalna (null = opća bilješka)
  person: async (id, uid) => { if (id && !(await sql`SELECT 1 FROM people WHERE id = ${id} AND user_id = ${uid}`).length) throw notFound(); },
};
// Od zadanih id-eva ljudi zadrži samo one koji pripadaju korisniku.
const myPeople = async (list, uid) => (list.length
  ? (await sql`SELECT id FROM people WHERE user_id = ${uid} AND id = ANY(${list}::int[])`).map((r) => r.id)
  : []);

const ops = {
  // --- ljudi ---
  addPerson: (b, uid) => sql`INSERT INTO people (user_id, name, role, email)
                             VALUES (${uid}, ${txt(b.name)}, ${txt(b.role)}, ${email(b.email)})`,
  updatePerson: (b, uid) => sql`UPDATE people SET name = ${txt(b.name)}, role = ${txt(b.role)}, email = ${email(b.email)}
                                WHERE id = ${b.id} AND user_id = ${uid}`,
  deletePerson: (b, uid) => sql`DELETE FROM people WHERE id = ${b.id} AND user_id = ${uid}`,

  // --- teme ---
  addTopic: (b, uid) => sql`INSERT INTO topics (user_id, title, description, color)
                            VALUES (${uid}, ${txt(b.title)}, ${txt(b.description)}, ${b.color || '#4f6bed'})`,
  updateTopic: (b, uid) => sql`UPDATE topics SET title = ${txt(b.title)}, description = ${txt(b.description)},
                               color = ${b.color || '#4f6bed'}, archived = ${!!b.archived}
                               WHERE id = ${b.id} AND user_id = ${uid}`,
  deleteTopic: (b, uid) => sql`DELETE FROM topics WHERE id = ${b.id} AND user_id = ${uid}`,

  // --- zadaci ---
  addTask: async (b, uid) => {
    await own.topic(b.topic_id, uid);
    const people = await myPeople(ids(b.people), uid);
    return sql`
      WITH t AS (
        INSERT INTO tasks (user_id, topic_id, title, description, priority, due_date)
        VALUES (${uid}, ${b.topic_id}, ${txt(b.title)}, ${txt(b.description)}, ${b.priority || 'normal'}, ${b.due_date || null})
        RETURNING id)
      INSERT INTO task_people (task_id, person_id)
      SELECT t.id, p FROM t, unnest(${people}::int[]) AS p`;
  },
  updateTask: async (b, uid) => {
    await own.task(b.id, uid);
    await own.topic(b.topic_id, uid);
    const people = await myPeople(ids(b.people), uid);
    return sql.transaction([
      sql`UPDATE tasks SET title = ${txt(b.title)}, description = ${txt(b.description)},
          status = ${b.status}, priority = ${b.priority}, due_date = ${b.due_date || null},
          topic_id = ${b.topic_id} WHERE id = ${b.id} AND user_id = ${uid}`,
      sql`DELETE FROM task_people WHERE task_id = ${b.id}`,
      sql`INSERT INTO task_people (task_id, person_id) SELECT ${b.id}, unnest(${people}::int[])`,
    ]);
  },
  setStatus: (b, uid) => sql`UPDATE tasks SET status = ${b.status} WHERE id = ${b.id} AND user_id = ${uid}`,
  deleteTask: (b, uid) => sql`DELETE FROM tasks WHERE id = ${b.id} AND user_id = ${uid}`,

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
      const [t] = await sql`INSERT INTO topics (user_id, title) VALUES (${uid}, ${txt(b.new_topic) || 'Bez teme'}) RETURNING id`;
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
  deleteNote: (b, uid) => sql`DELETE FROM notes WHERE id = ${b.id} AND user_id = ${uid}`,
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
    if (body?.op === 'quickAdd') data.result = result;
    return res.status(200).json(data);
  } catch (e) {
    if (!e.status) console.error(e);
    return res.status(e.status || 500).json({ error: e.status ? e.message : e.message || 'Greška na poslužitelju' });
  }
}
