// Trouvaille — serveur local sans dépendance (Node ≥ 20).
import http from 'node:http';
import { readFile, writeFile, mkdir, unlink, rename } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { getProvider } from './providers/index.js';
import { vintedSearchUrl, parseVintedLabel } from './public/vinted.js';
import { pinterestStore, pinterestClient, authorizeUrl, exchangeCode, fetchPublicBoard } from './lib/pinterest.js';
import { downloadImage } from './lib/images.js';

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
const DEFAULT_BOARD = 'Mes inspis';

export async function createApp({
  dataDir = process.env.DATA_DIR || path.join(ROOT, 'data'),
  provider,
  publicOrigin = process.env.PUBLIC_ORIGIN || `http://localhost:${process.env.PORT || 5180}`,
  pinterest: pinterestOverride,
  publicBoardFetcher = fetchPublicBoard,
  imageDownloader = downloadImage,
} = {}) {
  const imagesDir = path.join(dataDir, 'images');
  const dbFile = path.join(dataDir, 'db.json');
  await mkdir(imagesDir, { recursive: true });
  const ai = provider || (await getProvider());
  const pinStore = pinterestStore(path.join(dataDir, 'pinterest.json'));
  const pinApi = pinterestOverride || pinterestClient(pinStore);
  const redirectUri = `${publicOrigin}/auth/pinterest/callback`;
  const oauthStates = new Set();

  let db = { inspirations: [], wishlist: [], settings: { size: '', budget: '' } };
  if (existsSync(dbFile)) db = { ...db, ...JSON.parse(await readFile(dbFile, 'utf8')) };
  let saving = Promise.resolve();
  const save = () =>
    (saving = saving.then(async () => {
      const tmp = `${dbFile}.tmp`;
      await writeFile(tmp, JSON.stringify(db, null, 2));
      await rename(tmp, dbFile);
    }));

  const findInsp = (id) => {
    const insp = db.inspirations.find((i) => i.id === id);
    if (!insp) throw httpError(404, 'Inspiration introuvable');
    return insp;
  };
  const imagePathOf = (insp) => path.join(imagesDir, path.basename(insp.image));

  const withLinks = (insp) => ({
    ...insp,
    finds: (insp.finds || []).slice().sort((a, b) => (b.score ?? -1) - (a.score ?? -1)),
    recherches: (insp.analysis?.recherches || [])
      .slice()
      .sort((a, b) => (b.proximite ?? 0) - (a.proximite ?? 0))
      .map((r) => ({ ...r, url: vintedSearchUrl(r.requete, { budget: db.settings.budget }) })),
  });

  async function analyzeInsp(insp, notes = insp.notes) {
    try {
      insp.analysis = await ai.analyze({ imagePath: imagePathOf(insp), notes, size: db.settings.size, budget: db.settings.budget });
    } catch (e) {
      throw httpError(502, `Analyse impossible : ${e.message}`);
    }
    await save();
    return withLinks(insp);
  }

  async function importPins(pins, board, source) {
    const known = new Set(db.inspirations.map((i) => i.pinId).filter(Boolean));
    let added = 0;
    let skipped = 0;
    let failed = 0;
    for (const pin of pins) {
      if (known.has(pin.pinId)) { skipped++; continue; }
      const id = crypto.randomUUID();
      try {
        const ext = await imageDownloader(pin.image, path.join(imagesDir, id));
        db.inspirations.unshift({
          id,
          image: `/images/${id}${ext}`,
          board: String(board || DEFAULT_BOARD).slice(0, 40),
          notes: '',
          analysis: null,
          source,
          pinId: pin.pinId,
          pinUrl: pin.link,
          pinTitle: String(pin.title || '').slice(0, 200),
          createdAt: new Date().toISOString(),
        });
        known.add(pin.pinId);
        added++;
      } catch {
        failed++;
      }
    }
    await save();
    return { added, skipped, failed, board };
  }

  const routes = {
    'GET /api/status': async () => ({ provider: ai.name, settings: db.settings, origin: publicOrigin }),

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
      await writeFile(path.join(imagesDir, file), buf);
      const insp = {
        id,
        image: `/images/${file}`,
        board: String(body.board || DEFAULT_BOARD).slice(0, 40),
        notes: String(body.notes || '').slice(0, 300),
        analysis: null,
        source: 'upload',
        createdAt: new Date().toISOString(),
      };
      try {
        insp.analysis = await ai.analyze({ imagePath: path.join(imagesDir, file), notes: insp.notes, size: db.settings.size, budget: db.settings.budget });
      } catch (e) {
        await unlink(path.join(imagesDir, file)).catch(() => {});
        throw httpError(502, `Analyse impossible : ${e.message}`);
      }
      db.inspirations.unshift(insp);
      await save();
      return withLinks(insp);
    },

    // (Ré)analyse une inspiration existante, ex. une épingle importée.
    'POST /api/inspirations/:id/analyze': async ({ params, body }) => {
      const insp = findInsp(params.id);
      if (body.notes != null) insp.notes = String(body.notes).slice(0, 300);
      return analyzeInsp(insp);
    },

    'PATCH /api/inspirations/:id': async ({ params, body }) => {
      const insp = findInsp(params.id);
      if (body.board != null) insp.board = String(body.board).slice(0, 40) || DEFAULT_BOARD;
      await save();
      return withLinks(insp);
    },

    'DELETE /api/inspirations/:id': async ({ params }) => {
      const insp = findInsp(params.id);
      db.inspirations = db.inspirations.filter((i) => i !== insp);
      await unlink(imagePathOf(insp)).catch(() => {});
      await save();
      return { ok: true };
    },

    /* ----- Pièces trouvées sur Vinted (envoyées par le favori) ----- */
    // body : { items: [{ id, url, photo, label }] }
    'POST /api/inspirations/:id/finds': async ({ params, body }) => {
      const insp = findInsp(params.id);
      insp.finds ||= [];
      const known = new Set(insp.finds.map((f) => f.id));
      let added = 0;
      for (const raw of (Array.isArray(body.items) ? body.items : []).slice(0, 100)) {
        const id = String(raw.id || '').replace(/\D/g, '');
        const url = String(raw.url || '');
        const photo = String(raw.photo || '');
        if (!id || known.has(id)) continue;
        if (!/^https:\/\/www\.vinted\.[a-z.]+\/items\//.test(url)) continue;
        if (!/^https:\/\/[a-z0-9.-]+\.vinted\.net\//.test(photo)) continue;
        const label = String(raw.label || '').slice(0, 400);
        insp.finds.push({ id, url, photo, label, ...parseVintedLabel(label), score: null, raison: '', addedAt: new Date().toISOString() });
        known.add(id);
        added++;
      }
      await save();
      return { added, inspiration: withLinks(insp) };
    },

    'DELETE /api/inspirations/:id/finds/:fid': async ({ params }) => {
      const insp = findInsp(params.id);
      insp.finds = (insp.finds || []).filter((f) => f.id !== params.fid);
      await save();
      return withLinks(insp);
    },

    // Classe les pièces trouvées par ressemblance avec l'inspiration.
    'POST /api/inspirations/:id/rank': async ({ params }) => {
      const insp = findInsp(params.id);
      const finds = insp.finds || [];
      if (!finds.length) throw httpError(400, 'Aucune pièce à classer : envoie d’abord des annonces depuis Vinted');
      if (!ai.rank) throw httpError(501, `Le fournisseur ${ai.name} ne sait pas classer les pièces`);
      let ranking;
      try {
        ranking = await ai.rank({ imagePath: imagePathOf(insp), analysis: insp.analysis, items: finds.map((f) => ({ id: f.id, label: f.label })) });
      } catch (e) {
        throw httpError(502, `Classement impossible : ${e.message}`);
      }
      const byId = new Map(ranking.map((r) => [String(r.id), r]));
      for (const f of finds) {
        const r = byId.get(f.id);
        if (r) { f.score = Math.max(0, Math.min(100, Math.round(r.score))); f.raison = String(r.raison || '').slice(0, 200); }
      }
      await save();
      return withLinks(insp);
    },

    /* ----- Wishlist ----- */
    'GET /api/wishlist': async () => db.wishlist,

    // body : { url, title, price?, size?, inspirationId?, note?, photo? }
    'POST /api/wishlist': async ({ body }) => {
      const url = String(body.url || '').trim();
      if (!/^https?:\/\//.test(url)) throw httpError(400, 'Lien invalide');
      const existing = db.wishlist.find((w) => w.url === url);
      if (existing) return existing;
      const photo = String(body.photo || '');
      const item = {
        id: crypto.randomUUID(),
        url,
        title: String(body.title || '').slice(0, 120) || 'Trouvaille',
        price: body.price === '' || body.price == null ? null : Number(String(body.price).replace(',', '.')) || null,
        size: String(body.size || '').slice(0, 20),
        note: String(body.note || '').slice(0, 300),
        photo: /^https:\/\/[a-z0-9.-]+\.vinted\.net\//.test(photo) ? photo : '',
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

    /* ----- Pinterest ----- */
    'GET /api/pinterest/status': async () => {
      const s = await pinStore.get();
      return { configured: Boolean(s.clientId && s.clientSecret), connected: Boolean(s.accessToken), username: s.username || null, clientId: s.clientId || '', redirectUri };
    },

    // body : { clientId, clientSecret } — identifiants de TON app Pinterest (développeur).
    'PUT /api/pinterest/config': async ({ body }) => {
      const clientId = String(body.clientId || '').trim();
      const clientSecret = String(body.clientSecret || '').trim();
      if (!/^\d{4,}$/.test(clientId)) throw httpError(400, 'L’App ID Pinterest est un nombre');
      if (clientSecret.length < 10) throw httpError(400, 'Clé secrète manquante');
      await pinStore.update({ clientId, clientSecret });
      return { ok: true };
    },

    'DELETE /api/pinterest/config': async () => {
      await pinStore.clear(['clientId', 'clientSecret', 'accessToken', 'refreshToken', 'expiresAt', 'username']);
      return { ok: true };
    },

    'DELETE /api/pinterest/connection': async () => {
      await pinStore.clear(['accessToken', 'refreshToken', 'expiresAt', 'username']);
      return { ok: true };
    },

    'GET /api/pinterest/boards': async () => pinApi.boards(),

    // body : { boardId, boardName, max? }
    'POST /api/pinterest/import': async ({ body }) => {
      if (!body.boardId) throw httpError(400, 'Tableau manquant');
      const pins = await pinApi.boardPins(String(body.boardId), Math.min(Number(body.max) || 200, 500));
      return importPins(pins, body.boardName, 'pinterest');
    },

    // body : { url } — tableau PUBLIC, sans connexion (25 dernières épingles environ)
    'POST /api/pinterest/import-public': async ({ body }) => {
      const { boardName, pins } = await publicBoardFetcher(body.url);
      if (!pins.length) throw httpError(404, 'Aucune épingle trouvée dans ce tableau');
      return importPins(pins, body.board || boardName, 'pinterest-public');
    },
  };

  /* ----- OAuth Pinterest (pages, pas JSON) ----- */
  async function oauthStart(res) {
    const s = await pinStore.get();
    if (!s.clientId) return redirect(res, '/?pinterest=config');
    const stateToken = crypto.randomBytes(16).toString('hex');
    oauthStates.add(stateToken);
    setTimeout(() => oauthStates.delete(stateToken), 10 * 60_000).unref();
    redirect(res, authorizeUrl({ clientId: s.clientId, redirectUri, stateToken }));
  }

  async function oauthCallback(res, url) {
    const code = url.searchParams.get('code');
    const stateToken = url.searchParams.get('state');
    if (!code || !oauthStates.delete(stateToken)) return redirect(res, '/?pinterest=erreur');
    try {
      const s = await pinStore.get();
      const tokens = await exchangeCode(s, code, redirectUri);
      await pinStore.update(tokens);
      const me = await pinApi.me().catch(() => null);
      if (me?.username) await pinStore.update({ username: me.username });
      redirect(res, '/?pinterest=ok');
    } catch (e) {
      console.error(e);
      redirect(res, '/?pinterest=erreur');
    }
  }

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
      if (url.pathname === '/auth/pinterest') return await oauthStart(res);
      if (url.pathname === '/auth/pinterest/callback') return await oauthCallback(res, url);
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
      if (res.headersSent) return res.end();
      if (url.pathname.startsWith('/api/')) return sendJson(res, status, { error: e.message });
      res.writeHead(status, { 'content-type': 'text/plain; charset=utf-8' }).end(e.message);
    }
  }

  return { handle, db: () => db, flush: () => saving };
}

function httpError(status, message) {
  return Object.assign(new Error(message), { status });
}

function redirect(res, location) {
  res.writeHead(302, { location }).end();
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
  const app = await createApp();
  // Par défaut : uniquement cet ordinateur, en IPv4 ET IPv6 (« localhost » peut viser l'un ou l'autre).
  const hosts = process.env.HOST ? [process.env.HOST] : ['127.0.0.1', '::1'];
  for (const host of hosts) {
    http.createServer(app.handle)
      .on('error', (e) => { if (hosts.length === 1 || host === '127.0.0.1') throw e; })
      .listen(port, host);
  }
  console.log(`Trouvaille tourne sur http://localhost:${port}`);
  console.log(`Fournisseur IA : ${process.env.AI_PROVIDER || 'claude-cli'}`);
}
