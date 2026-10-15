/*
 * Routes /api de l'album (format Node req/res : fonctionne à l'identique dans
 * les Vercel Functions et dans le petit serveur local scripts/serve.mjs).
 *
 *  GET    /api/session         état : stockage configuré ? rôle de la session ?
 *  POST   /api/connexion       { code } → cookie de session
 *  POST   /api/deconnexion
 *  GET    /api/souvenirs       liste + URL signées (connecté)
 *  DELETE /api/souvenirs       { pathname } (ADMIN_CODE)
 *  POST   /api/televersement   jeton d'envoi direct navigateur → Vercel Blob (ADMIN_CODE)
 *  PUT    /api/fichier         envoi vers le stockage local de test (ADMIN_CODE)
 *  GET    /api/fichier         lecture signée du stockage local de test
 */
import { authConfigured, roleForCode, roleOf, sessionCookie, clearedCookie, sameOrigin } from './auth.js';
import { getStorage, describe, isValidPathname, MAX_FILE_BYTES, CONTENT_TYPES } from './storage.js';

function send(res, status, data, extraHeaders = {}) {
  const body = JSON.stringify(data);
  res.statusCode = status;
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  res.setHeader('Cache-Control', 'no-store');
  for (const [k, v] of Object.entries(extraHeaders)) res.setHeader(k, v);
  res.end(body);
}

async function readJson(req) {
  // Vercel a parfois déjà lu et décodé le corps.
  if (req.body !== undefined && req.body !== null) {
    if (typeof req.body === 'string') return req.body ? JSON.parse(req.body) : {};
    if (Buffer.isBuffer(req.body)) return req.body.length ? JSON.parse(req.body.toString('utf8')) : {};
    return req.body;
  }
  let raw = '';
  for await (const chunk of req) {
    raw += chunk;
    if (raw.length > 1e6) throw Object.assign(new Error('corps trop gros'), { status: 413 });
  }
  return raw ? JSON.parse(raw) : {};
}

const wait = (ms) => new Promise((r) => setTimeout(r, ms));

function status() {
  const storage = getStorage();
  return {
    configured: !!storage && authConfigured(),
    storage: storage ? storage.kind : null,
    missing: [
      !storage && 'stockage (Vercel Blob)',
      !process.env.ALBUM_CODE && 'ALBUM_CODE',
      !process.env.ADMIN_CODE && 'ADMIN_CODE',
    ].filter(Boolean),
  };
}

