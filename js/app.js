/* Chef d'orchestre : préparation → accueil → album → déclaration finale. */
(function (A) {
  'use strict';

  const U = A.utils;
  const L = A.library;
  const S = A.storage;
  const $ = (id) => document.getElementById(id);

  const screens = {
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
    startBtn.disabled = collection.length === 0;

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
        status.textContent = `${plural(result.added, 'souvenir ajouté', 'souvenirs ajoutés')} 💞`;
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
    }
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
    L.releaseAll(collection);
    if (keepLocal) await S.clear(collection).catch(() => {});
    collection = [];
    skippedAll = [];
    status.textContent = '';
    renderSummary();
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
      collection = items;
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
  };

  boot();
})(window.Amour);
