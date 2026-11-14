// Fournisseur : la CLI Claude Code en mode non interactif (`claude -p`),
// connectée à TON COMPTE Claude (abonnement) — aucune clé API n'est utilisée.
// Prérequis : avoir lancé `claude` une fois et s'être connectée avec son compte.
import { spawn } from 'node:child_process';
import path from 'node:path';
import { ANALYSIS_SCHEMA, buildPrompt } from './index.js';

const SYSTEM = [
  'Tu es une styliste experte en seconde main et en Vinted.',
  'Lis le fichier image indiqué avec l’outil Read, puis remplis la réponse structurée.',
  'Les requêtes doivent être courtes et réalistes, comme une vraie recherche Vinted en français.',
  'Les couleurs : noms simples en français (ex. "bleu marine") + code hex approximatif.',
].join(' ');

export default {
  name: 'claude-cli',
  async analyze({ imagePath, ...opts }) {
    const bin = process.env.CLAUDE_BIN || 'claude';
    const model = process.env.CLAUDE_MODEL || 'sonnet';
    const prompt = `${buildPrompt(opts)}\n\nFichier image : ${imagePath}`;
    const args = [
      '-p', prompt,
      '--tools', 'Read',
      '--allowedTools', 'Read',
      '--strict-mcp-config',
      '--disable-slash-commands',
      '--no-session-persistence',
      '--model', model,
      '--system-prompt', SYSTEM,
      '--json-schema', JSON.stringify(ANALYSIS_SCHEMA),
      '--output-format', 'json',
    ];
    const out = await run(bin, args, path.dirname(imagePath));
    let data;
    try {
      data = JSON.parse(out);
    } catch {
      throw new Error('Réponse illisible de la CLI claude');
    }
    if (data.is_error) throw new Error(data.result || 'Erreur de la CLI claude');
    const analysis = data.structured_output ?? safeJson(data.result);
    if (!analysis) throw new Error('La CLI claude n’a pas renvoyé d’analyse structurée');
    return { ...analysis, _meta: { provider: 'claude-cli', model } };
  },
};

function safeJson(s) {
  try { return JSON.parse(s); } catch { return null; }
}

function run(bin, args, cwd) {
  const timeoutMs = Number(process.env.CLAUDE_TIMEOUT_MS || 180000);
  // On retire toute clé API de l'environnement pour forcer la connexion par compte.
  const env = { ...process.env };
  delete env.ANTHROPIC_API_KEY;
  delete env.ANTHROPIC_AUTH_TOKEN;
  return new Promise((resolve, reject) => {
    const child = spawn(bin, args, { cwd, env, stdio: ['ignore', 'pipe', 'pipe'] });
    let stdout = '';
    let stderr = '';
    const timer = setTimeout(() => {
      child.kill('SIGTERM');
      reject(new Error(`La CLI claude a dépassé ${timeoutMs / 1000} s`));
    }, timeoutMs);
    child.stdout.on('data', (d) => (stdout += d));
    child.stderr.on('data', (d) => (stderr += d));
    child.on('error', (e) => {
      clearTimeout(timer);
      reject(new Error(e.code === 'ENOENT' ? `CLI introuvable : "${bin}" (règle CLAUDE_BIN)` : e.message));
    });
    child.on('close', (code) => {
      clearTimeout(timer);
      if (code === 0 || stdout.trim().startsWith('{')) resolve(stdout);
      else reject(new Error(`claude a quitté avec le code ${code} : ${stderr.slice(-400)}`));
    });
  });
}
