// Primijeni schema.sql na bazu iz DATABASE_URL: `npm run migrate`
// Shema je idempotentna, pa se smije pokretati više puta.
import { readFile } from 'node:fs/promises';
import { neon } from '@neondatabase/serverless';

const sql = neon(process.env.DATABASE_URL);
const text = await readFile(new URL('./schema.sql', import.meta.url), 'utf8');
const statements = text
  .split('\n').filter((l) => !l.trim().startsWith('--')).join('\n')
  .split(/;\s*(?:\n|$)/).map((s) => s.trim()).filter(Boolean);

const host = new URL(process.env.DATABASE_URL).host;
console.log(`Primjenjujem ${statements.length} naredbi na ${host}…`);
for (const st of statements) {
  await sql.query(st);
  console.log('✓', st.split('\n')[0].slice(0, 90));
}
console.log('Gotovo.');
