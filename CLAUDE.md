# Delegator

Aplikacija za delegiranje zadataka: **Tema → Zadatak → Ljudi (više njih) → Bilješke po osobi**.
Više korisnika (kolege, prijatelji) na pozivnice; svaki ima svoje teme, zadatke, ljude i bilješke i ne vidi tuđe. Sučelje je na **hrvatskom** — sav tekst u UI-ju, poruke grešaka i komentari ostaju na hrvatskom.

## Stack
- **Frontend:** jedan `index.html` (vanilla JS, bez build koraka, bez frameworka). Stanje u objektu `S`, cijeli prikaz se ponovno iscrtava funkcijom `render()`; događaji idu preko delegacije (`data-act`, `data-form`).
- **Backend:** Vercel funkcije u `api/`:
  - `api/data.js` — podaci prijavljenog korisnika. `GET` vraća sve, `POST {op, ...}` izvrši operaciju (objekt `ops`) i vrati sve.
  - `api/auth.js` — prijava, registracija na pozivnicu, nova lozinka, administracija korisnika.
  - `api/parse.js` — AI brzi unos.
  - `api/ical.js` — kalendar za pretplatu (Google/Apple): `GET /api/ical?t=TOKEN`, token u `users.ical_token` (op `getIcal` u `api/auth.js`, `reset` = nova poveznica).
  - `api/files.js` — prilozi: `POST ?task|note|topic|pnote=ID` (tijelo = datoteka, zaglavlje `x-file-name`), `POST ?thumb=ID` (sličica), `GET ?id=ID[&dl=1|&t=1]`, `DELETE ?id=ID`. Tijelo se čita kao tok bajtova (ne dirati `req.body`).
  - `api/guest.js` — stranica za osobu kojoj se delegira (`/z/TOKEN` → `guest.html`, rewrite u `vercel.json`): `GET ?t=` zadaci te osobe, `GET ?t=&file=` prilog, `POST {t, op: status|comment}`. Pristup samo zadacima na kojima je osoba; javljanje se sprema kao bilješka `from_person = true, seen = false` i šalje push vlasniku.
  - `api/push.js` + `api/_push.js` — Web Push (biblioteka `web-push` v4, imenovani izvozi), env `VAPID_PUBLIC_KEY`, `VAPID_PRIVATE_KEY`; pretplate u `push_subs`.
  - `api/cron.js` — Vercel Cron jednom dnevno (`vercel.json`, 06:00 UTC), zaštićen env `CRON_SECRET`: kopija baze (`api/_backup.js`, Blob `backups/`, 30 dana) i jutarnji push sažetak.
  - `api/backup.js` — administrator: popis, preuzimanje i ručna kopija.
  - `api/_files.js` — zajedničko slanje priloga (`streamAttachment`), koriste ga `files.js` i `guest.js`.
  - `api/_lib.js` — zajedničko (baza, lozinke, sesije); `_` znači da nije zasebna funkcija.
- **Baza:** Neon Postgres, projekt `steep-meadow-16497259` ("my-first-project", eu-central-1), baza `neondb`. Shema u `schema.sql`, primjenjuje se s `npm run migrate` (na bazu iz `DATABASE_URL`). Driver `@neondatabase/serverless` (`neon()` tagged template — uvijek parametrizirano, nikad spajanje stringova u SQL).
- **AI brzi unos:** `api/parse.js` šalje izdiktiranu rečenicu i/ili FOTOGRAFIJU (račun, ponuda, dopis, ploča; u pregledniku smanjena na 1600 px JPEG, `imageForAI`, šalje se kao data URL u `image`, OpenAI format `image_url`) i/ili PDF (`pdfForAI`, pdf.js iz `vendor/pdfjs/`, učitava se tek kad zatreba: PDF s tekstom → `doc_text`, skenirani → do 3 stranice kao slike u `images`; u pdf.js v6 zatvara se `loadingTask.destroy()`) (+ popis ljudi, tema, današnji datum u Europe/Zagreb) na Vercel AI Gateway (OpenAI-kompatibilni `chat/completions`, prisilni tool call `predlozi_zadatak`). Model: env `AI_GATEWAY_MODEL`, zadano `anthropic/claude-haiku-5.5`; na Vercelu je trenutno postavljen `openai/gpt-4.1-mini` jer besplatna razina Gatewaya ne daje Claude modele. Auth: `AI_GATEWAY_API_KEY` lokalno; na Vercelu OIDC token iz zaglavlja `x-vercel-oidc-token` (u produkciji ga nema u env varijabli). Dnevni limit po korisniku: env `AI_DAILY_LIMIT` (zadano 40), brojač u tablici `ai_usage`. `normalize()` spaja imena s postojećim ljudima (i padeže: Marku → Marko). Endpoint NIŠTA ne sprema — korisnik pregleda prijedlog u dijalogu (`quickStep1/quickStep2` u `index.html`), a sprema se op `quickAdd` u `api/data.js` (nova tema + nove osobe + zadatak + bilješke odjednom).
- **Glas u tekst:** Web Speech API u pregledniku, `lang = 'hr-HR'` (`toggleMic`, `micBtn`). Radi u Chromeu, Edgeu i Safariju; u Firefoxu gumb 🎤 se ne prikazuje.
- **Korisnici i prijava** (vlastita, bez vanjskog servisa): tablice `users`, `sessions`, `invites`. Lozinke scrypt (`node:crypto`), sesija je HttpOnly kolačić `sid` (60 dana), u bazi samo SHA-256 sažetak tokena. POST mora biti `application/json` (uz `SameSite=Lax` štiti od CSRF-a).
  - Registracija samo preko pozivnice (`?pozivnica=TOKEN`, 7 dana, jednokratna) koju radi administrator u kartici „Korisnici“.
  - Prvo postavljanje: dok nema korisnika, prvi se registrira s kodom = env `APP_PASSWORD`, postaje administrator i preuzima stare podatke bez vlasnika (`user_id IS NULL`).
  - Zaboravljena lozinka: administrator napravi poveznicu `?reset=TOKEN` (24 h).
