/*
 * Routes /api de l'album (format Node req/res : fonctionne à l'identique dans
 * les Vercel Functions et dans le petit serveur local scripts/serve.mjs).
 *
 *  GET    /api/session         état : stockage configuré ? rôle de la session ?
 *  POST   /api/connexion       { code } → cookie de session
 *  POST   /api/deconnexion
 *  GET    /api/souvenirs       liste + URL signées (connecté)
 *  DELETE /api/souvenirs       { pathname } (ADMIN_CODE)
 *  POST   /api/televersement   autorisation d'envoi direct navigateur → stockage (ADMIN_CODE)
 *  POST   /api/confirmer       { pathname, size } : vérifie que le fichier est bien stocké
 *                              et l'inscrit dans l'album — seule source du « ✓ enregistré »
 *  GET    /api/diagnostic      teste écriture / relecture / suppression (ADMIN_CODE)
 *  PUT    /api/fichier         envoi vers le stockage local de test (ADMIN_CODE)
 *  GET    /api/fichier         lecture signée du stockage local de test
 */
import { authConfigured, authProblems, roleForCode, roleOf, sessionCookie, clearedCookie, sameOrigin } from './auth.js';
import { getStorage, describe, isValidPathname, isMediaPathname, diagnose, MAX_FILE_BYTES, CONTENT_TYPES } from './storage.js';

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
    missing: [!storage && 'stockage en ligne (Vercel Blob ou Supabase)'].filter(Boolean).concat(authProblems()),
  };
}

function needAdmin(req, res) {
  if (roleOf(req) !== 'admin') {
    send(res, 403, { error: 'Réservé au code administrateur' });
    return false;
  }
  if (!sameOrigin(req)) {
    send(res, 403, { error: 'Origine refusée' });
    return false;
  }
  return true;
}

const routes = {
  async session(req, res) {
    if (req.method !== 'GET') return send(res, 405, { error: 'Méthode non autorisée' });
    const s = status();
    const storage = getStorage();
    send(res, 200, {
      ...s,
      role: s.configured ? roleOf(req) : null,
      maxFileBytes: storage ? storage.maxFileBytes : MAX_FILE_BYTES,
      uploadMode: storage && storage.uploadMode ? storage.uploadMode : null,
    });
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
      // Toutes les photos/vidéos du stockage, y compris celles déposées à la main.
      const entries = (await storage.list()).filter((e) => isMediaPathname(e.pathname));
      const { urls, expiresAt } = await storage.readUrls(entries);
      // Un média sans lien de lecture (fichier absent du stockage) n'est pas proposé.
      const items = entries.map((e, i) => (urls[i] ? describe(e, urls[i]) : null)).filter(Boolean);
      return send(res, 200, { items, expiresAt });
    }

    if (req.method === 'DELETE') {
      if (role !== 'admin') return send(res, 403, { error: 'Réservé au code administrateur' });
      if (!sameOrigin(req)) return send(res, 403, { error: 'Origine refusée' });
      const { pathname } = await readJson(req);
      if (!isMediaPathname(pathname)) return send(res, 400, { error: 'Fichier invalide' });
      await storage.remove(pathname);
      return send(res, 200, { ok: true });
    }

    send(res, 405, { error: 'Méthode non autorisée' });
  },

  async televersement(req, res) {
    if (req.method !== 'POST') return send(res, 405, { error: 'Méthode non autorisée' });
    const storage = getStorage();
    if (!storage) return send(res, 404, { error: 'Indisponible' });
    const body = await readJson(req);

    if (storage.kind !== 'vercel-blob') {
      // Supabase / local : lien d'envoi signé, à usage unique, pour ce seul fichier.
      if (!needAdmin(req, res)) return;
      const { pathname, size, contentType } = body || {};
      if (!isValidPathname(pathname)) return send(res, 400, { error: 'Nom de fichier refusé' });
      if (!(size > 0)) return send(res, 400, { error: 'Fichier vide' });
      if (size > storage.maxFileBytes) {
        return send(res, 413, { error: `Fichier trop volumineux (max ${Math.round(storage.maxFileBytes / 1048576)} Mo)` });
      }
      const type = CONTENT_TYPES[pathname.split('.').pop()];
      try {
        return send(res, 200, await storage.uploadTarget(pathname, { contentType: contentType === type ? contentType : type, size }));
      } catch (err) {
        const exists = /exist|duplicate/i.test(err.message || '') || err.status === 409;
        return send(res, exists ? 409 : 502, { error: exists ? 'Ce fichier est déjà en ligne' : err.message });
      }
    }

    // Toute demande d'autorisation d'envoi exige le code administrateur. Seul le rappel
    // de fin d'envoi envoyé par Vercel passe sans cookie : le SDK en vérifie la signature.
    const isVercelCallback = body && body.type === 'blob.upload-completed';
    if (isVercelCallback && storage.uploadMode === 'presigned') {
      return send(res, 400, { error: 'Rappel non utilisé' });
    }
    if (!isVercelCallback && (roleOf(req) !== 'admin' || !sameOrigin(req))) {
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

  async confirmer(req, res) {
    if (req.method !== 'POST') return send(res, 405, { error: 'Méthode non autorisée' });
    const storage = getStorage();
    if (!storage) return send(res, 404, { error: 'Indisponible' });
    if (!needAdmin(req, res)) return;
    const { pathname, size } = await readJson(req);
    if (!isValidPathname(pathname)) return send(res, 400, { error: 'Nom de fichier refusé' });
    try {
      const result = await storage.confirm(pathname, Number(size) || 0);
      send(res, 200, { ok: true, pathname, size: result.size });
    } catch (err) {
      const missing = /not.?found|does not exist|n'existe|ENOENT|404/i.test(err.message || '') || err.status === 404;
      send(res, missing ? 404 : err.status === 409 ? 409 : 502, {
        error: missing ? 'Fichier introuvable dans le stockage en ligne' : err.message,
      });
    }
  },

  async diagnostic(req, res) {
    if (req.method !== 'GET') return send(res, 405, { error: 'Méthode non autorisée' });
    const storage = getStorage();
    if (!storage) return send(res, 200, { ok: false, steps: [{ label: 'Stockage détecté', ok: false, detail: 'aucun stockage configuré' }] });
    if (!needAdmin(req, res)) return;
    send(res, 200, await diagnose(storage));
  },

  async fichier(req, res) {
    const storage = getStorage();
    if (!storage || storage.kind !== 'local') return send(res, 404, { error: 'Indisponible' });
    const url = new URL(req.url, 'http://local');
    const pathname = url.searchParams.get('pathname');
    if (!isMediaPathname(pathname)) return send(res, 400, { error: 'Fichier invalide' });

    if (req.method === 'PUT') {
      if (!isValidPathname(pathname)) return send(res, 400, { error: 'Nom de fichier refusé' });
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
      const ext = pathname.split('.').pop().toLowerCase();
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
