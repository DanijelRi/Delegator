// Prilozi: datoteke su privatne u Vercel Blobu, pristup samo vlasniku preko ove funkcije.
// POST   /api/files?task=ID | note=ID | topic=ID | pnote=ID   tijelo = sama datoteka, zaglavlje x-file-name
// POST   /api/files?thumb=ID                                    sličica (JPEG do 320 px) za postojeću sliku
// GET    /api/files?id=ID[&dl=1 | &t=1]                         preuzimanje / prikaz / sličica
// Tijelo POST-a čitamo kao tok bajtova (req.body se namjerno ne dira, da ga Vercel ne pokuša parsirati).
// DELETE /api/files?id=ID
import { Readable } from 'node:stream';
import { put, get, del } from '@vercel/blob';
import { sql, currentUser } from './_lib.js';

export const MAX_BYTES = 20 * 1024 * 1024; // 20 MB po datoteci
const TARGETS = { task: 'task_id', note: 'note_id', topic: 'topic_id', pnote: 'pnote_id' };
// Ove vrste smiju se prikazati u pregledniku; sve ostalo (npr. HTML, SVG) samo se preuzima, da ne može izvršiti skriptu.
const INLINE = /^(image\/(png|jpe?g|gif|webp|heic|heif|avif)|application\/pdf|text\/plain|audio\/[\w.+-]+|video\/(mp4|webm|quicktime))$/i;

const fail = (status, error) => Object.assign(new Error(error), { status });

async function owns(kind, id, uid) {
  const q = {
    task: sql`SELECT 1 FROM tasks WHERE id = ${id} AND user_id = ${uid}`,
    note: sql`SELECT 1 FROM notes WHERE id = ${id} AND user_id = ${uid}`,
    topic: sql`SELECT 1 FROM topics WHERE id = ${id} AND user_id = ${uid}`,
    pnote: sql`SELECT 1 FROM pnotes WHERE id = ${id} AND user_id = ${uid}`,
  }[kind];
  if (!(await q).length) throw fail(404, 'Nije pronađeno');
}

// Naziv datoteke bez putanje i čudnih znakova (za putanju u Blobu), a izvorni naziv čuvamo u bazi.
const safeName = (n) => n.normalize('NFKD').replace(/[̀-ͯ]/g, '').replace(/[^\w.-]+/g, '_').replace(/^_+|_+$/g, '').slice(-80) || 'datoteka';

async function readBody(req) {
  const declared = Number(req.headers['content-length'] || 0);
  if (declared > MAX_BYTES) throw fail(413, 'Datoteka je prevelika (najviše 20 MB)');
  const chunks = []; let size = 0;
  for await (const c of req) {
    size += c.length;
    if (size > MAX_BYTES) throw fail(413, 'Datoteka je prevelika (najviše 20 MB)');
    chunks.push(c);
  }
  if (!size) throw fail(400, 'Prazna datoteka');
  return Buffer.concat(chunks);
}

