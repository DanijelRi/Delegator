# Delegator

Aplikacija za delegiranje zadataka: **Tema → Zadatak → Ljudi (više njih) → Bilješke po osobi**.
Više korisnika (kolege, prijatelji) na pozivnice; svaki ima svoje teme, zadatke, ljude i bilješke i ne vidi tuđe. Sučelje je na **hrvatskom** — sav tekst u UI-ju, poruke grešaka i komentari ostaju na hrvatskom.

## Stack
- **Frontend:** jedan `index.html` (vanilla JS, bez build koraka, bez frameworka). Stanje u objektu `S`, cijeli prikaz se ponovno iscrtava funkcijom `render()`; događaji idu preko delegacije (`data-act`, `data-form`).
- **Backend:** Vercel funkcije u `api/`:
  - `api/data.js` — podaci prijavljenog korisnika. `GET` vraća sve, `POST {op, ...}` izvrši operaciju (objekt `ops`) i vrati sve.
  - `api/auth.js` — prijava, registracija na pozivnicu, nova lozinka, administracija korisnika.
  - `api/parse.js` — AI brzi unos.
  - `api/_lib.js` — zajedničko (baza, lozinke, sesije); `_` znači da nije zasebna funkcija.
- **Baza:** Neon Postgres, projekt `steep-meadow-16497259` ("my-first-project", eu-central-1), baza `neondb`. Shema u `schema.sql`, primjenjuje se s `npm run migrate` (na bazu iz `DATABASE_URL`). Driver `@neondatabase/serverless` (`neon()` tagged template — uvijek parametrizirano, nikad spajanje stringova u SQL).
- **AI brzi unos:** `api/parse.js` šalje izdiktiranu rečenicu (+ popis ljudi, tema, današnji datum u Europe/Zagreb) na Vercel AI Gateway (OpenAI-kompatibilni `chat/completions`, prisilni tool call `predlozi_zadatak`). Model: env `AI_GATEWAY_MODEL`, zadano `anthropic/claude-haiku-5.5`; na Vercelu je trenutno postavljen `openai/gpt-4.1-mini` jer besplatna razina Gatewaya ne daje Claude modele. Auth: `AI_GATEWAY_API_KEY` lokalno; na Vercelu OIDC token iz zaglavlja `x-vercel-oidc-token` (u produkciji ga nema u env varijabli). Dnevni limit po korisniku: env `AI_DAILY_LIMIT` (zadano 40), brojač u tablici `ai_usage`. `normalize()` spaja imena s postojećim ljudima (i padeže: Marku → Marko). Endpoint NIŠTA ne sprema — korisnik pregleda prijedlog u dijalogu (`quickStep1/quickStep2` u `index.html`), a sprema se op `quickAdd` u `api/data.js` (nova tema + nove osobe + zadatak + bilješke odjednom).
- **Glas u tekst:** Web Speech API u pregledniku, `lang = 'hr-HR'` (`toggleMic`, `micBtn`). Radi u Chromeu, Edgeu i Safariju; u Firefoxu gumb 🎤 se ne prikazuje.
- **Korisnici i prijava** (vlastita, bez vanjskog servisa): tablice `users`, `sessions`, `invites`. Lozinke scrypt (`node:crypto`), sesija je HttpOnly kolačić `sid` (60 dana), u bazi samo SHA-256 sažetak tokena. POST mora biti `application/json` (uz `SameSite=Lax` štiti od CSRF-a).
  - Registracija samo preko pozivnice (`?pozivnica=TOKEN`, 7 dana, jednokratna) koju radi administrator u kartici „Korisnici“.
  - Prvo postavljanje: dok nema korisnika, prvi se registrira s kodom = env `APP_PASSWORD`, postaje administrator i preuzima stare podatke bez vlasnika (`user_id IS NULL`).
  - Zaboravljena lozinka: administrator napravi poveznicu `?reset=TOKEN` (24 h).
- **Izolacija podataka:** svaka tablica s podacima ima `user_id`; SVAKI upit u `api/data.js` i `api/parse.js` filtrira po `user_id` prijavljenog korisnika, a izmjene koje povezuju retke (zadatak↔tema, bilješka↔zadatak/osoba) prvo provjere vlasništvo (`own.*`, `myPeople`).
- **Slanje mailom:** `mailto:` poveznica otvara korisnikov program za poštu, pa mail ide s njegove adrese (`openMail`, `mailTask` u `index.html`). Osobe imaju polje `email`.
- **Pretraga:** kroz sve teme, bez obzira na velika slova i kvačice (`fold`), duže riječi bez zadnjeg slova radi padeža (`terms`), pogoci označeni s `<mark>` (`hl`).

## Pokretanje
```bash
npm install
cp .env.example .env      # upiši DATABASE_URL iz Neon konzole
npm run migrate           # primijeni schema.sql
npm run dev               # http://localhost:3000 (dev-server.mjs, bez Vercel CLI-ja)
```
Deploy: `vercel --prod` (projekt `delegator`, regija fra1, https://delegator-psi.vercel.app) + env varijable `DATABASE_URL` i `APP_PASSWORD`.

## Pravila
- Dodavanje nove operacije: dodaj je u `ops` u `api/data.js` (uvijek s `user_id = ${uid}` i provjerom vlasništva povezanih redaka), pa u frontendu pozovi `run('imeOperacije', {...})`.
- Promjene sheme: dopiši ih u `schema.sql` (idempotentno: `IF NOT EXISTS`, `ADD COLUMN IF NOT EXISTS`) i primijeni na Neon. Za rizične promjene prvo Neon branch.
- Datumi (`due_date`) putuju kao tekst `YYYY-MM-DD` (`to_char` u upitu) da izbjegnemo pomake vremenske zone.
- Ništa destruktivno nad produkcijskom bazom bez pitanja.

## Ideje za dalje (redoslijed po korisnosti)
1. ✅ ~~Glasovni brzi unos uz AI~~ (gotovo). Moguća nadogradnja: više zadataka iz jedne rečenice.
2. Podsjetnici: dnevni mail/push s rokovima koji ističu (Vercel Cron).
3. ✅ ~~Više korisnika na pozivnice~~ (gotovo). Dalje: ljudi kojima se delegira vide i označavaju svoje zadatke; slanje maila iz aplikacije (Resend, treba vlastita domena).
4. Prilozi (slike, PDF) uz bilješke.
5. Drag & drop redoslijed zadataka, Kanban prikaz po statusu.
6. PWA (instalacija na mobitel, offline čitanje).
