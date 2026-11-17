// GET /api/ical?t=TOKEN -> kalendar (iCalendar) s rokovima korisnika za pretplatu u Google/Apple kalendaru.
// Bez kolačića: pristup daje tajni token iz poveznice (korisnik ga može promijeniti u aplikaciji).
import { sql } from './_lib.js';

const RRULE = { daily: 'FREQ=DAILY', weekly: 'FREQ=WEEKLY', biweekly: 'FREQ=WEEKLY;INTERVAL=2', monthly: 'FREQ=MONTHLY', yearly: 'FREQ=YEARLY' };
const STATUS = { todo: 'Za napraviti', doing: 'U tijeku', done: 'Gotovo' };

// Tekst za iCalendar: escape \ ; , i novi redovi.
const icsText = (s) => String(s ?? '').replace(/\\/g, '\\\\').replace(/;/g, '\\;').replace(/,/g, '\\,').replace(/\r?\n/g, '\\n');
// Redovi dulji od 75 bajtova lome se (RFC 5545), pazeći da se ne prepolovi UTF-8 znak.
function fold(line) {
  const out = [];
  let cur = '', bytes = 0;
  for (const ch of line) {
    const b = Buffer.byteLength(ch);
    if (bytes + b > (out.length ? 74 : 75)) { out.push(cur); cur = ''; bytes = 0; }
    cur += ch; bytes += b;
  }
  out.push(cur);
  return out.join('\r\n ');
}
const ymd = (iso) => iso.replace(/-/g, '');
const nextDay = (iso) => new Date(Date.parse(iso) + 864e5).toISOString().slice(0, 10);

export default async function handler(req, res) {
  const token = String(req.query?.t || new URL(req.url, 'http://x').searchParams.get('t') || '');
  const [u] = token.length >= 20 ? await sql`SELECT id, name FROM users WHERE ical_token = ${token}` : [];
  if (!u) { res.statusCode = 404; return res.end('Nepoznata poveznica kalendara'); }

  const [tasks, topics, people, notes] = await Promise.all([
    sql`SELECT t.id, t.topic_id, t.title, t.description, t.status, t.priority, t.repeat, t.created_at,
               to_char(t.due_date, 'YYYY-MM-DD') AS due, to_char(t.start_date, 'YYYY-MM-DD') AS start,
               COALESCE(array_agg(tp.person_id) FILTER (WHERE tp.person_id IS NOT NULL), '{}') AS people
        FROM tasks t LEFT JOIN task_people tp ON tp.task_id = t.id
        WHERE t.user_id = ${u.id} AND t.due_date IS NOT NULL
          AND (t.status <> 'done' OR t.due_date > CURRENT_DATE - 60)
        GROUP BY t.id`,
    sql`SELECT id, parent_id, title FROM topics WHERE user_id = ${u.id}`,
    sql`SELECT id, name FROM people WHERE user_id = ${u.id}`,
    sql`SELECT task_id, person_id, body FROM notes WHERE user_id = ${u.id} ORDER BY created_at`,
  ]);
  const topicById = Object.fromEntries(topics.map((t) => [t.id, t]));
  const path = (t, d = 0) => (t?.parent_id && topicById[t.parent_id] && d < 20 ? path(topicById[t.parent_id], d + 1) + ' › ' : '') + (t?.title || '');
  const personName = Object.fromEntries(people.map((p) => [p.id, p.name]));
  const appUrl = `https://${req.headers.host}/`;
  const stamp = new Date().toISOString().replace(/[-:]/g, '').replace(/\.\d+/, '');

  const lines = ['BEGIN:VCALENDAR', 'VERSION:2.0', 'PRODID:-//Delegator//HR', 'CALSCALE:GREGORIAN', 'METHOD:PUBLISH',
    `X-WR-CALNAME:${icsText('Delegator — ' + u.name)}`, 'X-WR-TIMEZONE:Europe/Zagreb',
    'REFRESH-INTERVAL;VALUE=DURATION:PT1H', 'X-PUBLISHED-TTL:PT1H'];
  for (const k of tasks) {
    const who = k.people.map((id) => personName[id]).filter(Boolean);
    const desc = [
      `Tema: ${path(topicById[k.topic_id])}`,
      `Status: ${STATUS[k.status]}${k.priority === 'high' ? ' · HITNO' : ''}`,
      who.length ? `Zaduženi: ${who.join(', ')}` : '',
      k.description ? `\n${k.description}` : '',
      ...notes.filter((n) => n.task_id === k.id).map((n) => `– ${n.person_id ? personName[n.person_id] + ': ' : ''}${n.body}`),
      `\n${appUrl}`,
    ].filter(Boolean).join('\n');
    lines.push('BEGIN:VEVENT', `UID:delegator-task-${k.id}@${req.headers.host}`, `DTSTAMP:${stamp}`,
      `DTSTART;VALUE=DATE:${ymd(k.start || k.due)}`, `DTEND;VALUE=DATE:${ymd(nextDay(k.due))}`,
      `SUMMARY:${icsText((k.status === 'done' ? '✓ ' : k.priority === 'high' ? '❗ ' : '') + k.title + (who.length ? ` (${who.join(', ')})` : ''))}`,
      `DESCRIPTION:${icsText(desc)}`, `URL:${appUrl}`, 'TRANSP:TRANSPARENT');
    if (k.repeat && RRULE[k.repeat] && k.status !== 'done') lines.push(`RRULE:${RRULE[k.repeat]}`);
    lines.push('END:VEVENT');
  }
  lines.push('END:VCALENDAR');

  res.setHeader('Content-Type', 'text/calendar; charset=utf-8');
  res.setHeader('Content-Disposition', 'inline; filename="delegator.ics"');
  res.setHeader('Cache-Control', 'private, max-age=300');
  res.end(lines.map(fold).join('\r\n') + '\r\n');
}
