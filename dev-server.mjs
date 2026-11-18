// Lokalni server bez Vercel CLI-ja: `npm run dev` → http://localhost:3000
import http from 'node:http';
import { readFile } from 'node:fs/promises';
import data from './api/data.js';
import parse from './api/parse.js';
import auth from './api/auth.js';
import ical from './api/ical.js';
import files from './api/files.js';

const port = process.env.PORT || 3000;
http.createServer(async (req, res) => {
  const routes = { '/api/data': data, '/api/parse': parse, '/api/auth': auth, '/api/ical': ical, '/api/files': files };
  const handler = routes[req.url.split('?')[0]];
  if (handler) {
    req.query = Object.fromEntries(new URL(req.url, 'http://x').searchParams);
    res.status = (code) => { res.statusCode = code; return res; };
    if (handler !== files) { // prilozi čitaju tijelo sami, kao tok bajtova
      let raw = '';
      for await (const chunk of req) raw += chunk;
      req.body = raw ? JSON.parse(raw) : {};
    }
    res.json = (obj) => { res.setHeader('Content-Type', 'application/json'); res.end(JSON.stringify(obj)); };
    return handler(req, res);
  }
  // statične datoteke: biblioteke (vidi `npm run vendor`), ikone, manifest i service worker
  const path = req.url.split('?')[0];
  const m = path.match(/^\/((?:vendor|icons)\/[\w.-]+\.(?:js|png|svg)|sw\.js|manifest\.webmanifest)$/);
  if (m) {
    const types = { js: 'text/javascript; charset=utf-8', png: 'image/png', svg: 'image/svg+xml', webmanifest: 'application/manifest+json' };
    try {
      const body = await readFile(new URL(`./${m[1]}`, import.meta.url));
      res.setHeader('Content-Type', types[m[1].split('.').pop()]);
      return res.end(body);
    } catch { res.statusCode = 404; return res.end(); }
  }
  res.setHeader('Content-Type', 'text/html; charset=utf-8');
  res.end(await readFile(new URL('./index.html', import.meta.url)));
}).listen(port, () => console.log(`Delegator: http://localhost:${port}`));
