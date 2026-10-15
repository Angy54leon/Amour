/*
 * Stockage des souvenirs en ligne.
 *
 *  - Vercel Blob (production) : magasin PRIVÉ. Les fichiers ne sont lisibles
 *    qu'avec une URL signée et temporaire, fabriquée ici, côté serveur, pour les
 *    personnes connectées. Le jeton BLOB_READ_WRITE_TOKEN ne quitte jamais le
 *    serveur.
 *  - Dossier local (STOCKAGE_LOCAL=chemin) : même fonctionnement, pour tester
 *    sur son ordinateur sans compte Vercel.
 *
 * Les informations utiles à l'album sont rangées dans le nom du fichier :
 *   souvenirs/<empreinte>__<date fichier ms>__<date prise de vue ms|0>__<nom>.<ext>
 */
import { promises as fs, createReadStream, createWriteStream } from 'node:fs';
import path from 'node:path';
import { pipeline } from 'node:stream/promises';
import { hmac } from './auth.js';

export const PREFIX = 'souvenirs/';
export const MAX_FILE_BYTES = Number(process.env.TAILLE_MAX_MO || 1024) * 1024 * 1024;

const IMAGE_EXT = ['jpg', 'jpeg', 'png', 'webp', 'gif', 'avif', 'heic', 'heif'];
const VIDEO_EXT = ['mp4', 'm4v', 'mov', 'webm'];
export const CONTENT_TYPES = {
  jpg: 'image/jpeg',
  jpeg: 'image/jpeg',
  png: 'image/png',
  webp: 'image/webp',
  gif: 'image/gif',
  avif: 'image/avif',
  heic: 'image/heic',
  heif: 'image/heif',
  mp4: 'video/mp4',
  m4v: 'video/x-m4v',
  mov: 'video/quicktime',
  webm: 'video/webm',
};

const PATHNAME_RE = new RegExp(
  '^souvenirs/([a-f0-9]{12})__(\\d{1,15})__(\\d{1,15})__([A-Za-z0-9._-]{1,120})\\.(' +
    IMAGE_EXT.concat(VIDEO_EXT).join('|') +
    ')$'
);

export function isValidPathname(pathname) {
  return typeof pathname === 'string' && PATHNAME_RE.test(pathname);
}

/** Transforme une entrée du stockage en souvenir pour l'album. */
export function describe(entry, url) {
  const m = PATHNAME_RE.exec(entry.pathname);
  if (!m) return null;
  const ext = m[5];
  const date = Number(m[3]);
  return {
    pathname: entry.pathname,
    src: url,
    kind: IMAGE_EXT.includes(ext) ? 'image' : 'video',
    name: m[4] + '.' + ext,
    size: entry.size,
    lastModified: Number(m[2]) || entry.uploadedAt || 0,
    date: date ? new Date(date).toISOString() : null,
  };
}

/** Échéance des URL signées : arrondie pour que le cache du navigateur serve. */
export function readValidUntil(now = Date.now()) {
  const SIX_HOURS = 6 * 3600 * 1000;
  return Math.ceil(now / SIX_HOURS) * SIX_HOURS + 18 * 3600 * 1000; // entre 18 h et 24 h
}

/* ---------------------------------------------------------------- Vercel Blob */

