/* Chef d'orchestre : préparation → accueil → album → déclaration finale. */
(function (A) {
  'use strict';

  const U = A.utils;
  const L = A.library;
  const S = A.storage;
  const C = A.cloud;
  const $ = (id) => document.getElementById(id);

  const screens = {
    lock: $('screen-lock'),
    setup: $('screen-setup'),
    intro: $('screen-intro'),
    album: $('screen-album'),
    end: $('screen-end'),
  };
  const titleBar = $('title-bar');
  const veil = $('veil');

  let collection = [];
  let skippedAll = [];
  let hosted = false;
  let keepLocal = false;
  let switching = false;
  // Album en ligne : null (désactivé), 'viewer' (voir) ou 'admin' (voir + envoyer)
  let cloudRole = null;
  let onlineItems = [];
  // Où vont réellement les photos ajoutées : affiché en permanence à l'import.
  // 'cloud-admin' | 'cloud-viewer' | 'not-configured' | 'no-api' | 'local-chosen' | 'local'
  let saveMode = 'local';
  let saveMissing = [];

  /* ---------- Écrans ---------- */

  function show(name) {
    for (const key of Object.keys(screens)) {
      const el = screens[key];
      el.hidden = key !== name;
      el.classList.toggle('is-active', key === name);
    }
    document.body.dataset.screen = name;
    // Le titre reste affiché pendant tout l'album, transitions comprises.
    titleBar.hidden = name !== 'album';
  }

  /** Fondu romantique à travers un voile, avec l'écran suivant préparé au milieu. */
  async function throughVeil(midway, burstFrom) {
    if (switching) return;
    switching = true;
    document.body.classList.add('is-switching');
    const reduced = U.prefersReducedMotion();
    if (burstFrom) A.hearts.burst(burstFrom.x, burstFrom.y, 16);
    await U.settle(
      veil.animate([{ opacity: 0 }, { opacity: 1 }], {
        duration: reduced ? 250 : 900,
        easing: 'ease-in-out',
        fill: 'forwards',
      })
    );
    await midway();
    await U.nextFrame();
    await U.settle(
      veil.animate([{ opacity: 1 }, { opacity: 0 }], {
        duration: reduced ? 250 : 1000,
        easing: 'ease-out',
        fill: 'forwards',
      })
    );
    switching = false;
    document.body.classList.remove('is-switching');
  }

  /* ---------- Préparation ---------- */

  const pickFiles = $('pick-files');
  const pickFolder = $('pick-folder');
  const pickFolderLabel = $('pick-folder-label');
  const dropZone = $('drop-zone');
  const status = $('setup-status');
  const ready = $('setup-ready');
  const summary = $('setup-summary');
  const skippedBox = $('setup-skipped');
  const keepBlock = $('keep-block');
  const keepBox = $('keep-local');
  const keepNote = $('keep-note');
  const hint = $('setup-hint');
  const startBtn = $('start-surprise');
  const clearBtn = $('clear-all');

  const touchFirst = window.matchMedia('(hover: none) and (pointer: coarse)').matches;
  const folderPickerWorks =
    'webkitdirectory' in document.createElement('input') &&
    !U.isIOS &&
    !touchFirst &&
    !/Android|iPhone|iPad/i.test(navigator.userAgent);

  if (U.isIOS) {
    // image/* + video/* : Safari ouvre directement la photothèque (sélection multiple)
    // et fournit les photos HEIC en JPEG compatible.
    pickFiles.accept = 'image/*,video/*';
    hint.textContent = 'Astuce : dans la photothèque, touche plusieurs photos et vidéos avant de valider. Tu peux recommencer pour en ajouter d’autres.';
  } else {
    pickFiles.accept = 'image/*,video/*,.jpg,.jpeg,.png,.webp,.gif,.avif,.heic,.heif,.mp4,.m4v,.mov,.webm';
  }
  pickFolderLabel.hidden = !folderPickerWorks;
  dropZone.hidden = touchFirst;
  keepBlock.hidden = !S.supported();

  function plural(n, one, many) {
    return n + ' ' + (n > 1 ? many : one);
  }

  function renderSummary() {
    const photos = collection.filter((it) => it.kind === 'image').length;
    const videos = collection.length - photos;
    ready.hidden = collection.length === 0;
    summary.textContent = `${plural(photos, 'photo', 'photos')} · ${plural(videos, 'vidéo', 'vidéos')} prêtes 💞`;
    startBtn.disabled = collection.length === 0 || !!uploadCtrl;
    // En ligne, « Tout retirer » ne concerne que les fichiers de cet appareil.
    clearBtn.hidden = !!cloudRole && !collection.some((it) => !it.remote);
    keepBlock.hidden = !S.supported() || (!!cloudRole && !keepLocal);

    skippedBox.hidden = skippedAll.length === 0;
    if (skippedAll.length) {
      skippedBox.querySelector('summary').textContent =
        plural(skippedAll.length, 'fichier mis de côté', 'fichiers mis de côté');
      const list = skippedBox.querySelector('ul');
      list.textContent = '';
      for (const s of skippedAll) {
        const li = document.createElement('li');
        li.textContent = `${s.name} — ${s.reason}`;
        list.appendChild(li);
      }
    }
    keepBox.checked = keepLocal;
  }

  function setBusy(busy) {
    document.body.classList.toggle('is-importing', busy);
    startBtn.disabled = busy || collection.length === 0;
    pickFiles.disabled = pickFolder.disabled = busy;
  }

  /* ---------- Album en ligne ---------- */

  const setupText = $('setup-text');
  const cloudPanel = $('cloud-panel');
  const cloudCount = $('cloud-count');
  const cloudNote = $('cloud-note');
  const uploadBox = $('upload-box');
  const uploadFill = $('upload-fill');
  const uploadText = $('upload-text');
  const uploadCurrent = $('upload-current');
  const uploadStop = $('upload-stop');
  const uploadFailed = $('upload-failed');
  const uploadSend = $('upload-send');
  const cloudManage = $('cloud-manage');
  const cloudList = $('cloud-list');
  const cloudLogout = $('cloud-logout');
  let uploadCtrl = null;
  let lastFailed = [];

  function formatBytes(n) {
    if (n >= 1e9) return (n / 1e9).toFixed(2).replace('.', ',') + ' Go';
    if (n >= 1e6) return (n / 1e6).toFixed(1).replace('.', ',') + ' Mo';
    return Math.max(1, Math.round(n / 1e3)) + ' Ko';
  }

  function pendingLocal() {
    return collection.filter((it) => it.file && !it.remote);
  }

  function renderCloud() {
    cloudPanel.hidden = !cloudRole;
    if (!cloudRole) return;
    const admin = cloudRole === 'admin';
    cloudCount.textContent = plural(onlineItems.length, 'souvenir', 'souvenirs') + ' en ligne';
    cloudNote.textContent = admin
      ? 'Les photos et vidéos que tu ajoutes sont envoyées automatiquement dans votre album privé, visible seulement avec un code.'
      : 'Tu vois l’album partagé. Les photos ajoutées ici restent sur cet appareil.';
    setupText.textContent = admin
      ? 'Ajoute vos photos et vidéos : elles rejoignent l’album en ligne et seront les mêmes sur tous vos appareils.'
      : 'Voici votre album partagé 💞';

    const pending = admin ? pendingLocal() : [];
    uploadSend.hidden = !admin || !!uploadCtrl || pending.length === 0;
    uploadSend.textContent = `☁️ Envoyer en ligne (${pending.length})`;

    uploadFailed.hidden = !admin || lastFailed.length === 0;
    if (lastFailed.length) {
      uploadFailed.querySelector('summary').textContent =
        plural(lastFailed.length, 'envoi a échoué', 'envois ont échoué') + ' — touche « Envoyer en ligne » pour réessayer';
      const list = uploadFailed.querySelector('ul');
      list.textContent = '';
      for (const f of lastFailed) {
        const li = document.createElement('li');
        li.textContent = `${f.item.name} — ${f.reason}`;
        list.appendChild(li);
      }
    }

    cloudManage.hidden = !admin || onlineItems.length === 0;
    if (cloudManage.open) renderManageList();
  }

  function renderManageList() {
    cloudList.textContent = '';
    for (const item of onlineItems) {
      const li = document.createElement('li');
      const label = document.createElement('span');
      label.textContent = `${item.kind === 'video' ? '🎬' : '🖼️'} ${item.name} · ${formatBytes(item.size)}`;
      const del = document.createElement('button');
      del.type = 'button';
      del.className = 'cloud-del';
      del.textContent = 'Supprimer';
      del.setAttribute('aria-label', 'Supprimer ' + item.name);
      del.addEventListener('click', async () => {
        if (!window.confirm(`Supprimer définitivement « ${item.name} » de l’album en ligne ?`)) return;
        del.disabled = true;
        try {
          await C.remove(item.pathname);
          onlineItems = onlineItems.filter((it) => it !== item);
          collection = collection.filter((it) => it !== item);
          status.textContent = `« ${item.name} » supprimé de l’album en ligne.`;
        } catch (err) {
          status.textContent = 'Suppression impossible : ' + err.message;
          del.disabled = false;
        }
        renderSummary();
        renderCloud();
      });
      li.append(label, del);
      cloudList.appendChild(li);
    }
  }

  /* ---------- État de la sauvegarde (toujours vrai, jamais optimiste) ---------- */

  const saveState = $('save-state');
  const saveStateText = $('save-state-text');
  const saveStateAction = $('save-state-action');
  const uploadFiles = $('upload-files');
  const cloudTest = $('cloud-test');
  const cloudTestResult = $('cloud-test-result');
  let saveAction = null;

  const SAVE_STATES = {
    'cloud-admin': {
      tone: 'ok',
      text: () => '☁️ Sauvegarde en ligne active. Chaque photo ou vidéo affiche « ✓ enregistré en ligne » seulement quand le serveur a vérifié qu’elle est stockée.',
    },
    'cloud-viewer': {
      tone: 'info',
      text: () => '👀 Tu es connecté·e avec le code de l’album (lecture seule). Les photos ajoutées ici ne sont PAS sauvegardées en ligne. Pour enrichir l’album, utilise le code administrateur.',
      action: ['Changer de code', () => switchCode()],
    },
    'not-configured': {
      tone: 'warn',
      text: () => '⚠️ Sauvegarde en ligne non configurée : les photos ajoutées ici restent seulement dans cet onglet et disparaîtront à la fermeture. Il manque sur Vercel : ' + (saveMissing.join(', ') || 'la configuration') + '.',
    },
    'no-api': {
      tone: 'warn',
      text: () =>
        '⚠️ Le serveur de l’album ne répond pas (/api/session' +
        (C.problemStatus ? ' : erreur ' + C.problemStatus : ' injoignable') +
        ') : rien ne peut être sauvegardé en ligne, et les photos ajoutées ici disparaîtront à la fermeture. Redéploie la dernière version du projet, puis consulte Vercel → Logs.',
    },
    'local-chosen': {
      tone: 'info',
      text: () => '📱 Mode « cet appareil uniquement » : rien n’est envoyé en ligne.',
      action: ['Revenir à l’album en ligne', () => showLock('')],
    },
    local: {
      tone: 'info',
      text: () => '📱 Les photos sont lues sur cet appareil uniquement : elles ne sont pas sauvegardées en ligne.',
    },
  };

  function renderSaveState() {
    const def = SAVE_STATES[saveMode];
    saveState.hidden = !def;
    if (!def) return;
    saveState.className = 'save-state save-state--' + def.tone;
    saveStateText.textContent = def.text();
    saveAction = def.action ? def.action[1] : null;
    saveStateAction.hidden = !def.action;
    if (def.action) saveStateAction.textContent = def.action[0];
  }
  saveStateAction.addEventListener('click', () => saveAction && saveAction());

  async function switchCode() {
    await C.logout();
    cloudRole = null;
    collection = collection.filter((it) => !it.remote);
    showLock('');
  }

  const FILE_STATES = {
    waiting: () => 'en attente',
    sending: (pct) => `envoi ${pct || 0} %`,
    verifying: () => 'vérification…',
    saved: () => '✓ enregistré en ligne',
    already: () => '✓ déjà en ligne',
    failed: (reason) => '✗ ' + (reason || 'échec'),
  };
  const fileRows = new Map();

  function onFileState(item, state, detail) {
    let row = fileRows.get(item);
    if (!row) {
      row = document.createElement('li');
      const name = document.createElement('span');
      name.textContent = item.name;
      const badge = document.createElement('span');
      badge.className = 'file-state';
      row.append(name, badge);
      fileRows.set(item, row);
      uploadFiles.appendChild(row);
    }
    const badge = row.lastChild;
    // Un état final (✓ / ✗) n'est jamais remplacé par une progression tardive.
    if (state === 'sending' && /file-state--(verifying|saved|already|failed)/.test(badge.className)) return;
    badge.className = 'file-state file-state--' + state;
    badge.textContent = FILE_STATES[state](detail);
    uploadFiles.hidden = false;
  }

  cloudTest.addEventListener('click', async () => {
    cloudTest.disabled = true;
    cloudTestResult.hidden = false;
    cloudTestResult.textContent = '';
    const wait = document.createElement('li');
    wait.textContent = 'Test en cours…';
    cloudTestResult.appendChild(wait);
    try {
      const res = await C.diagnostic();
      cloudTestResult.textContent = '';
      for (const step of res.steps) {
        const li = document.createElement('li');
        const label = document.createElement('span');
        label.textContent = step.label;
        const value = document.createElement('span');
        value.className = 'file-state ' + (step.ok ? 'is-ok' : 'is-ko');
        value.textContent = (step.ok ? '✓ ' : '✗ ') + (step.detail || '');
        li.append(label, value);
        cloudTestResult.appendChild(li);
      }
      status.textContent = res.ok
        ? '✓ Le stockage en ligne fonctionne : écriture, vérification, relecture et suppression réussies.'
        : '✗ Le stockage en ligne a un problème : voir le détail ci-dessus.';
    } catch (err) {
      cloudTestResult.textContent = '';
      status.textContent = 'Test impossible : ' + err.message;
    } finally {
      cloudTest.disabled = false;
    }
  });

  function renderUploadProgress(p) {
    const ratio = p.totalBytes ? p.loadedBytes / p.totalBytes : p.total ? p.done / p.total : 0;
    uploadFill.style.transform = `scaleX(${Math.min(1, ratio)})`;
    uploadText.textContent =
      `Envoi : ${Math.floor(ratio * 100)} % — ${p.saved} / ${p.total} enregistrés · ` +
      `${formatBytes(p.loadedBytes)} / ${formatBytes(p.totalBytes)}`;
    uploadCurrent.textContent = p.current.length ? 'En cours : ' + p.current.join(', ') : '';
  }

  /** Envoie en ligne tous les fichiers locaux pas encore envoyés. */
  async function uploadPending() {
    if (cloudRole !== 'admin' || uploadCtrl) return;
    const pending = pendingLocal();
    if (!pending.length) return;
    uploadCtrl = new AbortController();
    lastFailed = [];
    uploadBox.hidden = false;
    uploadFill.style.transform = 'scaleX(0)';
    uploadText.textContent = 'Préparation de l’envoi…';
    uploadCurrent.textContent = '';
    uploadFiles.textContent = '';
    fileRows.clear();
    setBusy(true);
    renderCloud();
    await C.keepAwake(true);
    const existing = new Set(onlineItems.map((it) => it.pathname));
    try {
      const res = await C.uploadAll(pending, {
        existing,
        signal: uploadCtrl.signal,
        onProgress: renderUploadProgress,
        onFile: onFileState,
      });
      lastFailed = res.failed;
      // Relecture de la liste depuis le serveur : c'est elle qui fait foi.
      onlineItems = await C.list();
      const online = new Set(onlineItems.map((it) => it.pathname));
      const uploaded = pending.filter((it) => it.pathname && online.has(it.pathname));
      const confirmedListed = res.sent.filter((it) => online.has(it.pathname)).length;
      L.releaseAll(uploaded);
      collection = onlineItems.concat(collection.filter((it) => !it.remote && uploaded.indexOf(it) === -1));
      const parts = [];
      if (confirmedListed) {
        parts.push(`✓ ${plural(confirmedListed, 'souvenir enregistré et vérifié', 'souvenirs enregistrés et vérifiés')} en ligne`);
      }
      if (res.skipped) parts.push(`${res.skipped} déjà en ligne`);
      if (res.failed.length) parts.push(`✗ ${res.failed.length} non enregistré${res.failed.length > 1 ? 's' : ''}`);
      if (res.aborted) parts.unshift('Envoi arrêté');
      status.textContent = parts.join(' · ') || 'Rien à envoyer.';
    } catch (err) {
      status.textContent = 'L’envoi a échoué : ' + (err.message || 'erreur inconnue') + '. Réessaie.';
      console.error(err);
    } finally {
      uploadCtrl = null;
      await C.keepAwake(false);
      uploadBox.hidden = true;
      setBusy(false);
      renderSummary();
      renderCloud();
    }
  }

  uploadSend.addEventListener('click', uploadPending);
  uploadStop.addEventListener('click', () => uploadCtrl && uploadCtrl.abort());
  cloudManage.addEventListener('toggle', () => cloudManage.open && renderManageList());
  cloudLogout.addEventListener('click', async () => {
    if (uploadCtrl) return;
    await C.logout();
    location.reload();
  });
  window.addEventListener('beforeunload', (e) => {
    if (uploadCtrl) {
      e.preventDefault();
      e.returnValue = '';
    }
  });

  /** Connecté : charge l'album en ligne et ouvre l'écran adapté. */
  async function enterCloud(role) {
    cloudRole = role;
    saveMode = role === 'admin' ? 'cloud-admin' : 'cloud-viewer';
    try {
      onlineItems = await C.list();
    } catch (err) {
      if (err.status === 401) {
        cloudRole = null;
        return showLock('Ta session a expiré, entre à nouveau le code.');
      }
      onlineItems = [];
      status.textContent = 'Impossible de charger l’album en ligne pour le moment : ' + err.message;
    }
    collection = onlineItems.slice();
    if (role === 'viewer' && collection.length) {
      intro.reset();
      show('intro'); // pour elle : directement la surprise
      return;
    }
    show('setup');
    if (role === 'admin') await restoreFromDevice(); // souvenirs gardés sur l'iPhone → à envoyer
    renderSaveState();
    renderSummary();
    renderCloud();
    if (role === 'viewer' && !collection.length) status.textContent = 'L’album en ligne est encore vide.';
  }

  /* ---------- Code secret ---------- */

  const lockForm = $('lock-form');
  const lockCode = $('lock-code');
  const lockError = $('lock-error');
  const lockSubmit = $('lock-submit');

  function showLock(message) {
    lockError.textContent = message || '';
    show('lock');
  }

  lockForm.addEventListener('submit', async (e) => {
    e.preventDefault();
    lockSubmit.disabled = true;
    lockError.textContent = '';
    try {
      const role = await C.login(lockCode.value);
      lockCode.value = '';
      await throughVeil(() => enterCloud(role));
    } catch (err) {
      lockError.textContent = err.message || 'Connexion impossible';
      lockCode.select();
    } finally {
      lockSubmit.disabled = false;
    }
  });

  $('lock-local').addEventListener('click', () => {
    throughVeil(async () => {
      saveMode = 'local-chosen';
      renderSaveState();
      renderCloud();
      show('setup');
      renderSummary();
      await restoreFromDevice();
    });
  });

  /** Lien partagé : https://…/#code=… (le fragment n'est jamais envoyé au serveur). */
  function codeFromLink() {
    const m = /(?:^#|&)code=([^&]+)/.exec(location.hash);
    if (!m) return null;
    history.replaceState(null, '', location.pathname + location.search);
    try {
      return decodeURIComponent(m[1].replace(/\+/g, ' '));
    } catch (_) {
      return null;
    }
  }

  let importing = false;
  async function importEntries(entries) {
    if (importing || !entries.length) return;
    importing = true;
    setBusy(true);
    status.textContent = 'Lecture des souvenirs…';
    try {
      const result = await L.addEntries(collection, entries, (p) => {
        if (p.phase === 'convert') {
          status.textContent = `Conversion des photos HEIC… ${Math.min(p.done + 1, p.total)} / ${p.total}`;
        } else if (p.total) {
          status.textContent = `Vérification des médias… ${p.done} / ${p.total}`;
        }
      });
      skippedAll = skippedAll.concat(result.skipped);
      if (result.added) {
        status.textContent =
          `${plural(result.added, 'souvenir ajouté', 'souvenirs ajoutés')} 💞` +
          (cloudRole === 'admin' ? '' : keepLocal ? ' — gardés sur cet appareil seulement' : ' — pour cette visite seulement, pas sauvegardés en ligne');
      } else if (!collection.length) {
        status.textContent = 'Aucune photo ni vidéo compatible dans cette sélection.';
      } else {
        status.textContent = 'Ces souvenirs étaient déjà là 😉';
      }
      if (keepLocal) await saveToDevice();
    } catch (err) {
      status.textContent = 'Oups, la lecture a échoué. Réessaie avec moins de fichiers à la fois.';
      console.error(err);
    } finally {
      importing = false;
      setBusy(false);
      renderSummary();
      renderCloud();
    }
    if (cloudRole === 'admin') await uploadPending();
  }

  async function saveToDevice() {
    const before = status.textContent;
    const result = await S.saveItems(collection, (done, total) => {
      status.textContent = `Enregistrement sur cet appareil… ${done} / ${total}`;
    });
    if (result.error) {
      const name = result.error && result.error.name;
      status.textContent =
        name === 'QuotaExceededError'
          ? `Plus assez de place : ${result.saved} sur ${result.total} souvenirs gardés sur cet appareil. Les autres devront être ajoutés à chaque visite.`
          : "L'enregistrement sur cet appareil a échoué (navigation privée ?). L'album marche quand même pour cette visite.";
      return;
    }
    const persisted = await S.requestPersistence();
    status.textContent = before;
    keepNote.textContent = persisted
      ? 'Gardés dans ce navigateur, sur cet appareil uniquement. Ce n’est pas une sauvegarde : garde aussi les originaux.'
      : 'Gardés dans ce navigateur, sur cet appareil uniquement. Le navigateur peut quand même les effacer (manque de place, données de site effacées, ou après quelques semaines sans visite dans Safari). Ajouter le site à l’écran d’accueil aide à les conserver. Garde toujours les originaux.';
  }

  pickFiles.addEventListener('change', () => {
    const entries = L.entriesFromInput(pickFiles.files);
    pickFiles.value = '';
    importEntries(entries);
  });
  pickFolder.addEventListener('change', () => {
    const entries = L.entriesFromInput(pickFolder.files);
    pickFolder.value = '';
    importEntries(entries);
  });

  ['dragenter', 'dragover'].forEach((type) =>
    document.addEventListener(type, (e) => {
      if (!screens.setup.hidden && e.dataTransfer && Array.from(e.dataTransfer.types || []).indexOf('Files') !== -1) {
        e.preventDefault();
        dropZone.classList.add('is-over');
      }
    })
  );
  document.addEventListener('dragleave', (e) => {
    if (!e.relatedTarget) dropZone.classList.remove('is-over');
  });
  document.addEventListener('drop', (e) => {
    if (screens.setup.hidden || !e.dataTransfer) return;
    e.preventDefault();
    dropZone.classList.remove('is-over');
    L.entriesFromDrop(e.dataTransfer).then(importEntries);
  });

  keepBox.addEventListener('change', async () => {
    if (keepBox.checked) {
      keepLocal = true;
      setBusy(true);
      try {
        await saveToDevice();
      } finally {
        setBusy(false);
      }
    } else {
      keepLocal = false;
      await S.clear(collection).catch(() => {});
      keepNote.textContent = 'Effacés de cet appareil. Il faudra les ajouter à nouveau à la prochaine visite.';
    }
    renderSummary();
  });

  clearBtn.addEventListener('click', async () => {
    if (keepLocal && !window.confirm('Retirer tous les souvenirs, y compris ceux gardés sur cet appareil ?')) return;
    const local = collection.filter((it) => !it.remote);
    L.releaseAll(local);
    if (keepLocal) await S.clear(local).catch(() => {});
    collection = collection.filter((it) => it.remote); // l'album en ligne n'est pas touché
    skippedAll = [];
    lastFailed = [];
    status.textContent = '';
    renderSummary();
    renderCloud();
  });

  startBtn.addEventListener('click', () => {
    if (!collection.length) return;
    throughVeil(async () => {
      intro.reset();
      show('intro');
    });
  });

  async function restoreFromDevice() {
    if (!S.supported() || !(await S.count())) return;
    try {
      const items = await S.loadItems();
      if (!items.length) return;
      collection = collection.filter((it) => it.remote).concat(items);
      keepLocal = true;
      status.textContent = `${plural(items.length, 'souvenir retrouvé', 'souvenirs retrouvés')} sur cet appareil 💾`;
      keepNote.textContent = 'Gardés dans ce navigateur, sur cet appareil uniquement. Décoche pour les effacer.';
      renderSummary();
    } catch (err) {
      console.error(err);
    }
  }

  /* ---------- Accueil ---------- */

  const happyBtn = $('happy-btn');
  const intro = A.createIntro({
    button: happyBtn,
    slot: $('intro-slot'),
    question: $('intro-question'),
    tease: $('intro-tease'),
    onOpen() {
      const r = happyBtn.getBoundingClientRect();
      throughVeil(
        async () => {
          await refreshOnlineUrlsIfNeeded();
          show('album');
          await U.nextFrame();
          album.start(A.playlist.build(collection));
        },
        { x: r.left + r.width / 2, y: r.top + r.height / 2 }
      );
    },
  });

  /* ---------- Album ---------- */

  const album = A.createAlbum({
    stage: $('stage'),
    counter: $('counter'),
    progressFill: $('progress-fill'),
    toggleBtn: $('ctrl-toggle'),
    prevBtn: $('ctrl-prev'),
    nextBtn: $('ctrl-next'),
    toast: $('album-toast'),
    ambientLayers: Array.from(document.querySelectorAll('.ambient-layer')),
    onFinish() {
      throughVeil(async () => {
        album.stop();
        show('end');
        revealEnding();
      });
    },
  });

  /** Les liens signés expirent après ~1 jour : on les renouvelle avant de relancer. */
  async function refreshOnlineUrlsIfNeeded() {
    if (cloudRole && C.urlsMayHaveExpired()) await C.refreshUrls(collection).catch(() => {});
  }

  /* ---------- Fin ---------- */

  const ending = $('ending-message');
  const replayBtn = $('replay');

  function revealEnding() {
    ending.classList.remove('is-revealed');
    replayBtn.classList.remove('is-revealed');
    void ending.offsetWidth;
    ending.classList.add('is-revealed');
    replayBtn.classList.add('is-revealed');
  }

  replayBtn.addEventListener('click', () => {
    throughVeil(async () => {
      await refreshOnlineUrlsIfNeeded();
      show('album');
      await U.nextFrame();
      album.start(A.playlist.build(collection)); // nouvel ordre surprise
    });
  });

  /* ---------- Démarrage ---------- */

  function refillHearts() {
    A.hearts.fillField($('heart-field'), window.innerWidth < 600 ? 8 : 14);
  }

  // Empêche le "rebond" de page et le zoom double-tap pendant l'expérience.
  document.addEventListener('dblclick', (e) => {
    if (document.body.dataset.screen !== 'setup') e.preventDefault();
  });

  async function boot() {
    refillHearts();
    // ?ajouter : force l'écran d'import même si une version hébergée existe.
    const forceImport = new URLSearchParams(location.search).has('ajouter');
    const manifestItems = forceImport ? null : await L.loadManifest();
    if (manifestItems) {
      // Version hébergée : les souvenirs sont déjà en ligne, on va droit au but.
      hosted = true;
      collection = manifestItems;
      show('intro');
      return;
    }
    // Album en ligne (Vercel Blob privé) si le serveur est configuré.
    const online = await C.status();
    if (online && online.configured) {
      const code = codeFromLink();
      let linkError = '';
      if (code) {
        try {
          await C.login(code);
        } catch (err) {
          linkError = err.message;
        }
      }
      if (C.info.role) return enterCloud(C.info.role);
      return showLock(linkError);
    }
    // Pas d'album en ligne : on le dit clairement au lieu de faire semblant.
    const deployed = /^https?:$/.test(location.protocol) && !/^(localhost|127\.|192\.168\.|10\.|\[::1\])/.test(location.hostname);
    if (online && !online.configured) {
      saveMode = 'not-configured';
      saveMissing = online.missing || [];
    } else if (!online && deployed) {
      saveMode = 'no-api';
    } else {
      saveMode = 'local';
    }
    renderSaveState();
    show('setup');
    renderSummary();
    await restoreFromDevice();
  }

  A.debug = {
    intro,
    album,
    get collection() {
      return collection;
    },
    get hosted() {
      return hosted;
    },
    get cloudRole() {
      return cloudRole;
    },
    get onlineItems() {
      return onlineItems;
    },
    get saveMode() {
      return saveMode;
    },
  };

  boot();
})(window.Amour);
