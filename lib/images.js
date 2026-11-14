import { writeFile } from 'node:fs/promises';

const EXT = { 'image/jpeg': '.jpg', 'image/png': '.png', 'image/webp': '.webp' };
const MAX = 8 * 1024 * 1024;

/** Télécharge une image (épingle Pinterest) et l'enregistre. Renvoie l'extension. */
export async function downloadImage(url, destNoExt) {
  const res = await fetch(url, { signal: AbortSignal.timeout(20000) });
  if (!res.ok) throw new Error(`image ${res.status}`);
  const type = (res.headers.get('content-type') || '').split(';')[0];
  const ext = EXT[type];
  if (!ext) throw new Error(`type d’image non pris en charge : ${type}`);
  const buf = Buffer.from(await res.arrayBuffer());
  if (buf.length > MAX) throw new Error('image trop lourde');
  await writeFile(destNoExt + ext, buf);
  return ext;
}
