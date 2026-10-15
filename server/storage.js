/*
 * Stockage des souvenirs en ligne.
 *
 *  - Vercel Blob (production) : magasin PRIVÉ. Les fichiers ne sont lisibles
 *    qu'avec une URL signée et temporaire, fabriquée ici, côté serveur, pour les
 *    personnes connectées. Le jeton BLOB_READ_WRITE_TOKEN ne quitte jamais le
 *    serveur.
 *  - Supabase (SUPABASE_URL + SUPABASE_SERVICE_ROLE_KEY) : bucket PRIVÉ +
 *    table `souvenirs` en base de données, qui sert de registre officiel :
 *    un média n'apparaît dans l'album qu'une fois vérifié puis inscrit.
 *  - Dossier local (STOCKAGE_LOCAL=chemin) : même fonctionnement, pour tester
 *    sur son ordinateur sans compte Vercel.
 *
 * Chaque envoi se termine par `confirm()` : le serveur vérifie que le fichier
 * est réellement stocké (et de la bonne taille) avant que l'album ne le compte.
 *
 * Les informations utiles à l'album sont rangées dans le nom du fichier :
 *   souvenirs/<empreinte>__<date fichier ms>__<date prise de vue ms|0>__<nom>.<ext>
 */
import { promises as fs, createReadStream, createWriteStream } from 'node:fs';
import path from 'node:path';
import { pipeline } from 'node:stream/promises';
import { hmac } from './auth.js';

