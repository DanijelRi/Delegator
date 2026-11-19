# ✅ Delegator

Teme → zadaci → ljudi → bilješke za svaku osobu. Diktiranje glasom na hrvatskom. Baza: Neon Postgres.

## Što zna
- **🏠 Pregled:** što kasni, što je danas i u sljedećih 7 dana, opterećenost ljudi i napredak tema.
- **Podteme** bilo koje dubine (Sajam › Marketing › Tisak).
- **🗂 Ploča (Kanban):** Za napraviti / U tijeku / Gotovo — povuci karticu u drugi stupac.
- **📅 Kalendar:** mjesec, tjedan, popis; povuci zadatak na drugi dan za novi rok; višednevni zadaci (početak–rok); hrvatski blagdani.
- **🔁 Ponavljanje:** svaki dan / tjedan / 2 tjedna / mjesec / godinu — kad je gotov, sam se napravi sljedeći.
- **Pretplata na kalendar:** rokovi se sami pojavljuju u Google/Apple kalendaru (👤 → Rokovi u kalendaru).
- **📎 Prilozi:** PDF, fotografije i dokumenti uz zadatak, svaku bilješku i cijelu temu — gumb 📎, povlačenje datoteke ili lijepljenje snimke zaslona. Datoteke su privatne.
- **📝 Bilješke:** osobne bilješke (vidiš ih samo ti) s bojama, prikvačivanjem, diktiranjem i prilozima.
- **🕸 Mreža:** teme, zadaci, ljudi i bilješke kao jedan graf.
- **📲 Instalacija na mobitel** (PWA) i čitanje bez interneta.
- **Više korisnika na pozivnice:** svatko ima svoje teme, zadatke i ljude. Administrator u kartici „Korisnici“ radi pozivnice i poveznice za novu lozinku.
- **✉️ Pošalji mailom:** zadatak s bilješkama ili popis zadataka osobe otvara se u tvom programu za poštu i šalje s tvoje adrese.
- **Teme** (s bojom, arhiviranje) i neograničen broj zadataka i bilješki.
- **Zadaci:** status (klik na oznaku: Za napraviti → U tijeku → Gotovo), prioritet, rok (crveno kad kasni), više ljudi po zadatku.
- **Ljudi:** popis jednom, onda ih samo klikneš na zadatak. Ako u naslovu napišeš/izdiktiraš ime („Ivanu reci…“), osoba se sama označi.
- **Bilješke po osobi** unutar svakog zadatka + opće bilješke. Enter = spremi.
- **📷 Brzi unos s fotografijom ili PDF-om:** slikaj ili dodaj PDF računa, ponude, dopisa ili ploče sa sastanka — AI pročita iznos, rok, IBAN, dobavljača i predloži zadatak; datoteka se sprema kao prilog. Radi i sa skeniranim PDF-ovima.
- **⚡ Brzi unos uz AI:** izdiktiraj „Marko do petka naruči štand, budžet 2000“ → AI predloži temu, osobu, rok, prioritet i bilješke, ti provjeriš i spremiš. Na mobitelu plutajući 🎤 gumb odmah kreće slušati.
- **🎤 Diktiranje** u svim poljima (Chrome, Edge, Safari).
- **Po osobi:** svi zadaci jedne osobe kroz sve teme + „Kopiraj popis za slanje“ (gotov tekst za WhatsApp/mail).
- **Pretraga** kroz sve teme, zadatke, bilješke i imena — bez obzira na kvačice i padeže („stand“ nađe „štandu“), pogoci su označeni.

## Postavljanje
1. Baza je već napravljena na Neonu (`schema.sql`). U Neon konzoli: **Connect** → kopiraj connection string.
2. Lokalno:
   ```bash
   npm install
   cp .env.example .env   # zalijepi DATABASE_URL i APP_PASSWORD (+ AI_GATEWAY_API_KEY za brzi unos)
   npm run migrate        # primijeni schema.sql
   npm run dev            # http://localhost:3000
   ```
3. Online (Vercel): `npx vercel` u ovoj mapi, zatim u Vercel → Settings → Environment Variables dodaj `DATABASE_URL` i `APP_PASSWORD`, pa `npx vercel --prod`.
4. Prvo postavljanje: otvori aplikaciju, upiši ime, e-mail, lozinku i kao „kod za prvo postavljanje“ vrijednost `APP_PASSWORD`. Taj račun postaje administrator i šalje pozivnice ostalima.

Rad s Claude Codeom: otvori mapu i pokreni `claude` — upute za projekt su u `CLAUDE.md`.
