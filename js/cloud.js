/*
 * Album en ligne : connexion par code, liste des souvenirs stockés et envoi
 * des photos/vidéos depuis le téléphone.
 *
 * Aucune clé secrète ici : le navigateur ne connaît que le cookie de session
 * (HttpOnly, posé par le serveur) et des URL signées temporaires.
 */
(function (A) {
  'use strict';

  const L = A.library;
  const BLOB_CLIENT_URL = 'js/vendor/blob-client.js';
  const MULTIPART_FROM_BYTES = 8 * 1024 * 1024; // gros fichiers : envoi en morceaux parallèles + reprise
  const CONCURRENCY = 3;
  const RETRIES = 2;

  const TYPES = {
    jpg: 'image/jpeg', jpeg: 'image/jpeg', png: 'image/png', webp: 'image/webp', gif: 'image/gif',
    avif: 'image/avif', heic: 'image/heic', heif: 'image/heif',
    mp4: 'video/mp4', m4v: 'video/x-m4v', mov: 'video/quicktime', webm: 'video/webm',
  };

  let info = null;

  async function api(path, options) {
    const res = await fetch('api/' + path, Object.assign({ credentials: 'same-origin', cache: 'no-store' }, options));
    let data = null;
    try {
      data = await res.json();
    } catch (_) {
      /* pas de JSON */
    }
    if (!res.ok) {
      const err = new Error((data && data.error) || `Erreur ${res.status}`);
      err.status = res.status;
      throw err;
    }
    return data;
  }

  /** Pourquoi l'album en ligne est indisponible : 'file' | 'no-api' | 'network' | null */
  let problem = null;
  let problemStatus = 0;

  /** null si le site n'a pas de serveur (fichier local, GitHub Pages…). */
  async function status() {
    problem = null;
    if (location.protocol === 'file:') {
      problem = 'file';
      return null;
    }
    try {
      info = await api('session');
      return info;
    } catch (err) {
      problem = err.status ? 'no-api' : 'network';
      problemStatus = err.status || 0;
      return null;
    }
  }

  async function login(code) {
    const data = await api('connexion', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ code }),
    });
    if (info) info.role = data.role;
    return data.role;
  }

  async function logout() {
    await api('deconnexion', { method: 'POST' }).catch(() => {});
    if (info) info.role = null;
  }

  /* ---------- Liste ---------- */

  let expiresAt = 0;

  async function fetchList() {
    const data = await api('souvenirs');
    expiresAt = data.expiresAt || 0;
    return data.items || [];
  }

  function toItem(row) {
    return L.makeItem({
      key: row.pathname,
      pathname: row.pathname,
      remote: true,
      kind: row.kind,
      name: row.name,
      path: row.name,
      src: row.src,
      size: row.size || 0,
      lastModified: row.lastModified || 0,
      date: row.date ? new Date(row.date) : null,
    });
  }

  async function list() {
    return (await fetchList()).map(toItem);
  }

  /** Renouvelle les URL signées (album resté ouvert très longtemps). */
  async function refreshUrls(items) {
    const fresh = new Map((await fetchList()).map((r) => [r.pathname, r.src]));
    for (const item of items) {
      if (item.remote && fresh.has(item.pathname)) {
        item.src = fresh.get(item.pathname);
        item.broken = false;
      }
    }
  }

  function urlsMayHaveExpired() {
    return expiresAt && Date.now() > expiresAt - 5 * 60 * 1000;
  }

  async function remove(pathname) {
    await api('souvenirs', {
      method: 'DELETE',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ pathname }),
    });
  }

  /* ---------- Nom en ligne ---------- */

  function fnv1a(str) {
    let h1 = 0x811c9dc5;
    let h2 = 0x01000193;
    for (let i = 0; i < str.length; i++) {
      const c = str.charCodeAt(i);
      h1 = Math.imul(h1 ^ c, 16777619) >>> 0;
      h2 = Math.imul(h2 ^ c, 2246822519) >>> 0;
    }
    return (h1.toString(16).padStart(8, '0') + h2.toString(16).padStart(8, '0')).slice(0, 12);
  }

  /**
   * Empreinte du CONTENU (taille + premiers 256 Ko) : la même photo choisie deux
   * fois donne le même nom en ligne, donc pas de doublon, même si l'iPhone
   * change le nom ou la date du fichier d'une sélection à l'autre.
   */
  async function fingerprint(item) {
    try {
      const head = await item.file.slice(0, 256 * 1024).arrayBuffer();
      const data = new Uint8Array(head.byteLength + 8);
      new DataView(data.buffer).setFloat64(0, item.size);
      data.set(new Uint8Array(head), 8);
      const digest = await crypto.subtle.digest('SHA-256', data);
      return Array.from(new Uint8Array(digest).slice(0, 6), (b) => b.toString(16).padStart(2, '0')).join('');
    } catch (_) {
      return fnv1a(`${item.name}|${item.size}`); // http:// sur le Wi-Fi local : pas de crypto.subtle
    }
  }

  function safeBase(name) {
    const base = name.replace(/\.[^.]+$/, '');
    const clean = base
      .normalize('NFD')
      .replace(/[̀-ͯ]/g, '')
      .replace(/[^A-Za-z0-9._-]+/g, '-')
      .replace(/^[-.]+|[-.]+$/g, '')
      .slice(0, 80);
    return clean || 'souvenir';
  }

  /** souvenirs/<empreinte>__<date fichier>__<date photo|0>__<nom>.<ext> */
  async function onlinePathname(item) {
    const date = await L.dateOf(item);
    const ext = TYPES[item.ext] ? item.ext : item.kind === 'video' ? 'mp4' : 'jpg';
    const lm = Math.max(0, Math.round(item.lastModified || 0));
    const shot = date ? Math.max(0, date.getTime()) : 0;
    return `souvenirs/${await fingerprint(item)}__${lm}__${shot}__${safeBase(item.name)}.${ext}`;
  }

  function contentTypeOf(item, pathname) {
    const ext = pathname.split('.').pop();
    return TYPES[ext] || (item.file && item.file.type) || 'application/octet-stream';
  }

  /* ---------- Envoi ---------- */

  let blobClient = null;
  function loadBlobClient() {
    if (window.AmourBlobClient) return Promise.resolve(window.AmourBlobClient);
    if (!blobClient) {
      blobClient = new Promise((resolve, reject) => {
        const s = document.createElement('script');
        s.src = BLOB_CLIENT_URL;
        s.onload = () => (window.AmourBlobClient ? resolve(window.AmourBlobClient) : reject(new Error('client absent')));
        s.onerror = () => {
          blobClient = null;
          reject(new Error("Impossible de charger le module d'envoi"));
        };
        document.head.appendChild(s);
      });
    }
    return blobClient;
  }

  function errorFromXhr(xhr) {
    let msg = `Erreur ${xhr.status}`;
    try {
      const data = JSON.parse(xhr.responseText);
      msg = data.error || data.message || msg;
      if (typeof msg !== 'string') msg = JSON.stringify(msg);
    } catch (_) {}
    return Object.assign(new Error(msg), { status: xhr.status });
  }

  /**
   * Supabase / stockage de test : le serveur fournit un lien d'envoi signé pour
   * CE fichier, puis le navigateur l'envoie directement (progression réelle).
   */
  async function putSigned(pathname, item, onProgress, signal) {
    const target = await api('televersement', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ pathname, size: item.size, contentType: contentTypeOf(item, pathname) }),
    });
    await new Promise((resolve, reject) => {
      const xhr = new XMLHttpRequest();
      xhr.open('PUT', target.url);
      const headers = target.headers || {};
      if (!headers['content-type']) xhr.setRequestHeader('Content-Type', contentTypeOf(item, pathname));
      for (const [k, v] of Object.entries(headers)) xhr.setRequestHeader(k, v);
      xhr.upload.onprogress = (e) => e.lengthComputable && onProgress(e.loaded);
      xhr.onload = () => (xhr.status >= 200 && xhr.status < 300 ? resolve() : reject(errorFromXhr(xhr)));
      xhr.onerror = () => reject(new Error('Connexion perdue'));
      xhr.onabort = () => reject(Object.assign(new Error('Envoi arrêté'), { name: 'AbortError' }));
      if (signal) signal.addEventListener('abort', () => xhr.abort(), { once: true });
      xhr.send(item.file);
    });
  }

  async function putBlob(pathname, item, onProgress, signal) {
    const client = await loadBlobClient();
    // 'presigned' : projet connecté au Blob Store par OIDC (sans jeton secret).
    const send = info && info.uploadMode === 'presigned' ? client.uploadPresigned : client.upload;
    // La promesse ne se résout qu'une fois le fichier accepté et stocké par Vercel.
    await send(pathname, item.file, {
      access: 'private',
      handleUploadUrl: 'api/televersement',
      contentType: contentTypeOf(item, pathname),
      multipart: item.size >= MULTIPART_FROM_BYTES,
      abortSignal: signal,
      onUploadProgress: (e) => onProgress(e.loaded),
    });
  }

  /** Le serveur vérifie que le fichier est réellement stocké, puis l'inscrit. */
  async function confirm(pathname, size) {
    return api('confirmer', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ pathname, size }),
    });
  }

  function isAlreadyThere(err) {
    return err && (err.status === 409 || /already exists|duplicate|existe d[ée]j[aà]|déjà en ligne/i.test(err.message || ''));
  }

  function humanError(err) {
    const msg = (err && err.message) || '';
    if (/too large|maximumSizeInBytes|trop volumineux|413|exceeded the maximum allowed size/i.test(msg)) {
      return 'fichier trop volumineux pour le stockage';
    }
    if (/content type|allowedContentTypes|mime/i.test(msg)) return 'format refusé';
    if (/store has been suspended/i.test(msg)) return 'stockage Vercel suspendu (limite gratuite dépassée ?) : voir Vercel → Usage';
    if (/store does not exist/i.test(msg)) return 'Blob Store introuvable : reconnecte-le au projet dans Vercel → Storage';
    if (/access denied/i.test(msg)) return 'accès refusé par Vercel Blob : vérifie la connexion du Blob Store au projet';
    if (/\b(public|private)\b.*\baccess\b|\baccess\b.*\b(public|private)\b/i.test(msg)) {
      return 'réglage d’accès du Blob Store différent (public/privé) : voir le guide';
    }
    if (/quota|storage limit|limit exceeded|payment/i.test(msg)) return 'espace de stockage plein (limite de l’offre)';
    if (/403|administrateur|forbidden/i.test(msg)) return 'session expirée : reconnecte-toi avec le code administrateur';
    if (/network|fetch|connexion|Load failed/i.test(msg)) return 'connexion perdue';
    return msg || 'erreur inconnue';
  }

  const wait = (ms) => new Promise((r) => setTimeout(r, ms));

  /**
   * Envoie les médias locaux qui ne sont pas encore en ligne. Un fichier n'est
   * compté comme enregistré qu'après la confirmation du serveur.
   * @param {object[]} items médias avec `file`
   * @param {{onProgress?: Function, onFile?: Function, signal?: AbortSignal, existing?: Set<string>}} opts
   *   onFile(item, état, détail) — état : 'waiting' | 'sending' | 'verifying' | 'saved' | 'already' | 'failed'
   * @returns {Promise<{sent: object[], skipped: number, failed: {item: object, reason: string}[], aborted: boolean}>}
   */
  async function uploadAll(items, opts) {
    const options = opts || {};
    const onFile = options.onFile || (() => {});
    const existing = options.existing || new Set();
    const maxBytes = (info && info.maxFileBytes) || Infinity;
    const tasks = [];
    for (const item of items) {
      if (!item.file) continue;
      const pathname = await onlinePathname(item);
      tasks.push({ item, pathname, loaded: 0 });
    }
    const todo = [];
    for (const t of tasks) {
      if (existing.has(t.pathname)) {
        t.item.pathname = t.pathname;
        onFile(t.item, 'already');
      } else {
        todo.push(t);
        onFile(t.item, 'waiting');
      }
    }
    const skipped = tasks.length - todo.length;
    const totalBytes = todo.reduce((s, t) => s + t.item.size, 0);
    const sent = [];
    const failed = [];
    const active = new Set();

    const report = () => {
      if (!options.onProgress) return;
      const loaded = todo.reduce((s, t) => s + Math.min(t.loaded, t.item.size), 0);
      options.onProgress({
        done: sent.length + failed.length,
        saved: sent.length,
        total: todo.length,
        loadedBytes: loaded,
        totalBytes,
        current: Array.from(active, (t) => t.item.name),
      });
    };

    function fail(item, reason) {
      failed.push({ item, reason });
      onFile(item, 'failed', reason);
    }

    async function transfer(task) {
      const { item, pathname } = task;
      const put = info && info.storage === 'vercel-blob' ? putBlob : putSigned;
      for (let attempt = 0; ; attempt++) {
        try {
          task.loaded = 0;
          await put(pathname, item, (loaded) => {
            // Le SDK peut émettre un dernier événement de progression après la fin :
            // il ne doit jamais écraser « vérification… » ou « ✓ enregistré en ligne ».
            if (task.transferred) return;
            task.loaded = loaded;
            onFile(item, 'sending', Math.min(99, Math.floor((loaded / item.size) * 100)));
            report();
          }, options.signal);
          task.transferred = true;
          return;
        } catch (err) {
          if (options.signal && options.signal.aborted) throw err;
          if (isAlreadyThere(err)) {
            task.transferred = true;
            return; // déjà stocké : la confirmation tranchera
          }
          const reason = humanError(err);
          const retryable = reason === 'connexion perdue' || (err.status && err.status >= 500);
          if (attempt < RETRIES && retryable) {
            await wait(1500 * (attempt + 1));
            continue;
          }
          throw Object.assign(new Error(reason), { reported: true });
        }
      }
    }

    async function sendOne(task) {
      const { item, pathname } = task;
      if (item.size > maxBytes) {
        fail(item, `fichier trop volumineux (max ${Math.round(maxBytes / 1048576)} Mo)`);
        return;
      }
      onFile(item, 'sending', 0);
      try {
        await transfer(task);
      } catch (err) {
        if (options.signal && options.signal.aborted) throw err;
        fail(item, err.reported ? err.message : humanError(err));
        return;
      }
      task.loaded = item.size;
      onFile(item, 'verifying');
      report();
      // Confirmation : seul le serveur peut dire « c'est enregistré ».
      for (let attempt = 0; ; attempt++) {
        try {
          await confirm(pathname, item.size);
          item.pathname = pathname;
          sent.push(item);
          onFile(item, 'saved');
          return;
        } catch (err) {
          const retryable = err.status === 404 || !err.status || err.status >= 500;
          if (attempt < 2 && retryable && !(options.signal && options.signal.aborted)) {
            await wait(1200 * (attempt + 1)); // le temps que le stockage rende le fichier visible
            continue;
          }
          fail(item, 'envoyé mais non confirmé : ' + humanError(err));
          return;
        }
      }
    }

    let cursor = 0;
    async function lane() {
      while (cursor < todo.length) {
        if (options.signal && options.signal.aborted) return;
        const task = todo[cursor++];
        active.add(task);
        report();
        try {
          await sendOne(task);
        } finally {
          active.delete(task);
          report();
        }
      }
    }
    report();
    const lanes = [];
    for (let i = 0; i < Math.min(CONCURRENCY, todo.length); i++) lanes.push(lane());
    try {
      await Promise.all(lanes);
    } catch (err) {
      if (!(options.signal && options.signal.aborted)) throw err;
    }
    return { sent, skipped, failed, aborted: !!(options.signal && options.signal.aborted) };
  }

  /** Autodiagnostic du stockage en ligne (code administrateur). */
  async function diagnostic() {
    return api('diagnostic');
  }

  /* ---------- Écran allumé pendant l'envoi ---------- */

  let wakeLock = null;
  async function keepAwake(on) {
    try {
      if (on && 'wakeLock' in navigator && !wakeLock) {
        wakeLock = await navigator.wakeLock.request('screen');
        wakeLock.addEventListener('release', () => (wakeLock = null));
      } else if (!on && wakeLock) {
        await wakeLock.release();
        wakeLock = null;
      }
    } catch (_) {
      /* non pris en charge : pas grave */
    }
  }

  A.cloud = {
    status,
    login,
    logout,
    list,
    refreshUrls,
    urlsMayHaveExpired,
    remove,
    uploadAll,
    onlinePathname,
    keepAwake,
    diagnostic,
    get info() {
      return info;
    },
    get problem() {
      return problem;
    },
    get problemStatus() {
      return problemStatus;
    },
  };
})(window.Amour);
