/* Outils partagés par les scripts : repérage des médias et date EXIF. */
import { promises as fs } from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import { fileURLToPath } from 'node:url';

export const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

export const IMAGE_EXT = ['jpg', 'jpeg', 'png', 'webp', 'gif', 'avif', 'heic', 'heif', 'bmp'];
export const VIDEO_EXT = ['mp4', 'm4v', 'mov', 'webm', 'ogv'];

export function kindOf(name) {
  const ext = path.extname(name).slice(1).toLowerCase();
  if (IMAGE_EXT.includes(ext)) return 'image';
  if (VIDEO_EXT.includes(ext)) return 'video';
  return null;
}

/** Tous les médias d'un dossier (récursif), hors fichiers cachés. */
export async function scanMedia(dir) {
  const out = [];
  async function walk(current) {
    const entries = await fs.readdir(current, { withFileTypes: true });
    for (const entry of entries) {
      if (entry.name.startsWith('.') || entry.name === '__MACOSX') continue;
      const abs = path.join(current, entry.name);
      if (entry.isDirectory()) {
        await walk(abs);
      } else if (entry.isFile()) {
        const kind = kindOf(entry.name);
        if (!kind) continue;
        const stat = await fs.stat(abs);
        if (!stat.size) continue;
        out.push({ abs, rel: path.relative(dir, abs), name: entry.name, kind, size: stat.size, mtimeMs: stat.mtimeMs });
      }
    }
  }
  await walk(dir);
  return out;
}

/** Réutilise le lecteur EXIF du site (js/exif.js) côté Node. */
let readExifDate = null;
async function exifReader() {
  if (readExifDate) return readExifDate;
  const code = await fs.readFile(path.join(projectRoot, 'js/exif.js'), 'utf8');
  const sandbox = { window: { Amour: {} }, DataView, Intl, Date, String, Number, isNaN };
  vm.runInNewContext(code, sandbox);
  readExifDate = sandbox.window.Amour.exif.readExifDate;
  return readExifDate;
}

export async function exifDate(abs) {
  if (!/\.jpe?g$/i.test(abs)) return null;
  const handle = await fs.open(abs, 'r');
  try {
    const buf = Buffer.alloc(192 * 1024);
    const { bytesRead } = await handle.read(buf, 0, buf.length, 0);
    const ab = buf.buffer.slice(buf.byteOffset, buf.byteOffset + bytesRead);
    const date = (await exifReader())(ab);
    return date ? date.toISOString() : null;
  } catch {
    return null;
  } finally {
    await handle.close();
  }
}

/** Chemin de fichier → URL relative sûre (espaces, accents…). */
export function toUrl(relPath) {
  return relPath.split(path.sep).map(encodeURIComponent).join('/');
}

export function formatSize(bytes) {
  if (bytes > 1e9) return (bytes / 1e9).toFixed(2) + ' Go';
  if (bytes > 1e6) return (bytes / 1e6).toFixed(1) + ' Mo';
  return Math.round(bytes / 1e3) + ' Ko';
}
