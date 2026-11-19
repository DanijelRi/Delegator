// Sigurnosna kopija cijele baze kao JSON u privatni Vercel Blob (backups/), čuva se 30 dana.
// Prilozi (same datoteke) nisu u kopiji — oni su ionako odvojeno u Blobu; u kopiji su njihovi podaci.
import { put, list, del } from '@vercel/blob';
import { sql } from './_lib.js';

export const BACKUP_DAYS = 30;
const TABLES = ['users', 'people', 'topics', 'tasks', 'task_people', 'notes', 'pnotes', 'attachments', 'ai_usage'];

export async function runBackup() {
  const tables = {};
  for (const t of TABLES) tables[t] = await sql.query(`SELECT * FROM ${t} ORDER BY 1`); // nazivi su fiksni popis gore
  const day = new Date().toLocaleDateString('sv-SE', { timeZone: 'Europe/Zagreb' });
  const body = JSON.stringify({ app: 'delegator', created_at: new Date().toISOString(), tables });
  const blob = await put(`backups/delegator-${day}.json`, body,
    { access: 'private', contentType: 'application/json', addRandomSuffix: false, allowOverwrite: true });
  // starije od 30 dana briši
  const { blobs } = await list({ prefix: 'backups/' });
  const old = blobs.filter((b) => Date.now() - new Date(b.uploadedAt).getTime() > BACKUP_DAYS * 864e5).map((b) => b.url);
  if (old.length) await del(old);
  return { file: blob.pathname, bytes: body.length, rows: Object.fromEntries(Object.entries(tables).map(([k, v]) => [k, v.length])), removed: old.length };
}

export async function listBackups() {
  const { blobs } = await list({ prefix: 'backups/' });
  return blobs.map((b) => ({ name: b.pathname.replace('backups/', ''), size: b.size, uploadedAt: b.uploadedAt }))
    .sort((a, b) => b.name.localeCompare(a.name));
}