export default async function handler(req, res) {
  res.setHeader('Cache-Control', 'no-store');
  try {
    const me = await currentUser(req);
    if (!me) return res.status(401).json({ error: 'Prijavi se' });
    const q = req.query || Object.fromEntries(new URL(req.url, 'http://x').searchParams);

    if (req.method === 'POST') {
      // x-file-name je obavezno vlastito zaglavlje: tuđa stranica ga ne može poslati bez CORS dopuštenja.
      // sličica za već spremljenu sliku
      if (q.thumb) {
        const [img] = await sql`SELECT id, thumb_url FROM attachments WHERE id = ${Number(q.thumb)} AND user_id = ${me.id} AND mime LIKE 'image/%'`;
        if (!img) throw fail(404, 'Slika nije pronađena');
        const body = await readBody(req);
        if (body.length > 300 * 1024) throw fail(413, 'Sličica je prevelika');
        const blob = await put(`u${me.id}/thumbs/${img.id}.jpg`, body, { access: 'private', contentType: 'image/jpeg', addRandomSuffix: true });
        await sql`UPDATE attachments SET thumb_url = ${blob.url} WHERE id = ${img.id}`;
        if (img.thumb_url) await del(img.thumb_url).catch(() => {});
        return res.status(200).json({ ok: true });
      }
      const rawName = req.headers['x-file-name'];
      if (!rawName) throw fail(400, 'Nedostaje naziv datoteke');
      const name = decodeURIComponent(String(rawName)).replace(/[\\/]/g, '_').slice(0, 200);
      const kind = Object.keys(TARGETS).find((k) => q[k]);
      if (!kind) throw fail(400, 'Nije navedeno kamo prilog ide');
      const targetId = Number(q[kind]);
      await owns(kind, targetId, me.id);
      const mime = String(req.headers['content-type'] || 'application/octet-stream').split(';')[0].trim().toLowerCase();
      const body = await readBody(req);
      const blob = await put(`u${me.id}/${kind}${targetId}/${safeName(name)}`, body,
        { access: 'private', contentType: mime, addRandomSuffix: true });
      const col = TARGETS[kind];
      const [row] = await sql`INSERT INTO attachments (user_id, task_id, note_id, topic_id, pnote_id, name, mime, size, blob_url)
        VALUES (${me.id}, ${col === 'task_id' ? targetId : null}, ${col === 'note_id' ? targetId : null},
                ${col === 'topic_id' ? targetId : null}, ${col === 'pnote_id' ? targetId : null},
                ${name}, ${mime}, ${body.length}, ${blob.url})
        RETURNING id, task_id, note_id, topic_id, pnote_id, name, mime, size, created_at`;
      return res.status(200).json({ attachment: row });
    }

    const id = Number(q.id);
    const [a] = id ? await sql`SELECT id, name, mime, size, blob_url, thumb_url FROM attachments WHERE id = ${id} AND user_id = ${me.id}` : [];
    if (!a) throw fail(404, 'Prilog nije pronađen');

    if (req.method === 'DELETE') {
      await sql`DELETE FROM attachments WHERE id = ${a.id}`;
      await del([a.blob_url, a.thumb_url].filter(Boolean)).catch((e) => console.error('Blob del', e.message));
      return res.status(200).json({ ok: true });
    }
    if (req.method !== 'GET') return res.status(405).json({ error: 'Method not allowed' });

    const thumb = q.t && a.thumb_url;
    const r = await get(thumb ? a.thumb_url : a.blob_url, { access: 'private' });
    if (!r || r.statusCode !== 200) throw fail(404, 'Datoteka nije pronađena');
    const inline = !q.dl && INLINE.test(a.mime || '');
    res.setHeader('Content-Type', thumb ? 'image/jpeg' : a.mime || 'application/octet-stream');
    const len = thumb ? r.blob.size : a.size;
    if (len) res.setHeader('Content-Length', String(len));
    res.setHeader('Content-Disposition', `${inline ? 'inline' : 'attachment'}; filename="${safeName(a.name)}"; filename*=UTF-8''${encodeURIComponent(a.name)}`);
    // datoteka se nikad ne mijenja, pa je preglednik smije čuvati; „private“ = ne u dijeljenim spremnicima
    // datoteke se ne mijenjaju; iznimka je sličica koja još ne postoji (može stići malo kasnije)
    res.setHeader('Cache-Control', q.t && !thumb ? 'private, max-age=60' : 'private, max-age=604800, immutable');
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('Content-Security-Policy', "default-src 'none'; img-src 'self' data:; media-src 'self'; style-src 'unsafe-inline'; sandbox");
    res.statusCode = 200;
    Readable.fromWeb(r.stream).pipe(res);
  } catch (e) {
    if (!e.status) console.error(e);
    if (!res.headersSent) res.status(e.status || 500).json({ error: e.status ? e.message : 'Greška pri radu s prilogom' });
  }
}
