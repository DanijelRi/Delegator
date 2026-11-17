// Lokalni server bez Vercel CLI-ja: `npm run dev` → http://localhost:3000
import http from 'node:http';
import { readFile } from 'node:fs/promises';
import data from './api/data.js';
import parse from './api/parse.js';
import auth from './api/auth.js';

const port = process.env.PORT || 3000;
http.createServer(async (req, res) => {
  const routes = { '/api/data': data, '/api/parse': parse, '/api/auth': auth };
  const handler = routes[req.url.split('?')[0]];
  if (handler) {
    let raw = '';
    for await (const chunk of req) raw += chunk;
    req.body = raw ? JSON.parse(raw) : {};
    res.status = (code) => { res.statusCode = code; return res; };
    res.json = (obj) => { res.setHeader('Content-Type', 'application/json'); res.end(JSON.stringify(obj)); };
    return handler(req, res);
  }
  res.setHeader('Content-Type', 'text/html; charset=utf-8');
  res.end(await readFile(new URL('./index.html', import.meta.url)));
}).listen(port, () => console.log(`Delegator: http://localhost:${port}`));
