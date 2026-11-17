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
