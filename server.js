// Trouvaille — serveur local sans dépendance (Node ≥ 20).
import http from 'node:http';
import { readFile, writeFile, mkdir, unlink, rename } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { getProvider } from './providers/index.js';
import { vintedSearchUrl } from './public/vinted.js';

const ROOT = path.dirname(fileURLToPath(import.meta.url));
const PUBLIC = path.join(ROOT, 'public');

const TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.webmanifest': 'application/manifest+json',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.webp': 'image/webp',
  '.svg': 'image/svg+xml',
};
const IMAGE_EXT = { 'image/jpeg': '.jpg', 'image/png': '.png', 'image/webp': '.webp' };

export async function createApp({ dataDir = process.env.DATA_DIR || path.join(ROOT, 'data'), provider } = {}) {
  const imagesDir = path.join(dataDir, 'images');
  const dbFile = path.join(dataDir, 'db.json');
  await mkdir(imagesDir, { recursive: true });
  const ai = provider || (await getProvider());

  let db = { inspirations: [], wishlist: [], settings: { size: '', budget: '' } };
  if (existsSync(dbFile)) db = { ...db, ...JSON.parse(await readFile(dbFile, 'utf8')) };
  let saving = Promise.resolve();
  const save = () =>
    (saving = saving.then(async () => {
      const tmp = `${dbFile}.tmp`;
      await writeFile(tmp, JSON.stringify(db, null, 2));
      await rename(tmp, dbFile);
    }));

  const withLinks = (insp) => ({
    ...insp,
    recherches: (insp.analysis?.recherches || [])
      .slice()
      .sort((a, b) => (b.proximite ?? 0) - (a.proximite ?? 0))
      .map((r) => ({ ...r, url: vintedSearchUrl(r.requete, { budget: db.settings.budget }) })),
  });

  const routes = {
    'GET /api/status': async () => ({ provider: ai.name, settings: db.settings }),

    'PUT /api/settings': async ({ body }) => {
      db.settings = { size: String(body.size ?? '').slice(0, 20), budget: String(body.budget ?? '').replace(/[^\d]/g, '') };
      await save();
      return db.settings;
    },

    'GET /api/inspirations': async () => db.inspirations.map(withLinks),

    // body : { image: dataURL, notes?, board? }
    'POST /api/analyze': async ({ body }) => {
      const m = /^data:(image\/(?:jpeg|png|webp));base64,(.+)$/s.exec(body.image || '');
      if (!m) throw httpError(400, 'Image manquante ou format non pris en charge (jpg, png, webp)');
      const buf = Buffer.from(m[2], 'base64');
      if (buf.length > 8 * 1024 * 1024) throw httpError(413, 'Image trop lourde (8 Mo max)');
      const id = crypto.randomUUID();
      const file = id + IMAGE_EXT[m[1]];
      const imagePath = path.join(imagesDir, file);
      await writeFile(imagePath, buf);
      const notes = String(body.notes || '').slice(0, 300);
      let analysis;
      try {
        analysis = await ai.analyze({ imagePath, notes, size: db.settings.size, budget: db.settings.budget });
      } catch (e) {
        await unlink(imagePath).catch(() => {});
        throw httpError(502, `Analyse impossible : ${e.message}`);
      }
      const insp = {
        id,
        image: `/images/${file}`,
        board: String(body.board || 'Mes inspis').slice(0, 40),
        notes,
        analysis,
        createdAt: new Date().toISOString(),
      };
      db.inspirations.unshift(insp);
      await save();
      return withLinks(insp);
    },

    'PATCH /api/inspirations/:id': async ({ params, body }) => {
      const insp = db.inspirations.find((i) => i.id === params.id);
      if (!insp) throw httpError(404, 'Inspiration introuvable');
      if (body.board != null) insp.board = String(body.board).slice(0, 40) || 'Mes inspis';
      await save();
      return withLinks(insp);
    },

    'DELETE /api/inspirations/:id': async ({ params }) => {
      const insp = db.inspirations.find((i) => i.id === params.id);
      if (!insp) throw httpError(404, 'Inspiration introuvable');
      db.inspirations = db.inspirations.filter((i) => i !== insp);
      await unlink(path.join(imagesDir, path.basename(insp.image))).catch(() => {});
      await save();
      return { ok: true };
    },

    'GET /api/wishlist': async () => db.wishlist,

    // body : { url, title, price?, size?, inspirationId?, note? }
    'POST /api/wishlist': async ({ body }) => {
      const url = String(body.url || '').trim();
      if (!/^https?:\/\//.test(url)) throw httpError(400, 'Lien invalide');
      const item = {
        id: crypto.randomUUID(),
        url,
        title: String(body.title || '').slice(0, 120) || 'Trouvaille',
        price: body.price === '' || body.price == null ? null : Number(String(body.price).replace(',', '.')) || null,
        size: String(body.size || '').slice(0, 20),
        note: String(body.note || '').slice(0, 300),
        inspirationId: body.inspirationId || null,
        status: 'repérée',
        createdAt: new Date().toISOString(),
      };
      db.wishlist.unshift(item);
      await save();
      return item;
    },

    'PATCH /api/wishlist/:id': async ({ params, body }) => {
      const item = db.wishlist.find((w) => w.id === params.id);
      if (!item) throw httpError(404, 'Article introuvable');
      if (['repérée', 'achetée', 'abandonnée'].includes(body.status)) item.status = body.status;
      await save();
      return item;
    },

    'DELETE /api/wishlist/:id': async ({ params }) => {
      db.wishlist = db.wishlist.filter((w) => w.id !== params.id);
      await save();
      return { ok: true };
    },
  };

  const compiled = Object.entries(routes).map(([key, handler]) => {
    const [method, pattern] = key.split(' ');
    const names = [];
    const re = new RegExp('^' + pattern.replace(/:(\w+)/g, (_, n) => (names.push(n), '([^/]+)')) + '$');
    return { method, re, names, handler };
  });

  async function handle(req, res) {
    const url = new URL(req.url, 'http://localhost');
    try {
      if (url.pathname.startsWith('/api/')) {
        for (const r of compiled) {
          const m = req.method === r.method && r.re.exec(url.pathname);
          if (!m) continue;
          const params = Object.fromEntries(r.names.map((n, i) => [n, decodeURIComponent(m[i + 1])]));
          const body = ['POST', 'PUT', 'PATCH'].includes(req.method) ? await readJson(req) : {};
          return sendJson(res, 200, await r.handler({ params, body }));
        }
        throw httpError(404, 'Route inconnue');
      }
      if (url.pathname.startsWith('/images/')) {
        return await sendFile(res, path.join(imagesDir, path.basename(url.pathname)));
      }
      const rel = url.pathname === '/' ? 'index.html' : path.normalize(url.pathname).replace(/^([/\\])+/, '');
      const file = path.join(PUBLIC, rel);
      if (!file.startsWith(PUBLIC)) throw httpError(403, 'Interdit');
      return await sendFile(res, file);
    } catch (e) {
      const status = e.status || 500;
      if (status === 500) console.error(e);
      if (url.pathname.startsWith('/api/')) return sendJson(res, status, { error: e.message });
      res.writeHead(status, { 'content-type': 'text/plain; charset=utf-8' }).end(e.message);
    }
  }

  return { handle, db: () => db, flush: () => saving };
}

function httpError(status, message) {
  return Object.assign(new Error(message), { status });
}

async function readJson(req) {
  const chunks = [];
  let size = 0;
  for await (const c of req) {
    size += c.length;
    if (size > 12 * 1024 * 1024) throw httpError(413, 'Requête trop lourde');
    chunks.push(c);
  }
  if (!chunks.length) return {};
  try {
    return JSON.parse(Buffer.concat(chunks).toString('utf8'));
  } catch {
    throw httpError(400, 'JSON invalide');
  }
}

function sendJson(res, status, data) {
  res.writeHead(status, { 'content-type': TYPES['.json'], 'cache-control': 'no-store' });
  res.end(JSON.stringify(data));
}

async function sendFile(res, file) {
  let buf;
  try {
    buf = await readFile(file);
  } catch {
    throw httpError(404, 'Introuvable');
  }
  res.writeHead(200, { 'content-type': TYPES[path.extname(file).toLowerCase()] || 'application/octet-stream' });
  res.end(buf);
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const port = Number(process.env.PORT || 5180);
  const host = process.env.HOST || '127.0.0.1';
  const app = await createApp();
  http.createServer(app.handle).listen(port, host, () => {
    console.log(`Trouvaille tourne sur http://${host === '0.0.0.0' ? 'localhost' : host}:${port}`);
    console.log(`Fournisseur IA : ${process.env.AI_PROVIDER || 'claude-cli'}`);
  });
}
