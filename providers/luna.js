// Fournisseur : Luna, ton IA personnelle (à brancher plus tard).
//
// Contrat attendu : LUNA_URL reçoit un POST JSON
//   { prompt, image: { mime, base64 }, schema }
// et répond avec un objet JSON conforme à ANALYSIS_SCHEMA (voir providers/index.js),
// soit directement, soit dans { analysis: {...} }.
// En-tête optionnel : Authorization: Bearer $LUNA_TOKEN
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { ANALYSIS_SCHEMA, buildPrompt } from './index.js';

const MIME = { '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.png': 'image/png', '.webp': 'image/webp' };

export default {
  name: 'luna',
  async analyze({ imagePath, ...opts }) {
    const url = process.env.LUNA_URL;
    if (!url) throw new Error('Luna n’est pas encore configurée : définis LUNA_URL');
    const base64 = (await readFile(imagePath)).toString('base64');
    const res = await fetch(url, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        ...(process.env.LUNA_TOKEN ? { authorization: `Bearer ${process.env.LUNA_TOKEN}` } : {}),
      },
      body: JSON.stringify({
        prompt: buildPrompt(opts),
        image: { mime: MIME[path.extname(imagePath).toLowerCase()] || 'image/jpeg', base64 },
        schema: ANALYSIS_SCHEMA,
      }),
      signal: AbortSignal.timeout(Number(process.env.LUNA_TIMEOUT_MS || 180000)),
    });
    if (!res.ok) throw new Error(`Luna a répondu ${res.status}`);
    const body = await res.json();
    return { ...(body.analysis ?? body), _meta: { provider: 'luna' } };
  },
};
