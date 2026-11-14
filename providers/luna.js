// Fournisseur : Luna, ton IA personnelle (à brancher plus tard).
//
// Contrat attendu : LUNA_URL reçoit un POST JSON
//   { task: 'analyze' | 'rank', prompt, image: { mime, base64 }, schema }
// et répond avec un objet JSON conforme à `schema` :
//   - task 'analyze' → ANALYSIS_SCHEMA (directement, ou dans { analysis: {...} })
//   - task 'rank'    → RANK_SCHEMA, c.-à-d. { classement: [{ id, score, raison }] }
// En-tête optionnel : Authorization: Bearer $LUNA_TOKEN
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { ANALYSIS_SCHEMA, RANK_SCHEMA, buildPrompt, buildRankPrompt } from './index.js';

const MIME = { '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.png': 'image/png', '.webp': 'image/webp' };

async function callLuna(task, prompt, imagePath, schema) {
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
      task,
      prompt,
      image: { mime: MIME[path.extname(imagePath).toLowerCase()] || 'image/jpeg', base64 },
      schema,
    }),
    signal: AbortSignal.timeout(Number(process.env.LUNA_TIMEOUT_MS || 180000)),
  });
  if (!res.ok) throw new Error(`Luna a répondu ${res.status}`);
  return res.json();
}

export default {
  name: 'luna',
  async analyze({ imagePath, ...opts }) {
    const body = await callLuna('analyze', buildPrompt(opts), imagePath, ANALYSIS_SCHEMA);
    return { ...(body.analysis ?? body), _meta: { provider: 'luna' } };
  },
  async rank({ imagePath, analysis, items }) {
    const body = await callLuna('rank', buildRankPrompt({ analysis, items }), imagePath, RANK_SCHEMA);
    return body.classement || [];
  },
};