- **Izolacija podataka:** svaka tablica s podacima ima `user_id`; SVAKI upit u `api/data.js` i `api/parse.js` filtrira po `user_id` prijavljenog korisnika, a izmjene koje povezuju retke (zadatak↔tema, bilješka↔zadatak/osoba) prvo provjere vlasništvo (`own.*`, `myPeople`).
- **Slanje mailom:** `mailto:` poveznica otvara korisnikov program za poštu, pa mail ide s njegove adrese (`openMail`, `mailTask` u `index.html`). Osobe imaju polje `email`.
- **Podteme:** `topics.parent_id` (stablo bilo koje dubine, `ON DELETE CASCADE`). Na poslužitelju `parentFor()` sprječava petlje; u sučelju `topicTree`, `topicSubtree`, `topicPath`, `topicOptions`.
- **Prikazi (kartice):** Pregled (`overviewView`), Teme, Ploča/Kanban (`boardView`, povlačenje mijenja status), Kalendar (`calendarView`: mjesec/tjedan/popis, povlačenje mijenja rok — op `setDue` pomiče i početak, hrvatski blagdani `hrHolidays`), Mreža (`networkView`/`drawNetwork`, cytoscape iz `vendor/`, učitava se tek kad se otvori).
- **Datum početka i ponavljanje:** `tasks.start_date` (višednevni zadaci, u kalendaru na svakom danu), `tasks.repeat` (`daily|weekly|biweekly|monthly|yearly`). Kad se zadatak koji se ponavlja označi gotovim (`setStatus`/`updateTask`), `spawnNext()` napravi sljedeći (isti ljudi, tema, opis; bez bilježaka) i makne `repeat` sa starog. `addPeriod()` postoji i na poslužitelju i u `index.html` — mora ostati isti.
- **PWA:** `manifest.webmanifest`, `icons/`, `sw.js` (ljuska aplikacije u spremniku; `/api/data` mreža-pa-spremnik → offline čitanje s oznakom `x-delegator-offline`; odjava briše spremnik `delegator-data`). Pri promjeni popisa datoteka u `sw.js` povećaj `VERSION`.
- **Prilozi:** datoteke su PRIVATNE u Vercel Blobu (spremište `delegator-prilozi`, fra1, env `BLOB_READ_WRITE_TOKEN`), u tablici `attachments` su samo podaci (pripadaju točno jednom: zadatku, bilješci zadatka, temi ili osobnoj bilješci). Preuzimanje uvijek ide kroz `api/files.js` uz provjeru vlasnika; HTML/SVG i slično se samo preuzimaju (nikad inline). Najviše 20 MB; fotografije se u pregledniku smanjuju na 2400 px (`shrinkImage`) i dobivaju sličicu 320 px (`uploadThumb`, `thumb_url`). Pri brisanju zadatka/teme/bilješke/korisnika brišu se i datoteke iz Bloba (`purge` u `api/data.js`) — novi kod koji briše retke s prilozima mora učiniti isto.
- **Osobne bilješke (kartica „Bilješke“):** tablica `pnotes` (naslov, tekst, boja, prikvačeno), samo za prijavljenog korisnika; `pnotesView`, opovi `addPnote/updatePnote/pinPnote/deletePnote`.
- **Dobrodošlica:** `users.onboarded`; dok je `false`, nakon prijave se otvara vodič (`TOUR`, `tourGo`, `showTour` — plutajuća kartica koja otvara kartice i ističe elemente klasom `.tour-hl`). Korak 1 nudi probne podatke: op `createDemo` (tema „Primjer: Sajam 2027“ s podtemama, osobe „(primjer)“, 6 zadataka, bilješka; sve s `is_demo = true`), `deleteDemo` ih briše zajedno s prilozima (traka `demoBanner`). Vodič i primjeri ponovno su dostupni u izborniku 👤.
- **Poveznice za osobe i javljanja:** `people.share_token` (op `shareLink`, `reset` = nova), `notes.from_person/seen` (op `markSeen`; otvaranje zadatka ih označi pročitanima), `tasks.completed_at` (postavlja se pri prelasku u „done“). U sučelju `shareDialog`, `newsSection`, značka na kartici Pregled.
- **Zapisnik → više zadataka:** `api/parse.js` s `multi: true` koristi alat `predlozi_zadatke` (do 15 zadataka); u sučelju `quickStepMulti` sprema redom preko `quickAdd` i usput spaja osobe/teme koje je napravio prethodni zadatak (bez duplikata). AI predlaže i `koraci` → `steps`.
- **Koraci (podzadaci):** tablica `subtasks` (opovi `addSub/toggleSub/renameSub/deleteSub`, `quickAdd.steps`); `spawnNext` kopira korake neoznačene; osoba ih označava na svojoj stranici (`op: 'sub'`).
- **Predlošci:** tablica `templates` (JSON: teme, zadaci s pomakom roka u danima, ljudi po imenu, koraci); `saveTemplate`, `useTemplate` (datum početka + pomak), `deleteTemplate`; u dijalogu „Nova tema“.
- **Sigurnosne kopije:** Neon Free nema automatskih kopija (samo 1 ručni snapshot + vraćanje 6 h unatrag), zato noćna JSON kopija u Blob. Vraćanje: kopiju učitati u NOVU Neon granu, ne preko produkcije.
- **Pretraga:** kroz sve teme, bez obzira na velika slova i kvačice (`fold`), duže riječi bez zadnjeg slova radi padeža (`terms`), pogoci označeni s `<mark>` (`hl`).

