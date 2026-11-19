-- Delegator — shema baze (Neon Postgres). Idempotentno: smije se pokrenuti više puta.

-- ===== Korisnici aplikacije (prijava na pozivnice) =====
CREATE TABLE IF NOT EXISTS users (
  id            serial PRIMARY KEY,
  email         text NOT NULL,
  name          text NOT NULL,
  password_hash text NOT NULL,
  is_admin      boolean NOT NULL DEFAULT false,
  created_at    timestamptz DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS users_email_idx ON users (lower(email));

-- Prijave: u kolačiću je nasumični token, u bazi samo njegov SHA-256 sažetak.
CREATE TABLE IF NOT EXISTS sessions (
  token_hash text PRIMARY KEY,
  user_id    int NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  expires_at timestamptz NOT NULL,
  created_at timestamptz DEFAULT now()
);
CREATE INDEX IF NOT EXISTS sessions_user_idx ON sessions (user_id);

-- Pozivnice (kind = 'invite') i poveznice za novu lozinku (kind = 'reset', user_id = kome).
CREATE TABLE IF NOT EXISTS invites (
  token_hash text PRIMARY KEY,
  kind       text NOT NULL DEFAULT 'invite' CHECK (kind IN ('invite', 'reset')),
  note       text,
  user_id    int REFERENCES users(id) ON DELETE CASCADE,
  created_by int REFERENCES users(id) ON DELETE SET NULL,
  used_by    int REFERENCES users(id) ON DELETE SET NULL,
  used_at    timestamptz,
  expires_at timestamptz NOT NULL,
  created_at timestamptz DEFAULT now()
);

-- Dnevni brojač AI brzog unosa po korisniku (dan po Europe/Zagreb).
CREATE TABLE IF NOT EXISTS ai_usage (
  user_id int NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  day     date NOT NULL,
  count   int NOT NULL DEFAULT 0,
  PRIMARY KEY (user_id, day)
);

-- ===== Podaci =====
CREATE TABLE IF NOT EXISTS people (
  id         serial PRIMARY KEY,
  name       text NOT NULL,
  role       text,
  created_at timestamptz DEFAULT now()
);

CREATE TABLE IF NOT EXISTS topics (
  id          serial PRIMARY KEY,
  title       text NOT NULL,
  description text,
  color       text DEFAULT '#4f6bed',
  archived    boolean DEFAULT false,
  created_at  timestamptz DEFAULT now()
);

CREATE TABLE IF NOT EXISTS tasks (
  id          serial PRIMARY KEY,
  topic_id    int NOT NULL REFERENCES topics(id) ON DELETE CASCADE,
  title       text NOT NULL,
  description text,
  status      text NOT NULL DEFAULT 'todo' CHECK (status IN ('todo', 'doing', 'done')),
  priority    text NOT NULL DEFAULT 'normal' CHECK (priority IN ('low', 'normal', 'high')),
  due_date    date,
  created_at  timestamptz DEFAULT now()
);
CREATE INDEX IF NOT EXISTS tasks_topic_idx ON tasks (topic_id);

CREATE TABLE IF NOT EXISTS task_people (
  task_id   int NOT NULL REFERENCES tasks(id) ON DELETE CASCADE,
  person_id int NOT NULL REFERENCES people(id) ON DELETE CASCADE,
  PRIMARY KEY (task_id, person_id)
);

CREATE TABLE IF NOT EXISTS notes (
  id         serial PRIMARY KEY,
  task_id    int NOT NULL REFERENCES tasks(id) ON DELETE CASCADE,
  person_id  int REFERENCES people(id) ON DELETE SET NULL,
  body       text NOT NULL,
  created_at timestamptz DEFAULT now()
);
CREATE INDEX IF NOT EXISTS notes_task_idx ON notes (task_id);

-- ===== Više korisnika: svaki redak pripada jednom korisniku =====
-- Stupac smije biti NULL samo za podatke od prije uvođenja korisnika: njih pri prvom
-- postavljanju preuzima prvi korisnik (administrator), vidi op "signup" u api/auth.js.
-- Aplikacija uvijek upisuje user_id i čita samo retke prijavljenog korisnika.
ALTER TABLE people ADD COLUMN IF NOT EXISTS user_id int REFERENCES users(id) ON DELETE CASCADE;
ALTER TABLE topics ADD COLUMN IF NOT EXISTS user_id int REFERENCES users(id) ON DELETE CASCADE;
ALTER TABLE tasks  ADD COLUMN IF NOT EXISTS user_id int REFERENCES users(id) ON DELETE CASCADE;
ALTER TABLE notes  ADD COLUMN IF NOT EXISTS user_id int REFERENCES users(id) ON DELETE CASCADE;
CREATE INDEX IF NOT EXISTS people_user_idx ON people (user_id);
CREATE INDEX IF NOT EXISTS topics_user_idx ON topics (user_id);
CREATE INDEX IF NOT EXISTS tasks_user_idx  ON tasks (user_id);
CREATE INDEX IF NOT EXISTS notes_user_idx  ON notes (user_id);

-- E-mail osobe kojoj se delegira (za gumb „Pošalji mailom“).
ALTER TABLE people ADD COLUMN IF NOT EXISTS email text;

-- Podteme: tema može imati nadređenu temu (stablo bilo koje dubine).
-- Brisanje teme briše i njene podteme sa zadacima (sučelje to jasno najavi prije brisanja).
ALTER TABLE topics ADD COLUMN IF NOT EXISTS parent_id int REFERENCES topics(id) ON DELETE CASCADE;
CREATE INDEX IF NOT EXISTS topics_parent_idx ON topics (parent_id);

-- Datum početka (višednevni zadaci u kalendaru) i ponavljanje zadatka.
-- repeat: daily | weekly | biweekly | monthly | yearly (NULL = ne ponavlja se).
-- Kad se zadatak koji se ponavlja označi gotovim, nastaje sljedeći s pomaknutim rokom.
ALTER TABLE tasks ADD COLUMN IF NOT EXISTS start_date date;
ALTER TABLE tasks ADD COLUMN IF NOT EXISTS repeat text;

-- Tajni token za pretplatu na kalendar (Google/Apple): /api/ical?t=TOKEN
ALTER TABLE users ADD COLUMN IF NOT EXISTS ical_token text;
CREATE UNIQUE INDEX IF NOT EXISTS users_ical_idx ON users (ical_token);

-- Osobne bilješke (kartica „Bilješke“): vidi ih samo korisnik koji ih je napisao.
CREATE TABLE IF NOT EXISTS pnotes (
  id         serial PRIMARY KEY,
  user_id    int NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  title      text,
  body       text,
  color      text,
  pinned     boolean NOT NULL DEFAULT false,
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now()
);
CREATE INDEX IF NOT EXISTS pnotes_user_idx ON pnotes (user_id);

-- Prilozi (PDF, fotografije, dokumenti). Datoteka je privatna u Vercel Blobu (blob_url),
-- ovdje su samo podaci o njoj. Pripada točno jednom: zadatku, bilješci zadatka, temi ili osobnoj bilješci.
CREATE TABLE IF NOT EXISTS attachments (
  id         serial PRIMARY KEY,
  user_id    int NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  task_id    int REFERENCES tasks(id) ON DELETE CASCADE,
  note_id    int REFERENCES notes(id) ON DELETE CASCADE,
  topic_id   int REFERENCES topics(id) ON DELETE CASCADE,
  pnote_id   int REFERENCES pnotes(id) ON DELETE CASCADE,
  name       text NOT NULL,
  mime       text,
  size       int,
  blob_url   text NOT NULL,
  created_at timestamptz DEFAULT now(),
  CHECK (num_nonnulls(task_id, note_id, topic_id, pnote_id) = 1)
);
CREATE INDEX IF NOT EXISTS attachments_user_idx ON attachments (user_id);

-- Mala sličica fotografije (do 320 px) za brzi prikaz popisa; cijela slika samo na klik.
ALTER TABLE attachments ADD COLUMN IF NOT EXISTS thumb_url text;

-- Dobrodošlica: je li korisnik prošao vodič; probni podaci („Primjer“) koje korisnik može obrisati jednim klikom.
ALTER TABLE users  ADD COLUMN IF NOT EXISTS onboarded boolean NOT NULL DEFAULT false;
ALTER TABLE topics ADD COLUMN IF NOT EXISTS is_demo boolean NOT NULL DEFAULT false;
ALTER TABLE people ADD COLUMN IF NOT EXISTS is_demo boolean NOT NULL DEFAULT false;
ALTER TABLE pnotes ADD COLUMN IF NOT EXISTS is_demo boolean NOT NULL DEFAULT false;

-- Kad je zadatak završen (za statistiku i „gotovo nedavno“). Stari gotovi zadaci dobiju datum nastanka kao procjenu.
ALTER TABLE tasks ADD COLUMN IF NOT EXISTS completed_at timestamptz;
UPDATE tasks SET completed_at = created_at WHERE status = 'done' AND completed_at IS NULL;

-- Tajna poveznica za osobu kojoj se delegira (/z/TOKEN): vidi svoje zadatke, mijenja status, javlja se komentarom.
ALTER TABLE people ADD COLUMN IF NOT EXISTS share_token text;
CREATE UNIQUE INDEX IF NOT EXISTS people_share_idx ON people (share_token);

-- Bilješka koju je napisala sama osoba preko svoje poveznice („javljanje“); seen = vlasnik ju je vidio.
ALTER TABLE notes ADD COLUMN IF NOT EXISTS from_person boolean NOT NULL DEFAULT false;
ALTER TABLE notes ADD COLUMN IF NOT EXISTS seen boolean NOT NULL DEFAULT true;

-- Push obavijesti (Web Push) po uređaju korisnika.
CREATE TABLE IF NOT EXISTS push_subs (
  id         serial PRIMARY KEY,
  user_id    int NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  endpoint   text NOT NULL UNIQUE,
  p256dh     text NOT NULL,
  auth       text NOT NULL,
  created_at timestamptz DEFAULT now()
);
CREATE INDEX IF NOT EXISTS push_subs_user_idx ON push_subs (user_id);