const routes = {
  async session(req, res) {
    if (req.method !== 'GET') return send(res, 405, { error: 'Méthode non autorisée' });
    const s = status();
    send(res, 200, { ...s, role: s.configured ? roleOf(req) : null, maxFileBytes: MAX_FILE_BYTES });
  },

  async connexion(req, res) {
    if (req.method !== 'POST') return send(res, 405, { error: 'Méthode non autorisée' });
    if (!sameOrigin(req)) return send(res, 403, { error: 'Origine refusée' });
    if (!status().configured) return send(res, 503, { error: "L'album en ligne n'est pas encore configuré." });
    const { code } = await readJson(req);
    const role = roleForCode(code);
    if (!role) {
      await wait(900); // freine les essais en série
      return send(res, 401, { error: "Ce n'est pas le bon code 💌" });
    }
    send(res, 200, { role }, { 'Set-Cookie': sessionCookie(req, role) });
  },

  async deconnexion(req, res) {
    if (req.method !== 'POST') return send(res, 405, { error: 'Méthode non autorisée' });
    send(res, 200, { ok: true }, { 'Set-Cookie': clearedCookie(req) });
  },

  async souvenirs(req, res) {
    const storage = getStorage();
    const role = roleOf(req);
    if (!storage || !role) return send(res, 401, { error: 'Connexion nécessaire' });

    if (req.method === 'GET') {
      const entries = (await storage.list()).filter((e) => isValidPathname(e.pathname));
      const { urls, expiresAt } = await storage.readUrls(entries);
      const items = entries.map((e, i) => describe(e, urls[i])).filter(Boolean);
      return send(res, 200, { items, expiresAt });
    }

    if (req.method === 'DELETE') {
      if (role !== 'admin') return send(res, 403, { error: 'Réservé au code administrateur' });
      if (!sameOrigin(req)) return send(res, 403, { error: 'Origine refusée' });
      const { pathname } = await readJson(req);
      if (!isValidPathname(pathname)) return send(res, 400, { error: 'Fichier invalide' });
      await storage.remove(pathname);
      return send(res, 200, { ok: true });
    }

    send(res, 405, { error: 'Méthode non autorisée' });
  },

  async televersement(req, res) {
    if (req.method !== 'POST') return send(res, 405, { error: 'Méthode non autorisée' });
    const storage = getStorage();
    if (!storage || storage.kind !== 'vercel-blob') return send(res, 404, { error: 'Indisponible' });
    const body = await readJson(req);
    // Vercel rappelle aussi cette route à la fin d'un envoi (signature vérifiée par le SDK).
    const isBrowserTokenRequest = body && body.type === 'blob.generate-client-token';
    if (isBrowserTokenRequest && (roleOf(req) !== 'admin' || !sameOrigin(req))) {
      return send(res, 403, { error: 'Réservé au code administrateur' });
    }
    try {
      const result = await storage.handleUpload(req, body, (pathname) => {
        if (!isValidPathname(pathname)) throw new Error('Nom de fichier refusé');
      });
      send(res, 200, result);
    } catch (err) {
      send(res, 400, { error: err.message || 'Envoi refusé' });
    }
  },

  async fichier(req, res) {
    const storage = getStorage();
    if (!storage || storage.kind !== 'local') return send(res, 404, { error: 'Indisponible' });
    const url = new URL(req.url, 'http://local');
    const pathname = url.searchParams.get('pathname');
    if (!isValidPathname(pathname)) return send(res, 400, { error: 'Fichier invalide' });

    if (req.method === 'PUT') {
      if (roleOf(req) !== 'admin' || !sameOrigin(req)) return send(res, 403, { error: 'Réservé au code administrateur' });
      const declared = Number(req.headers['content-length'] || 0);
      if (declared > MAX_FILE_BYTES) return send(res, 413, { error: 'Fichier trop volumineux' });
      if (await storage.exists(pathname)) {
        req.resume();
        return send(res, 409, { error: 'Ce fichier est déjà en ligne' });
      }
      await storage.write(pathname, req);
      return send(res, 200, { pathname });
    }

    if (req.method === 'GET' || req.method === 'HEAD') {
      if (!storage.verify(pathname, url.searchParams.get('exp'), url.searchParams.get('sig'))) {
        return send(res, 403, { error: 'Lien expiré ou invalide' });
      }
      const f = await storage.open(pathname).catch(() => null);
      if (!f) return send(res, 404, { error: 'Introuvable' });
      const ext = pathname.split('.').pop();
      const headers = {
        'Content-Type': CONTENT_TYPES[ext] || 'application/octet-stream',
        'Accept-Ranges': 'bytes',
        'Cache-Control': 'private, max-age=3600',
      };
      const range = /^bytes=(\d*)-(\d*)$/.exec(req.headers.range || '');
      if (range && (range[1] || range[2])) {
        let start = range[1] === '' ? Math.max(0, f.size - Number(range[2])) : Number(range[1]);
        let end = range[1] === '' || range[2] === '' ? f.size - 1 : Math.min(Number(range[2]), f.size - 1);
        if (start > end) {
          res.writeHead(416, { 'Content-Range': `bytes */${f.size}` });
          return res.end();
        }
        res.writeHead(206, { ...headers, 'Content-Range': `bytes ${start}-${end}/${f.size}`, 'Content-Length': end - start + 1 });
        if (req.method === 'HEAD') return res.end();
        return f.stream({ start, end }).pipe(res);
      }
      res.writeHead(200, { ...headers, 'Content-Length': f.size });
      if (req.method === 'HEAD') return res.end();
      return f.stream().pipe(res);
    }

    send(res, 405, { error: 'Méthode non autorisée' });
  },
};

/** Fabrique un gestionnaire de route qui ne laisse jamais fuiter d'erreur brute. */
export function route(name) {
  return async function handler(req, res) {
    try {
      await routes[name](req, res);
    } catch (err) {
      console.error(`[api/${name}]`, err);
      if (!res.headersSent) send(res, err.status || 500, { error: 'Erreur du serveur, réessaie dans un instant.' });
      else res.end();
    }
  };
}

export const ROUTE_NAMES = Object.keys(routes);