## Pokretanje
```bash
npm install
cp .env.example .env      # upiši DATABASE_URL iz Neon konzole
npm run migrate           # primijeni schema.sql
npm run dev               # http://localhost:3000 (dev-server.mjs, bez Vercel CLI-ja)
npm run vendor            # nakon nadogradnje cytoscapea ili pdfjs-dista: kopira ih u vendor/
vercel env pull .env.local  # BLOB_READ_WRITE_TOKEN za priloge (lokalno: node --env-file=.env --env-file=.env.local)
```
Deploy: `vercel --prod` (projekt `delegator`, regija fra1, https://delegator-psi.vercel.app) + env varijable `DATABASE_URL`, `APP_PASSWORD`, `AI_GATEWAY_MODEL`, `VAPID_PUBLIC_KEY`, `VAPID_PRIVATE_KEY`, `CRON_SECRET` (za Production I Preview) i `BLOB_READ_WRITE_TOKEN` (postavlja ga spajanje Blob spremišta).
Cloud sesije Claude Codea: okruženje „delegator“ ima dopuštene hostove za Neon, Vercel, živu aplikaciju, Blob spremište i AI Gateway. Lokalni test AI-ja: `vercel env pull .env.local` daje `VERCEL_OIDC_TOKEN` (vrijedi ~12 h) — pokreni server s `AI_GATEWAY_API_KEY=<taj token>` i `AI_GATEWAY_MODEL=openai/gpt-4.1-mini`.

## Git
- Repo: https://github.com/DanijelRi/delegator. `main` = ono što je na produkciji.
- Nove stvari na zasebnoj grani → pregledni deploy (`vercel deploy`) → korisnik isproba → spajanje u `main` → `vercel --prod`.
- Stabilne točke su grane `stabilno-vX.Y` (oznake/tagove proxy u cloud sesijama ne propušta).

## Pravila
- Dodavanje nove operacije: dodaj je u `ops` u `api/data.js` (uvijek s `user_id = ${uid}` i provjerom vlasništva povezanih redaka), pa u frontendu pozovi `run('imeOperacije', {...})`.
- Promjene sheme: dopiši ih u `schema.sql` (idempotentno: `IF NOT EXISTS`, `ADD COLUMN IF NOT EXISTS`) i primijeni na Neon. Za rizične promjene prvo Neon branch.
- Datumi (`due_date`) putuju kao tekst `YYYY-MM-DD` (`to_char` u upitu) da izbjegnemo pomake vremenske zone.
- Ništa destruktivno nad produkcijskom bazom bez pitanja.

## Ideje za dalje (redoslijed po korisnosti)
1. ✅ ~~Glasovni brzi unos uz AI; zapisnik → više zadataka; koraci; predlošci~~ (gotovo).
2. Podsjetnici: dnevni mail/push s rokovima koji ističu (Vercel Cron). ✅ Pretplata na kalendar već daje podsjetnike u Google/Apple kalendaru.
3. ✅ ~~Više korisnika na pozivnice; poveznica za osobe (vide i označavaju svoje zadatke); push obavijesti; noćne kopije~~ (gotovo). Dalje: slanje maila iz aplikacije (Resend, treba vlastita domena).
4. ✅ ~~Prilozi (slike, PDF) uz zadatke, bilješke, teme; osobne bilješke; fotografija i PDF u brzom unosu~~ (gotovo). Dalje: pregled PDF-a unutar aplikacije (pdf.js je već u `vendor/`).
5. ✅ ~~Kanban, kalendar, mreža, podteme, ponavljanje, datum početka, Pregled~~ (gotovo). Dalje: ručni redoslijed kartica.
6. ✅ ~~PWA~~ (gotovo). Dalje: promjene offline koje se pošalju kad se veza vrati.
