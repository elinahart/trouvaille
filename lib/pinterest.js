// Pinterest : connexion OAuth (API v5) + import de tableaux publics via leur flux RSS.
import { readFile, writeFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';

const API = 'https://api.pinterest.com/v5';
const AUTH = 'https://www.pinterest.com/oauth/';
export const SCOPES = 'boards:read,pins:read,user_accounts:read';

/* ---------- Stockage local (data/pinterest.json, jamais versionné) ---------- */
export function pinterestStore(file) {
  let state = null;
  const load = async () => {
    if (state) return state;
    state = existsSync(file) ? JSON.parse(await readFile(file, 'utf8')) : {};
    return state;
  };
  const save = async () => writeFile(file, JSON.stringify(state, null, 2), { mode: 0o600 });
  return {
    async get() { return load(); },
    async update(patch) { await load(); Object.assign(state, patch); await save(); return state; },
    async clear(keys) { await load(); for (const k of keys) delete state[k]; await save(); return state; },
  };
}

export function authorizeUrl({ clientId, redirectUri, stateToken }) {
  const p = new URLSearchParams({ client_id: clientId, redirect_uri: redirectUri, response_type: 'code', scope: SCOPES, state: stateToken });
  return `${AUTH}?${p}`;
}

async function tokenRequest({ clientId, clientSecret }, params) {
  const res = await fetch(`${API}/oauth/token`, {
    method: 'POST',
    headers: {
      authorization: 'Basic ' + Buffer.from(`${clientId}:${clientSecret}`).toString('base64'),
      'content-type': 'application/x-www-form-urlencoded',
    },
    body: new URLSearchParams(params),
  });
  const body = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(`Pinterest a refusé la connexion (${res.status}) ${body.message || ''}`.trim());
  return {
    accessToken: body.access_token,
    refreshToken: body.refresh_token ?? undefined,
    expiresAt: Date.now() + (body.expires_in ?? 3600) * 1000,
  };
}

export const exchangeCode = (creds, code, redirectUri) =>
  tokenRequest(creds, { grant_type: 'authorization_code', code, redirect_uri: redirectUri });

/** Client API qui rafraîchit le jeton tout seul si besoin. */
export function pinterestClient(store) {
  async function token() {
    const s = await store.get();
    if (!s.accessToken) throw Object.assign(new Error('Pinterest n’est pas connecté'), { status: 401 });
    if (s.expiresAt && s.expiresAt - Date.now() < 60_000 && s.refreshToken) {
      const t = await tokenRequest(s, { grant_type: 'refresh_token', refresh_token: s.refreshToken });
      await store.update({ ...t, refreshToken: t.refreshToken || s.refreshToken });
      return t.accessToken;
    }
    return s.accessToken;
  }
  async function get(path, params = {}) {
    const url = `${API}${path}?${new URLSearchParams(params)}`;
    const res = await fetch(url, { headers: { authorization: `Bearer ${await token()}` } });
    const body = await res.json().catch(() => ({}));
    if (!res.ok) throw Object.assign(new Error(`Pinterest : ${body.message || res.status}`), { status: res.status === 401 ? 401 : 502 });
    return body;
  }
  async function all(path, max = 500) {
    const items = [];
    let bookmark;
    do {
      const page = await get(path, { page_size: 100, ...(bookmark ? { bookmark } : {}) });
      items.push(...(page.items || []));
      bookmark = page.bookmark;
    } while (bookmark && items.length < max);
    return items.slice(0, max);
  }
  return {
    me: () => get('/user_account'),
    boards: async () =>
      (await all('/boards')).map((b) => ({
        id: b.id,
        name: b.name,
        pinCount: b.pin_count ?? null,
        privacy: b.privacy,
        cover: b.media?.image_cover_url || null,
      })),
    boardPins: async (boardId, max) => (await all(`/boards/${encodeURIComponent(boardId)}/pins`, max)).map(pinFromApi).filter((p) => p.image),
  };
}

export function pinFromApi(p) {
  const imgs = p.media?.images || {};
  const image = imgs['1200x']?.url || imgs['600x']?.url || imgs['400x300']?.url || p.media?.cover_image_url || null;
  return { pinId: String(p.id), title: p.title || p.description || '', image, link: `https://www.pinterest.com/pin/${p.id}/` };
}

/* ---------- Tableau public par lien (RSS) ---------- */
/** https://www.pinterest.fr/compte/tableau/ → https://www.pinterest.com/compte/tableau.rss */
export function boardRssUrl(input) {
  let u;
  try {
    u = new URL(String(input).trim());
  } catch {
    throw Object.assign(new Error('Lien Pinterest invalide'), { status: 400 });
  }
  if (!/(^|\.)pinterest\.[a-z.]+$/.test(u.hostname)) throw Object.assign(new Error('Ce n’est pas un lien Pinterest'), { status: 400 });
  const parts = u.pathname.split('/').filter(Boolean);
  if (parts.length < 1 || parts[0] === 'pin') throw Object.assign(new Error('Colle le lien d’un tableau (pinterest.com/compte/tableau)'), { status: 400 });
  const path = parts.length === 1 ? `${parts[0]}/feed.rss` : `${parts[0]}/${parts[1].replace(/\.rss$/, '')}.rss`;
  return { rss: `https://www.pinterest.com/${path}`, boardName: decodeURIComponent(parts[1] || parts[0]).replace(/-/g, ' ') };
}

const decode = (s) =>
  s.replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&amp;/g, '&');

export function parseBoardRss(xml) {
  const title = decode(/<channel>[\s\S]*?<title>([\s\S]*?)<\/title>/.exec(xml)?.[1] || '').trim();
  const pins = [];
  for (const [, item] of xml.matchAll(/<item>([\s\S]*?)<\/item>/g)) {
    const link = decode(/<link>([\s\S]*?)<\/link>/.exec(item)?.[1] || '').trim();
    const desc = decode(/<description>([\s\S]*?)<\/description>/.exec(item)?.[1] || '');
    const src = /<img[^>]+src="([^"]+)"/.exec(desc)?.[1];
    if (!src) continue;
    pins.push({
      pinId: /\/pin\/(\d+)/.exec(link)?.[1] || link,
      title: decode(/<title>([\s\S]*?)<\/title>/.exec(item)?.[1] || '').trim(),
      image: src.replace(/\/\d+x\//, '/736x/'),
      link,
    });
  }
  return { title, pins };
}

export async function fetchPublicBoard(input) {
  const { rss, boardName } = boardRssUrl(input);
  const res = await fetch(rss, { headers: { 'user-agent': 'Mozilla/5.0 (Trouvaille personal app)' } });
  if (res.status === 404) throw Object.assign(new Error('Tableau introuvable : il est peut-être secret ou le lien est faux'), { status: 404 });
  if (!res.ok) throw Object.assign(new Error(`Pinterest a répondu ${res.status}`), { status: 502 });
  const { title, pins } = parseBoardRss(await res.text());
  return { boardName: title || boardName, pins };
}