function vercelAdapter() {
  const access = process.env.BLOB_ACCESS === 'public' ? 'public' : 'private';
  let sdk = null;
  let readToken = null;
  const load = async () => (sdk ||= await import('@vercel/blob'));

  async function signedToken(validUntil) {
    if (readToken && readToken.validUntil >= validUntil) return readToken;
    const { issueSignedToken } = await load();
    try {
      readToken = await issueSignedToken({ pathname: '*', operations: ['get'], validUntil });
    } catch (err) {
      // Échéance refusée par l'API : on se contente de sa durée par défaut (1 h).
      readToken = await issueSignedToken({ pathname: '*', operations: ['get'] });
    }
    return readToken;
  }

  return {
    kind: 'vercel-blob',
    access,
    async list() {
      const { list } = await load();
      const out = [];
      let cursor;
      do {
        const page = await list({ prefix: PREFIX, cursor, limit: 1000 });
        for (const b of page.blobs) {
          out.push({ pathname: b.pathname, size: b.size, uploadedAt: +new Date(b.uploadedAt), url: b.url });
        }
        cursor = page.hasMore ? page.cursor : undefined;
      } while (cursor);
      return out;
    },
    /** URL lisibles par le navigateur, temporaires pour un magasin privé. */
    async readUrls(entries) {
      if (access === 'public') return { urls: entries.map((e) => e.url), expiresAt: null };
      const { presignUrl } = await load();
      const token = await signedToken(readValidUntil());
      const validUntil = Math.min(readValidUntil(), token.validUntil);
      const urls = await Promise.all(
        entries.map((e) =>
          presignUrl(token, { operation: 'get', pathname: e.pathname, validUntil, access }).then((r) => r.presignedUrl)
        )
      );
      return { urls, expiresAt: validUntil };
    },
    async remove(pathname) {
      const { del } = await load();
      await del(pathname);
    },
    async handleUpload(req, body, authorize) {
      const { handleUpload } = await import('@vercel/blob/client');
      return handleUpload({
        body,
        request: req,
        onBeforeGenerateToken: async (pathname) => {
          authorize(pathname);
          return {
            allowedContentTypes: Object.values(CONTENT_TYPES),
            maximumSizeInBytes: MAX_FILE_BYTES,
            addRandomSuffix: false,
            allowOverwrite: false,
            validUntil: Date.now() + 60 * 60 * 1000,
          };
        },
      });
    },
  };
}

/* ------------------------------------------------- Dossier local (tests, dev) */

function localAdapter(dir) {
  const root = path.resolve(dir);
  const fileOf = (pathname) => {
    const file = path.resolve(root, pathname);
    if (!file.startsWith(root + path.sep)) throw new Error('chemin interdit');
    return file;
  };
  return {
    kind: 'local',
    access: 'private',
    async list() {
      const folder = path.join(root, PREFIX);
      const names = await fs.readdir(folder).catch(() => []);
      const out = [];
      for (const name of names) {
        if (name.endsWith('.part')) continue;
        const stat = await fs.stat(path.join(folder, name));
        out.push({ pathname: PREFIX + name, size: stat.size, uploadedAt: stat.mtimeMs });
      }
      return out;
    },
    async readUrls(entries) {
      const exp = readValidUntil();
      const urls = entries.map(
        (e) => `/api/fichier?pathname=${encodeURIComponent(e.pathname)}&exp=${exp}&sig=${hmac(e.pathname + '|' + exp)}`
      );
      return { urls, expiresAt: exp };
    },
    async remove(pathname) {
      await fs.rm(fileOf(pathname), { force: true });
    },
    async exists(pathname) {
      return fs.stat(fileOf(pathname)).then(() => true, () => false);
    },
    /** Écrit le corps de la requête dans un fichier temporaire, puis le renomme. */
    async write(pathname, req) {
      const file = fileOf(pathname);
      await fs.mkdir(path.dirname(file), { recursive: true });
      const tmp = file + '.' + process.pid + '.part';
      let received = 0;
      req.on('data', (chunk) => {
        received += chunk.length;
        if (received > MAX_FILE_BYTES) req.destroy(new Error('trop volumineux'));
      });
      try {
        await pipeline(req, createWriteStream(tmp));
        await fs.rename(tmp, file);
      } catch (err) {
        await fs.rm(tmp, { force: true });
        throw err;
      }
      return received;
    },
    verify(pathname, exp, sig) {
      return Number(exp) > Date.now() && sig === hmac(pathname + '|' + exp);
    },
    async open(pathname) {
      const file = fileOf(pathname);
      const stat = await fs.stat(file);
      return { file, size: stat.size, stream: (opts) => createReadStream(file, opts) };
    },
  };
}

let cached;
/** L'adaptateur configuré, ou null si aucun stockage en ligne n'est configuré. */
export function getStorage() {
  if (cached !== undefined) return cached;
  if (process.env.BLOB_READ_WRITE_TOKEN || process.env.BLOB_STORE_ID) cached = vercelAdapter();
  else if (process.env.STOCKAGE_LOCAL) cached = localAdapter(process.env.STOCKAGE_LOCAL);
  else cached = null;
  return cached;
}
