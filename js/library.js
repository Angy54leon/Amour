/*
 * Bibliothèque de médias.
 *
 * Deux sources possibles :
 *  1. Import local (dossier, fichiers ou glisser-déposer) : les fichiers restent
 *     sur l'appareil, on les affiche via des URL d'objets (blob:) créées à la
 *     demande et libérées dès qu'elles ne sont plus utiles.
 *  2. Version hébergée : un fichier souvenirs.json (généré par
 *     `npm run liste` ou `npm run build`) liste les médias à côté du site.
 */
(function (A) {
  'use strict';

  const IMAGE_EXT = ['jpg', 'jpeg', 'png', 'webp', 'gif', 'avif', 'heic', 'heif', 'bmp'];
  const VIDEO_EXT = ['mp4', 'm4v', 'mov', 'webm', 'ogv'];
  // Formats d'image que tous les navigateurs ne savent pas afficher : on vérifie.
  const PROBE_IMAGE_EXT = ['heic', 'heif', 'avif'];
  const PROBE_TIMEOUT_MS = 6000;
  const EXIF_PREFIX_BYTES = 192 * 1024;
  // Convertisseur HEIC → JPEG (local, chargé uniquement si le navigateur ne lit pas le HEIC).
  const HEIC_CONVERTER_URL = 'js/vendor/heic2any.min.js';

  // Safari iOS lit nativement MOV, MP4 et HEVC ; et y sonder les vidéos sans
  // geste de l'utilisateur ne fait que ralentir l'import.
  const IS_IOS = A.utils.isIOS;

  let nextId = 1;

  function extensionOf(name) {
    const i = name.lastIndexOf('.');
    return i === -1 ? '' : name.slice(i + 1).toLowerCase();
  }

  function kindOf(name, mime) {
    const ext = extensionOf(name);
    if (IMAGE_EXT.indexOf(ext) !== -1) return 'image';
    if (VIDEO_EXT.indexOf(ext) !== -1) return 'video';
    if (mime && mime.indexOf('image/') === 0 && mime !== 'image/svg+xml') return 'image';
    if (mime && mime.indexOf('video/') === 0) return 'video';
    return null;
  }

  /* ---------- Récupération des fichiers ---------- */

  /** Liste de { file, path } depuis un <input type=file>. */
  function entriesFromInput(fileList) {
    return Array.from(fileList || []).map((file) => ({
      file,
      path: file.webkitRelativePath || file.name,
    }));
  }

  /**
   * Liste de { file, path } depuis un glisser-déposer, en parcourant
   * récursivement les dossiers déposés.
   * Doit être appelé pendant l'événement drop (les entrées expirent ensuite).
   */
  function entriesFromDrop(dataTransfer) {
    const roots = Array.from(dataTransfer.items || [])
      .map((item) => (item.webkitGetAsEntry ? item.webkitGetAsEntry() : null))
      .filter(Boolean);
    if (!roots.length) return Promise.resolve(entriesFromInput(dataTransfer.files));

    const out = [];
    function readFile(entry) {
      return new Promise((resolve, reject) => entry.file(resolve, reject));
    }
    function readBatch(reader) {
      return new Promise((resolve, reject) => reader.readEntries(resolve, reject));
    }
    async function walk(entry, prefix) {
      if (entry.isFile) {
        try {
          const file = await readFile(entry);
          out.push({ file, path: prefix + file.name });
        } catch (_) {
          /* fichier inaccessible : ignoré */
        }
      } else if (entry.isDirectory) {
        const reader = entry.createReader();
        let batch;
        do {
          batch = await readBatch(reader);
          for (const child of batch) await walk(child, prefix + entry.name + '/');
        } while (batch.length);
      }
    }
    return (async () => {
      for (const root of roots) await walk(root, '');
      return out;
    })();
  }

  /* ---------- Vérification de lisibilité ---------- */

  /** 'ok' | 'fail' | 'unknown' (délai dépassé : on laisse sa chance au média). */
  function probeVideo(item) {
    return new Promise((resolve) => {
      const video = document.createElement('video');
      const url = URL.createObjectURL(item.file);
      let done = false;
      const timer = setTimeout(() => finish('unknown'), PROBE_TIMEOUT_MS);
      function finish(result) {
        if (done) return;
        done = true;
        clearTimeout(timer);
        if (result === 'ok') {
          item.width = video.videoWidth;
          item.height = video.videoHeight;
          item.duration = video.duration;
        }
        video.removeAttribute('src');
        video.load();
        URL.revokeObjectURL(url);
        resolve(result);
      }
      video.preload = 'metadata';
      video.muted = true;
      video.playsInline = true;
      video.addEventListener('loadedmetadata', () =>
        finish(video.videoWidth > 0 && video.videoHeight > 0 ? 'ok' : 'fail')
      );
      video.addEventListener('error', () => finish('fail'));
      video.src = url;
    });
  }

  function probeImage(item) {
    return new Promise((resolve) => {
      const img = new Image();
      const url = URL.createObjectURL(item.file);
      let done = false;
      const timer = setTimeout(() => finish('unknown'), PROBE_TIMEOUT_MS);
      function finish(result) {
        if (done) return;
        done = true;
        clearTimeout(timer);
        img.removeAttribute('src');
        URL.revokeObjectURL(url);
        resolve(result);
      }
      img.onload = () => finish(img.naturalWidth > 0 ? 'ok' : 'fail');
      img.onerror = () => finish('fail');
      img.src = url;
    });
  }

  async function runPool(list, size, worker) {
    let cursor = 0;
    async function lane() {
      while (cursor < list.length) {
        const item = list[cursor++];
        await worker(item);
      }
    }
    const lanes = [];
    for (let i = 0; i < Math.min(size, list.length); i++) lanes.push(lane());
    await Promise.all(lanes);
  }

  /* ---------- Conversion HEIC ---------- */

  let heicLoader = null;
  function loadHeicConverter() {
    if (window.heic2any) return Promise.resolve(window.heic2any);
    if (!heicLoader) {
      heicLoader = new Promise((resolve, reject) => {
        const script = document.createElement('script');
        script.src = HEIC_CONVERTER_URL;
        script.async = true;
        script.onload = () =>
          window.heic2any ? resolve(window.heic2any) : reject(new Error('convertisseur absent'));
        script.onerror = () => {
          heicLoader = null;
          reject(new Error('convertisseur introuvable'));
        };
        document.head.appendChild(script);
      });
    }
    return heicLoader;
  }

  /** Remplace le fichier HEIC par un JPEG converti dans le navigateur. */
  async function convertHeic(item) {
    const heic2any = await loadHeicConverter();
    let out = await heic2any({ blob: item.file, toType: 'image/jpeg', quality: 0.88 });
    if (Array.isArray(out)) out = out[0];
    item.file = out;
    item.ext = 'jpg';
    item.size = out.size;
    item.converted = true;
  }

  /**
   * Ajoute les fichiers choisis à la collection (sans doublons), vérifie
   * qu'ils sont lisibles et convertit les HEIC si nécessaire.
   * @param {object[]} collection médias déjà importés (modifiée en place)
   * @param {(p: {phase: string, done: number, total: number}) => void} [onProgress]
   * @returns {Promise<{added: number, skipped: {name: string, reason: string}[], ignored: number}>}
   */
  async function addEntries(collection, entries, onProgress) {
    const before = collection.length;
    const seen = new Set(collection.map((it) => it.key));
    const fresh = [];
    const skipped = [];
    let ignored = 0;

    for (const { file, path } of entries) {
      const name = file.name;
      // Fichiers cachés / métadonnées macOS (._IMG_0001.JPG, __MACOSX…)
      if (name.charAt(0) === '.' || /(^|\/)__MACOSX\//.test(path)) {
        ignored++;
        continue;
      }
      const kind = kindOf(name, file.type);
      if (!kind) {
        ignored++;
        continue;
      }
      if (!file.size) {
        skipped.push({ name: path, reason: 'fichier vide' });
        continue;
      }
      const key = name + '|' + file.size + '|' + file.lastModified;
      if (seen.has(key)) continue;
      seen.add(key);
      fresh.push(makeItem({
        key,
        kind,
        name,
        path,
        file,
        type: file.type,
        size: file.size,
        lastModified: file.lastModified || 0,
      }));
    }

    const toProbe = fresh.filter(
      (it) => (it.kind === 'video' && !IS_IOS) || PROBE_IMAGE_EXT.indexOf(it.ext) !== -1
    );
    let done = 0;
    if (onProgress) onProgress({ phase: 'probe', done: 0, total: toProbe.length });
    await runPool(toProbe, 3, async (item) => {
      const result = item.kind === 'video' ? await probeVideo(item) : await probeImage(item);
      if (result === 'fail') item.unplayable = true;
      done++;
      if (onProgress) onProgress({ phase: 'probe', done, total: toProbe.length });
    });

    // HEIC/HEIF illisibles ici (Chrome, Firefox…) : conversion en JPEG.
    const toConvert = fresh.filter((it) => it.unplayable && (it.ext === 'heic' || it.ext === 'heif'));
    done = 0;
    for (const item of toConvert) {
      if (onProgress) onProgress({ phase: 'convert', done, total: toConvert.length });
      try {
        await convertHeic(item);
        item.unplayable = false;
      } catch (_) {
        item.conversionFailed = true;
      }
      done++;
    }

    for (const item of fresh) {
      if (item.unplayable) {
        skipped.push({
          name: item.path,
          reason:
            item.kind === 'video'
              ? 'vidéo illisible dans ce navigateur (souvent du HEVC : ouvre le site dans Safari ou convertis-la en MP4)'
              : item.conversionFailed
                ? 'photo HEIC impossible à convertir ici'
                : "format d'image non pris en charge par ce navigateur",
        });
      } else {
        collection.push(item);
      }
    }
    return { added: collection.length - before, skipped, ignored };
  }

  function makeItem(fields) {
    return Object.assign(
      {
        id: 'm' + nextId++,
        ext: extensionOf(fields.name),
        file: null,
        src: null,
        url: null,
        date: undefined,
      },
      fields
    );
  }

  /* ---------- Version hébergée ---------- */

  async function loadManifest() {
    if (location.protocol === 'file:') return null;
    try {
      const res = await fetch('souvenirs.json', { cache: 'no-cache' });
      if (!res.ok) return null;
      const data = await res.json();
      const items = (Array.isArray(data.items) ? data.items : [])
        .filter((it) => it && typeof it.src === 'string' && (it.kind === 'image' || it.kind === 'video'))
        .map((it) =>
          makeItem({
            key: it.src,
            kind: it.kind,
            name: it.name || it.src.split('/').pop(),
            path: it.src,
            src: it.src,
            size: it.size || 0,
            lastModified: it.lastModified || 0,
            date: it.date ? new Date(it.date) : null,
          })
        );
      return items.length ? items : null;
    } catch (_) {
      return null;
    }
  }

  /* ---------- URL d'objets ---------- */

  /** URL affichable du média (créée à la demande pour les fichiers locaux). */
  function urlFor(item) {
    if (item.src) return item.src;
    if (!item.url) item.url = URL.createObjectURL(item.file);
    return item.url;
  }

  function release(item) {
    if (item.file && item.url) {
      URL.revokeObjectURL(item.url);
      item.url = null;
    }
  }

  /** Libère toutes les URL sauf celles des médias encore utiles. */
  function keepOnly(items, keep) {
    for (const item of items) if (!keep.has(item)) release(item);
  }

  function releaseAll(items) {
    for (const item of items) release(item);
  }

  /* ---------- Date du souvenir ---------- */

  async function dateOf(item) {
    if (item.date !== undefined) return item.date;
    item.date = null;
    if (!item.file || item.kind !== 'image' || (item.ext !== 'jpg' && item.ext !== 'jpeg')) {
      return null;
    }
    try {
      const prefix = item.file.slice(0, EXIF_PREFIX_BYTES);
      const buffer = prefix.arrayBuffer
        ? await prefix.arrayBuffer()
        : await new Response(prefix).arrayBuffer();
      item.date = A.exif.readExifDate(buffer);
    } catch (_) {
      item.date = null;
    }
    return item.date;
  }

  A.library = {
    entriesFromInput,
    entriesFromDrop,
    addEntries,
    makeItem,
    loadManifest,
    urlFor,
    release,
    keepOnly,
    releaseAll,
    dateOf,
    kindOf,
  };
})(window.Amour);
