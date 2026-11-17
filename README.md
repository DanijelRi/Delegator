# ✅ Delegator

Teme → zadaci → ljudi → bilješke za svaku osobu. Diktiranje glasom na hrvatskom. Baza: Neon Postgres.

## Što zna
- **Više korisnika na pozivnice:** svatko ima svoje teme, zadatke i ljude. Administrator u kartici „Korisnici“ radi pozivnice i poveznice za novu lozinku.
- **✉️ Pošalji mailom:** zadatak s bilješkama ili popis zadataka osobe otvara se u tvom programu za poštu i šalje s tvoje adrese.
- **Teme** (s bojom, arhiviranje) i neograničen broj zadataka i bilješki.
- **Zadaci:** status (klik na oznaku: Za napraviti → U tijeku → Gotovo), prioritet, rok (crveno kad kasni), više ljudi po zadatku.
- **Ljudi:** popis jednom, onda ih samo klikneš na zadatak. Ako u naslovu napišeš/izdiktiraš ime („Ivanu reci…“), osoba se sama označi.
- **Bilješke po osobi** unutar svakog zadatka + opće bilješke. Enter = spremi.
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