export const PREFIX = 'souvenirs/';
const MB = 1024 * 1024;
const maxBytes = (defaultMb) => Number(process.env.TAILLE_MAX_MO || defaultMb) * MB;
export const MAX_FILE_BYTES = maxBytes(1024);
const DIAG_PREFIX = 'diagnostic/';

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
    maxFileBytes: MAX_FILE_BYTES,
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
    /** Taille réellement stockée (erreur si le fichier n'existe pas). */
    async stat(pathname) {
      const { head } = await load();
      return (await head(pathname)).size;
    },
    async confirm(pathname, expectedSize) {
      return { size: checkSize(await this.stat(pathname), expectedSize) };
    },
    async writeTest(pathname, text) {
      const { put } = await load();
      await put(pathname, text, { access, addRandomSuffix: false, allowOverwrite: true, contentType: 'text/plain' });
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
    maxFileBytes: MAX_FILE_BYTES,
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
    async uploadTarget(pathname) {
      return { url: 'api/fichier?pathname=' + encodeURIComponent(pathname), headers: {} };
    },
    async stat(pathname) {
      return (await fs.stat(fileOf(pathname))).size;
    },
    async confirm(pathname, expectedSize) {
      return { size: checkSize(await this.stat(pathname), expectedSize) };
    },
    async writeTest(pathname, text) {
      const file = fileOf(pathname);
      await fs.mkdir(path.dirname(file), { recursive: true });
      await fs.writeFile(file, text);
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

/* ------------------------------------------------- Supabase (stockage + base) */

function supabaseAdapter() {
  const base = String(process.env.SUPABASE_URL).replace(/\/+$/, '');
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_SECRET_KEY;
  const bucket = process.env.SUPABASE_BUCKET || 'souvenirs';
  const table = process.env.SUPABASE_TABLE || 'souvenirs';
  const enc = (p) => p.split('/').map(encodeURIComponent).join('/');

  /** Appel REST avec la clé serveur (jamais envoyée au navigateur). */
  async function call(method, route, opts = {}) {
    const headers = { apikey: key, Authorization: `Bearer ${key}`, ...(opts.headers || {}) };
    let body;
    if (opts.raw !== undefined) body = opts.raw;
    else if (opts.json !== undefined) {
      headers['Content-Type'] = 'application/json';
      body = JSON.stringify(opts.json);
    }
    const res = await fetch(base + route, { method, headers, body });
    const text = method === 'HEAD' ? '' : await res.text();
    let data = null;
    try {
      data = text ? JSON.parse(text) : null;
    } catch {
      data = text;
    }
    if (!res.ok) {
      const msg = (data && (data.message || data.error || data.msg || data.hint)) || res.statusText || 'erreur';
      throw Object.assign(new Error(`Supabase ${res.status} : ${typeof msg === 'string' ? msg : JSON.stringify(msg)}`), {
        status: res.status,
      });
    }
    return { data, res };
  }

  return {
    kind: 'supabase',
    access: 'private',
    maxFileBytes: maxBytes(50), // offre gratuite : 50 Mo par fichier par défaut
    /** Le registre en base de données fait foi (seuls les fichiers confirmés). */
    async list() {
      const out = [];
      for (let offset = 0; ; offset += 1000) {
        const { data } = await call(
          'GET',
          `/rest/v1/${table}?select=pathname,size,created_at&order=created_at.asc&limit=1000&offset=${offset}`
        );
        for (const r of data || []) out.push({ pathname: r.pathname, size: Number(r.size) || 0, uploadedAt: Date.parse(r.created_at) || 0 });
        if (!data || data.length < 1000) break;
      }
      return out;
    },
    async readUrls(entries) {
      const expiresAt = readValidUntil();
      const expiresIn = Math.max(60, Math.floor((expiresAt - Date.now()) / 1000));
      const signed = new Map();
      for (let i = 0; i < entries.length; i += 500) {
        const paths = entries.slice(i, i + 500).map((e) => e.pathname);
        const { data } = await call('POST', `/storage/v1/object/sign/${bucket}`, { json: { expiresIn, paths } });
        for (const d of data || []) if (d && d.signedURL && !d.error) signed.set(d.path, encodeURI(base + '/storage/v1' + d.signedURL));
      }
      return { urls: entries.map((e) => signed.get(e.pathname) || null), expiresAt };
    },
    /** URL d'envoi signée (valable 2 h) : le navigateur envoie le fichier directement. */
    async uploadTarget(pathname, { contentType }) {
      const { data } = await call('POST', `/storage/v1/object/upload/sign/${bucket}/${enc(pathname)}`, { json: {} });
      if (!data || !data.url || !/[?&]token=/.test(data.url)) throw new Error("Supabase n'a pas fourni de lien d'envoi");
      return {
        url: base + '/storage/v1' + data.url,
        headers: { 'x-upsert': 'false', 'content-type': contentType, 'cache-control': 'max-age=3600' },
      };
    },
    async stat(pathname) {
      const { res } = await call('HEAD', `/storage/v1/object/${bucket}/${enc(pathname)}`).catch((err) => {
        // Supabase répond 400 (ou 404) quand l'objet n'existe pas.
        if (err.status === 400 || err.status === 404) {
          throw Object.assign(new Error('Fichier introuvable dans le stockage en ligne'), { status: 404 });
        }
        throw err;
      });
      const size = Number(res.headers.get('content-length'));
      return Number.isFinite(size) && size > 0 ? size : null;
    },
    /** Vérifie le fichier dans le bucket, puis l'inscrit dans la table. */
    async confirm(pathname, expectedSize) {
      const size = checkSize(await this.stat(pathname), expectedSize);
      const meta = describe({ pathname, size }, null);
      await call('POST', `/rest/v1/${table}?on_conflict=pathname`, {
        json: {
          pathname,
          name: meta.name,
          kind: meta.kind,
          size,
          taken_at: meta.date,
        },
        headers: { Prefer: 'resolution=merge-duplicates,return=minimal' },
      });
      return { size };
    },
    async remove(pathname) {
      await call('DELETE', `/storage/v1/object/${bucket}`, { json: { prefixes: [pathname] } });
      if (pathname.startsWith(PREFIX)) await call('DELETE', `/rest/v1/${table}?pathname=eq.${encodeURIComponent(pathname)}`);
    },
    async writeTest(pathname, text) {
      await call('POST', `/storage/v1/object/${bucket}/${enc(pathname)}`, {
        raw: text,
        headers: { 'content-type': 'text/plain', 'x-upsert': 'true' },
      });
    },
    async checkRegistry() {
      await call('GET', `/rest/v1/${table}?select=pathname&limit=1`);
    },
  };
}

/** La taille stockée doit correspondre à celle du fichier envoyé. */
function checkSize(stored, expected) {
  if (stored === null || stored === undefined) return expected || 0;
  if (expected && stored !== expected) {
    throw Object.assign(new Error(`fichier incomplet en ligne (${stored} octets au lieu de ${expected})`), { status: 409 });
  }
  return stored;
}

/** Autodiagnostic : écrit, vérifie, relit et supprime un petit fichier test. */
export async function diagnose(storage) {
  const steps = [];
  const run = async (label, fn) => {
    try {
      const detail = await fn();
      steps.push({ label, ok: true, detail: detail || '' });
      return true;
    } catch (err) {
      steps.push({ label, ok: false, detail: err.message || String(err) });
      return false;
    }
  };
  const testPath = `${DIAG_PREFIX}test-${Date.now()}.txt`;
  const text = 'amour-' + Date.now();
  await run('Stockage détecté', async () => `${storage.kind} (accès ${storage.access})`);
  const written = await run("Écriture d'un fichier test", () => storage.writeTest(testPath, text));
  if (written) {
    await run('Fichier bien enregistré', async () => {
      const size = await storage.stat(testPath);
      if (size !== null && size !== Buffer.byteLength(text)) throw new Error(`taille inattendue : ${size}`);
      return 'vérifié';
    });
    if (storage.kind !== 'local') {
      await run('Relecture par lien signé', async () => {
        const { urls } = await storage.readUrls([{ pathname: testPath }]);
        if (!urls[0]) throw new Error('pas de lien signé');
        const res = await fetch(urls[0]);
        if (!res.ok) throw new Error(`lecture refusée (${res.status})`);
        if ((await res.text()) !== text) throw new Error('contenu différent');
        return 'contenu identique';
      });
    }
  }
  if (storage.checkRegistry) await run('Table « souvenirs » (base de données)', () => storage.checkRegistry());
  await run('Liste des souvenirs', async () => `${(await storage.list()).filter((e) => isValidPathname(e.pathname)).length} en ligne`);
  if (written) await run('Nettoyage du fichier test', () => storage.remove(testPath));
  return { ok: steps.every((s) => s.ok), steps };
}

let cached;
/** L'adaptateur configuré, ou null si aucun stockage en ligne n'est configuré. */
export function getStorage() {
  if (cached !== undefined) return cached;
  if (process.env.BLOB_READ_WRITE_TOKEN || process.env.BLOB_STORE_ID) cached = vercelAdapter();
  else if (process.env.SUPABASE_URL && (process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_SECRET_KEY)) {
    cached = supabaseAdapter();
  } else if (process.env.STOCKAGE_LOCAL) cached = localAdapter(process.env.STOCKAGE_LOCAL);
  else cached = null;
  return cached;
}
