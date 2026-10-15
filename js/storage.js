/*
 * Stockage facultatif sur l'appareil (IndexedDB).
 *
 * Ce que ça fait : copie les photos et vidéos choisies dans le stockage du
 * navigateur, sur CET appareil et dans CE navigateur uniquement, pour les
 * retrouver à la prochaine visite. Rien n'est envoyé sur Internet.
 *
 * Ce que ça ne garantit pas : le navigateur peut effacer ces données (espace
 * disque faible, données de site effacées, navigation privée, règles
 * d'inactivité de Safari). Ce n'est pas une sauvegarde.
 */
(function (A) {
  'use strict';

  const DB_NAME = 'amour-des-deux-zigs';
  const STORE = 'souvenirs';
  const VERSION = 1;

  let dbPromise = null;

  function supported() {
    try {
      return !!window.indexedDB;
    } catch (_) {
      return false;
    }
  }

  function open() {
    if (!dbPromise) {
      dbPromise = new Promise((resolve, reject) => {
        const req = indexedDB.open(DB_NAME, VERSION);
        req.onupgradeneeded = () => {
          const db = req.result;
          if (!db.objectStoreNames.contains(STORE)) db.createObjectStore(STORE, { keyPath: 'key' });
        };
        req.onsuccess = () => resolve(req.result);
        req.onerror = () => {
          dbPromise = null;
          reject(req.error);
        };
      });
    }
    return dbPromise;
  }

  /** Exécute une requête dans sa propre transaction et attend sa validation. */
  async function run(mode, makeRequest) {
    const db = await open();
    return new Promise((resolve, reject) => {
      const tx = db.transaction(STORE, mode);
      const req = makeRequest(tx.objectStore(STORE));
      let result;
      req.onsuccess = () => {
        result = req.result;
      };
      tx.oncomplete = () => resolve(result);
      tx.onerror = () => reject(tx.error || req.error);
      tx.onabort = () => reject(tx.error || new Error('transaction annulée'));
    });
  }

  async function count() {
    if (!supported()) return 0;
    try {
      return await run('readonly', (s) => s.count());
    } catch (_) {
      return 0;
    }
  }

  /** Recharge les souvenirs gardés (les fichiers restent sur disque, pas en mémoire). */
  async function loadItems() {
    if (!supported()) return [];
    const records = await run('readonly', (s) => s.getAll());
    return (records || [])
      .filter((r) => r && r.blob)
      .map((r) =>
        A.library.makeItem({
          key: r.key,
          kind: r.kind,
          name: r.name,
          path: r.path || r.name,
          file: r.blob,
          type: r.type,
          size: r.size || r.blob.size,
          lastModified: r.lastModified || 0,
          stored: true,
        })
      );
  }

  /**
   * Copie les médias pas encore gardés. S'arrête proprement si l'espace manque.
   * @returns {Promise<{saved: number, total: number, error: Error|null}>}
   */
  async function saveItems(items, onProgress) {
    const todo = items.filter((it) => it.file && !it.stored);
    let saved = 0;
    for (const item of todo) {
      try {
        await run('readwrite', (s) =>
          s.put({
            key: item.key,
            kind: item.kind,
            name: item.name,
            path: item.path,
            type: item.file.type || item.type || '',
            size: item.size,
            lastModified: item.lastModified,
            blob: item.file,
          })
        );
        item.stored = true;
        saved++;
        if (onProgress) onProgress(saved, todo.length);
      } catch (error) {
        return { saved, total: todo.length, error };
      }
    }
    return { saved, total: todo.length, error: null };
  }

  async function clear(items) {
    if (items) items.forEach((it) => (it.stored = false));
    if (!supported()) return;
    await run('readwrite', (s) => s.clear());
  }

  /** Demande au navigateur de ne pas effacer ces données de lui-même. */
  async function requestPersistence() {
    try {
      if (navigator.storage && navigator.storage.persist) return await navigator.storage.persist();
    } catch (_) {
      /* non pris en charge */
    }
    return false;
  }

  A.storage = { supported, count, loadItems, saveItems, clear, requestPersistence };
})(window.Amour);
