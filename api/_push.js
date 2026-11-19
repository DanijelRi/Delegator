// Slanje Web Push obavijesti na sve uređaje korisnika. Bez VAPID ključeva u env-u ne radi ništa.
import { setVapidDetails, sendNotification } from 'web-push';
import { sql } from './_lib.js';

const PUB = process.env.VAPID_PUBLIC_KEY, PRIV = process.env.VAPID_PRIVATE_KEY;
export const pushReady = Boolean(PUB && PRIV);
// "subject" mora biti mailto: ili https: adresa — koristimo adresu aplikacije.
if (pushReady) setVapidDetails(process.env.VAPID_SUBJECT || 'https://delegator-psi.vercel.app', PUB, PRIV);
export const vapidPublicKey = PUB || null;

// payload: { title, body, url, tag }
export async function pushToUser(userId, payload) {
  if (!pushReady) return 0;
  const subs = await sql`SELECT id, endpoint, p256dh, auth FROM push_subs WHERE user_id = ${userId}`;
  let sent = 0;
  await Promise.all(subs.map(async (s) => {
    try {
      await sendNotification({ endpoint: s.endpoint, keys: { p256dh: s.p256dh, auth: s.auth } },
        JSON.stringify(payload), { TTL: 60 * 60 * 12, urgency: 'normal' });
      sent++;
    } catch (e) {
      // 404/410 = pretplata više ne postoji (aplikacija obrisana, dopuštenje povučeno)
      if (e.statusCode === 404 || e.statusCode === 410) await sql`DELETE FROM push_subs WHERE id = ${s.id}`;
      else console.error('Push', e.statusCode, e.body || e.message);
    }
  }));
  return sent;
}
