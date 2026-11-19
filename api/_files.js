// Zajedničko za priloge: siguran naziv datoteke i slanje privatne datoteke iz Bloba pregledniku.
// Koriste ga api/files.js (vlasnik) i api/guest.js (osoba preko svoje poveznice).
import { Readable } from 'node:stream';
import { get } from '@vercel/blob';

// Ove vrste smiju se prikazati u pregledniku; sve ostalo (npr. HTML, SVG) samo se preuzima, da ne može izvršiti skriptu.
export const INLINE = /^(image\/(png|jpe?g|gif|webp|heic|heif|avif)|application\/pdf|text\/plain|audio\/[\w.+-]+|video\/(mp4|webm|quicktime))$/i;
// Naziv datoteke bez putanje i čudnih znakova (za putanju u Blobu i zaglavlje), izvorni naziv čuvamo u bazi.
export const safeName = (n) => n.normalize('NFKD').replace(/[̀-ͯ]/g, '').replace(/[^\w.-]+/g, '_').replace(/^_+|_+$/g, '').slice(-80) || 'datoteka';

// a = redak iz attachments (name, mime, size, blob_url, thumb_url); q.t = sličica, q.dl = preuzimanje
export async function streamAttachment(res, a, q = {}) {
  const thumb = q.t && a.thumb_url;
  const r = await get(thumb ? a.thumb_url : a.blob_url, { access: 'private' });
  if (!r || r.statusCode !== 200) { res.statusCode = 404; return res.end('Datoteka nije pronađena'); }
  const inline = !q.dl && INLINE.test(a.mime || '');
  res.setHeader('Content-Type', thumb ? 'image/jpeg' : a.mime || 'application/octet-stream');
  const len = thumb ? r.blob.size : a.size;
  if (len) res.setHeader('Content-Length', String(len));
  res.setHeader('Content-Disposition', `${inline ? 'inline' : 'attachment'}; filename="${safeName(a.name)}"; filename*=UTF-8''${encodeURIComponent(a.name)}`);
  // datoteke se ne mijenjaju pa ih preglednik smije čuvati („private“ = ne u dijeljenim spremnicima);
  // iznimka je sličica koja još ne postoji (može stići malo kasnije)
  res.setHeader('Cache-Control', q.t && !thumb ? 'private, max-age=60' : 'private, max-age=604800, immutable');
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('Content-Security-Policy', "default-src 'none'; img-src 'self' data:; media-src 'self'; style-src 'unsafe-inline'; sandbox");
  res.statusCode = 200;
  Readable.fromWeb(r.stream).pipe(res);
}
