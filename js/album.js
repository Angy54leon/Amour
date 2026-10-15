/*
 * Le lecteur de l'album : un souvenir à la fois, une transition à chaque
 * changement, des vidéos lues jusqu'au bout.
 *
 * Mémoire :
 *  - un seul élément <video> pour tout l'album (une seule vidéo chargée à la
 *    fois ; il est vidé dès qu'on quitte une vidéo) ;
 *  - seule la photo suivante est préchargée ;
 *  - les URL blob: ne sont gardées que pour le souvenir précédent, l'actuel
 *    et le suivant, les autres sont révoquées.
 */
(function (A) {
  'use strict';

  const U = A.utils;
  const L = A.library;

  const PHOTO_DURATION_MS = 6000;
  const VIDEO_END_PAUSE_MS = 600;
  const SWIPE_MIN_PX = 45;

  /* ---------- Transitions d'entrée ---------- */

  const P = 'perspective(1500px)';
  const TRANSITIONS = {
    fondu: () => ({
      keyframes: [{ opacity: 0 }, { opacity: 1 }],
      duration: 950,
      easing: 'ease-out',
    }),
    zoom: () => ({
      keyframes: [
        { opacity: 0, transform: 'scale(1.14)' },
        { opacity: 1, transform: 'scale(1)' },
      ],
      duration: 1100,
      easing: 'cubic-bezier(.2,.7,.2,1)',
    }),
    envol: () => ({
      keyframes: [
        { opacity: 0, transform: 'translateY(56px)' },
        { opacity: 1, transform: 'translateY(0)' },
      ],
      duration: 950,
      easing: 'cubic-bezier(.2,.8,.2,1)',
    }),
    page: (dir) => ({
      origin: dir > 0 ? 'left center' : 'right center',
      keyframes: [
        { opacity: 0, transform: `${P} rotateY(${dir > 0 ? -82 : 82}deg)` },
        { opacity: 1, offset: 0.3 },
        { opacity: 1, transform: `${P} rotateY(0deg)` },
      ],
      duration: 1150,
      easing: 'cubic-bezier(.25,.8,.25,1)',
    }),
    glisse: (dir) => ({
      keyframes: [
        { opacity: 0, transform: `translateX(${dir * 16}vw) rotate(${dir * 3}deg)` },
        { opacity: 1, transform: 'translateX(0) rotate(0deg)' },
      ],
      duration: 900,
      easing: 'cubic-bezier(.2,.8,.2,1)',
    }),
    profondeur: () => ({
      keyframes: [
        { opacity: 0, transform: `${P} translateZ(-340px) rotateX(12deg)` },
        { opacity: 1, transform: `${P} translateZ(0px) rotateX(0deg)` },
      ],
      duration: 1150,
      easing: 'cubic-bezier(.2,.75,.25,1)',
    }),
    flou: () => ({
      keyframes: [
        { opacity: 0, filter: 'blur(22px)', transform: 'scale(1.05)' },
        { opacity: 1, filter: 'blur(0px)', transform: 'scale(1)' },
      ],
      duration: 1150,
      easing: 'ease-out',
    }),
    rebond: () => ({
      keyframes: [
        { opacity: 0, transform: 'scale(.82)' },
        { opacity: 1, transform: 'scale(1.045)', offset: 0.55 },
        { opacity: 1, transform: 'scale(.988)', offset: 0.8 },
        { opacity: 1, transform: 'scale(1)' },
      ],
      duration: 1000,
      easing: 'ease-out',
    }),
    polaroid: () => ({
      keyframes: [
        { opacity: 0, transform: 'translateY(-46px) rotate(-7deg) scale(1.06)' },
        { opacity: 1, transform: 'translateY(4px) rotate(1.2deg) scale(1)', offset: 0.7 },
        { opacity: 1, transform: 'translateY(0) rotate(0deg) scale(1)' },
      ],
      duration: 1050,
      easing: 'cubic-bezier(.3,.7,.3,1)',
    }),
  };
  const TRANSITION_NAMES = Object.keys(TRANSITIONS);

  function createAlbum(els) {
    const { stage, counter, progressFill, toggleBtn, prevBtn, nextBtn, toast, ambientLayers, onFinish } = els;

    let items = [];
    let index = -1; // souvenir affiché
    let intended = -1; // souvenir demandé (peut être en avance pendant une transition)
    let current = null;
    let busy = false;
    let target = null;
    let active = false;
    let finished = false;
    let autoplay = true;
    let recentTransitions = [];
    let runningAnimations = [];
    let preloaded = null;
    let photoElapsed = 0;
    let lastTick = 0;
    let rafId = 0;
    let endTimer = 0;
    let toastTimer = 0;
    let ambientSide = 0;
    let resumeOnVisible = false;

    /* ---------- L'unique lecteur vidéo ---------- */

    const video = document.createElement('video');
    video.className = 'memory-media';
    video.playsInline = true;
    video.setAttribute('playsinline', '');
    video.setAttribute('webkit-playsinline', '');
    video.preload = 'auto';
    video.controls = false;
    video.disablePictureInPicture = true;

    video.addEventListener('timeupdate', () => {
      if (current && current.kind === 'video' && video.duration) {
        setProgress(video.currentTime / video.duration);
      }
    });
    video.addEventListener('play', updateToggle);
    video.addEventListener('pause', updateToggle);
    video.addEventListener('playing', () => {
      if (current && current.kind === 'video') hideGate(current);
    });
    video.addEventListener('loadedmetadata', () => {
      if (current && current.kind === 'video') layout(current);
    });
    video.addEventListener('ended', () => {
      if (!current || current.kind !== 'video') return;
      const ending = current;
      setProgress(1);
      clearTimeout(endTimer);
      endTimer = setTimeout(() => {
        if (current === ending && active) next();
      }, VIDEO_END_PAUSE_MS);
    });
    video.addEventListener('error', () => {
      // Erreur en pleine lecture (pendant la préparation, c'est prepare() qui gère).
      if (current && current.kind === 'video' && !busy) {
        showToast("Cette vidéo n'a pas pu être lue, on passe à la suite 💌");
        next();
      }
    });

    function detachVideo() {
      video.pause();
      video.removeAttribute('src');
      video.load(); // libère les données déjà chargées
    }

    /* ---------- Préparation d'un souvenir ---------- */

    function buildSlide(item) {
      const slide = document.createElement('div');
      slide.className = 'slide';
      const card = document.createElement('figure');
      card.className = 'card card--' + item.kind;
      card.style.setProperty('--tilt', U.rand(-1.4, 1.4).toFixed(2) + 'deg');
      const frame = document.createElement('div');
      frame.className = 'card-media';
      const caption = document.createElement('figcaption');
      caption.className = 'card-caption';
      card.append(frame, caption);
      slide.appendChild(card);
      return { slide, card, frame, caption };
    }

    function waitForImage(img) {
      if (img.complete && img.naturalWidth) return Promise.resolve(true);
      return new Promise((resolve) => {
        const timer = setTimeout(() => done(false), 20000);
        function done(ok) {
          clearTimeout(timer);
          img.removeEventListener('load', onLoad);
          img.removeEventListener('error', onError);
          resolve(ok);
        }
        function onLoad() {
          done(img.naturalWidth > 0);
        }
        function onError() {
          done(false);
        }
        img.addEventListener('load', onLoad);
        img.addEventListener('error', onError);
      });
    }

    /** 'ok' | 'fail' | 'slow' (on affiche quand même, la taille se corrigera). */
    function waitForVideoMetadata() {
      if (video.readyState >= 1) return Promise.resolve('ok');
      return new Promise((resolve) => {
        const timer = setTimeout(() => done('slow'), 5000);
        function done(result) {
          clearTimeout(timer);
          video.removeEventListener('loadedmetadata', onMeta);
          video.removeEventListener('error', onError);
          resolve(result);
        }
        function onMeta() {
          done('ok');
        }
        function onError() {
          done('fail');
        }
        video.addEventListener('loadedmetadata', onMeta);
        video.addEventListener('error', onError);
      });
    }

    async function prepare(item) {
      const parts = buildSlide(item);
      const entry = Object.assign({ item, kind: item.kind, ok: true, ambient: null, gate: null }, parts);

      if (item.kind === 'image') {
        let img;
        if (preloaded && preloaded.item === item) {
          img = preloaded.img;
        } else {
          img = new Image();
          img.decoding = 'async';
          img.src = L.urlFor(item);
        }
        preloaded = null;
        img.className = 'memory-media';
        img.alt = 'Un de nos souvenirs';
        img.draggable = false;
        entry.ok = await waitForImage(img);
        if (entry.ok && img.decode) {
          try {
            await img.decode();
          } catch (_) {
            /* déjà décodée ou décodage différé : sans importance */
          }
        }
        entry.media = img;
        entry.width = img.naturalWidth;
        entry.height = img.naturalHeight;
        if (entry.ok) entry.ambient = ambientFrom(img, entry.width, entry.height);
      } else {
        video.muted = false;
        video.src = L.urlFor(item);
        video.load();
        const state = await waitForVideoMetadata();
        entry.ok = state !== 'fail';
        entry.media = video;
        entry.width = video.videoWidth || item.width || 16;
        entry.height = video.videoHeight || item.height || 9;
        entry.gate = buildGate();
      }

      if (entry.ok) {
        entry.frame.appendChild(entry.media);
        if (entry.gate) entry.frame.appendChild(entry.gate);
        const date = await L.dateOf(item);
        entry.caption.textContent = date ? A.exif.formatDate(date) : '';
        entry.caption.classList.toggle('card-caption--heart', !date);
      }
      return entry;
    }

    function buildGate() {
      const gate = document.createElement('button');
      gate.type = 'button';
      gate.className = 'video-gate';
      gate.hidden = true;
      gate.innerHTML =
        '<span class="video-gate-icon" aria-hidden="true"><svg viewBox="0 0 24 24"><path d="M8 5.5v13l11-6.5z"/></svg></span>' +
        '<span class="video-gate-label">Lancer la vidéo</span>';
      gate.addEventListener('click', (e) => {
        e.stopPropagation();
        autoplay = true;
        playVideo();
      });
      return gate;
    }

    function showGate(entry) {
      if (entry && entry.gate) entry.gate.hidden = false;
      updateToggle();
    }

    function hideGate(entry) {
      if (entry && entry.gate) entry.gate.hidden = true;
    }

    /** Miniature floue pour l'ambiance d'arrière-plan (40 px : quasi gratuit). */
    function ambientFrom(source, w, h) {
      try {
        const canvas = document.createElement('canvas');
        const scale = 40 / Math.max(w, h);
        canvas.width = Math.max(1, Math.round(w * scale));
        canvas.height = Math.max(1, Math.round(h * scale));
        canvas.getContext('2d').drawImage(source, 0, 0, canvas.width, canvas.height);
        return canvas.toDataURL('image/jpeg', 0.7);
      } catch (_) {
        return null;
      }
    }

    function setAmbient(dataUrl) {
      ambientSide = 1 - ambientSide;
      const on = ambientLayers[ambientSide];
      const off = ambientLayers[1 - ambientSide];
      if (dataUrl) on.style.backgroundImage = `url("${dataUrl}")`;
      on.classList.toggle('is-on', !!dataUrl);
      off.classList.remove('is-on');
    }

    /* ---------- Mise en page ---------- */

    function layout(entry) {
      if (!entry || !entry.ok) return;
      if (entry.kind === 'video' && video.videoWidth) {
        entry.width = video.videoWidth;
        entry.height = video.videoHeight;
      }
      const small = window.innerWidth < 600;
      const pad = small ? 7 : 12;
      const captionH = small ? 30 : 40;
      const maxW = stage.clientWidth - pad * 2 - (small ? 18 : 48);
      const maxH = stage.clientHeight - pad - captionH - (small ? 14 : 28);
      const size = U.fitContain(entry.width, entry.height, Math.max(80, maxW), Math.max(80, maxH), 1.6);
      entry.frame.style.width = size.width + 'px';
      entry.frame.style.height = size.height + 'px';
    }

    /* ---------- Animations ---------- */

    function track(animation) {
      runningAnimations.push(animation);
      U.settle(animation).then(() => {
        runningAnimations = runningAnimations.filter((a) => a !== animation);
      });
      return animation;
    }

    /** Accélère la transition en cours quand on navigue vite. */
    function hurry() {
      for (const a of runningAnimations) {
        if (a.updatePlaybackRate) a.updatePlaybackRate(4);
        else a.playbackRate = 4;
      }
    }

    function pickTransition() {
      const choices = TRANSITION_NAMES.filter((n) => recentTransitions.indexOf(n) === -1);
      const name = choices[U.randomInt(choices.length)];
      recentTransitions = [name].concat(recentTransitions).slice(0, 3);
      return name;
    }

    function enter(entry, dir) {
      let spec;
      if (U.prefersReducedMotion()) {
        spec = { keyframes: [{ opacity: 0 }, { opacity: 1 }], duration: 380, easing: 'ease-out' };
        entry.slide.dataset.transition = 'fondu-doux';
      } else {
        const name = pickTransition();
        spec = TRANSITIONS[name](dir);
        entry.slide.dataset.transition = name;
      }
      entry.slide.style.transformOrigin = spec.origin || 'center center';
      return U.settle(track(entry.slide.animate(spec.keyframes, { duration: spec.duration, easing: spec.easing })));
    }

    function exit(entry, dir) {
      const reduced = U.prefersReducedMotion();
      const keyframes = reduced
        ? [{ opacity: 1 }, { opacity: 0 }]
        : [
            { opacity: 1, transform: 'none' },
            { opacity: 0, transform: `translateX(${-dir * 38}px) scale(.95)` },
          ];
      return U.settle(
        track(entry.slide.animate(keyframes, { duration: reduced ? 220 : 400, easing: 'ease-in', fill: 'forwards' }))
      );
    }

    /* ---------- Navigation ---------- */

    function updateCounter() {
      counter.textContent = `${index + 1} / ${items.length}`;
      prevBtn.disabled = intended <= 0;
    }

    function keepUrls(i) {
      const keep = new Set([items[i - 1], items[i], items[i + 1]].filter(Boolean));
      L.keepOnly(items, keep);
    }

    function preloadAfter(i) {
      const item = items[i + 1];
      if (!item || item.kind !== 'image') return;
      const img = new Image();
      img.decoding = 'async';
      img.src = L.urlFor(item);
      if (img.decode) img.decode().catch(() => {});
      preloaded = { item, img };
    }

    async function transitionTo(i, dir) {
      stopPhotoTimer();
      clearTimeout(endTimer);
      const item = items[i];
      const old = current;
      if (old && old.kind === 'video') video.pause();
      setProgress(0);

      // L'unique <video> ne peut être rechargé qu'une fois l'ancienne vidéo partie.
      let preparing = old && old.kind === 'video' && item.kind === 'video' ? null : prepare(item);

      if (old) {
        await exit(old, dir);
        old.slide.remove();
        if (old.kind === 'video' && item.kind !== 'video') detachVideo();
        current = null;
      }
      if (!preparing) preparing = prepare(item);
      const entry = await preparing;
      if (!active) {
        if (entry.kind === 'video') detachVideo();
        return {};
      }

      index = i;
      updateCounter();
      keepUrls(i);

      if (!entry.ok) {
        item.broken = true;
        if (entry.kind === 'video') detachVideo();
        showToast("Un souvenir n'a pas pu être lu, on passe à la suite 💌");
        return { skip: true };
      }

      stage.appendChild(entry.slide);
      layout(entry);
      current = entry;
      setAmbient(entry.ambient);
      updateToggle();
      await enter(entry, dir);
      if (current !== entry || !active) return {};
      startMedia(entry);
      preloadAfter(i);
      return {};
    }

    async function run() {
      busy = true;
      while (target && active) {
        const { i, dir } = target;
        target = null;
        const result = await transitionTo(i, dir);
        if (result.skip && !target && active) {
          let n = i + (dir < 0 ? -1 : 1);
          if (n < 0) n = i + 1;
          if (n >= items.length) {
            busy = false;
            finish();
            return;
          }
          intended = n;
          target = { i: n, dir: n > i ? 1 : -1 };
        }
      }
      busy = false;
    }

    function request(i, dir) {
      if (!active || finished || i < 0) return;
      if (i >= items.length) {
        finish();
        return;
      }
      intended = i;
      target = { i, dir };
      prevBtn.disabled = intended <= 0;
      if (busy) hurry();
      else run();
    }

    function next() {
      request(intended + 1, 1);
    }

    function prev() {
      if (intended > 0) request(intended - 1, -1);
    }

    function finish() {
      if (finished) return;
      finished = true;
      target = null;
      stopPhotoTimer();
      clearTimeout(endTimer);
      video.pause();
      setProgress(1);
      onFinish();
    }

    /* ---------- Lecture ---------- */

    function setProgress(ratio) {
      progressFill.style.transform = `scaleX(${Math.max(0, Math.min(1, ratio))})`;
    }

    function startMedia(entry) {
      if (entry.kind === 'image') {
        photoElapsed = 0;
        if (autoplay) startPhotoTimer();
      } else if (autoplay) {
        playVideo();
      } else {
        showGate(entry);
      }
      updateToggle();
    }

    /** Essaie de lancer la vidéo avec le son ; si le navigateur refuse, bouton manuel. */
    function playVideo() {
      const entry = current;
      if (!entry || entry.kind !== 'video') return;
      video.muted = false;
      let attempt;
      try {
        attempt = video.play();
      } catch (err) {
        attempt = Promise.reject(err);
      }
      if (attempt && attempt.then) {
        attempt.then(
          () => hideGate(entry),
          (err) => {
            if (current !== entry) return;
            if (err && err.name === 'AbortError') return;
            // Lecture automatique avec le son bloquée : on attend un toucher.
            showGate(entry);
          }
        );
      }
    }

    function startPhotoTimer() {
      cancelAnimationFrame(rafId);
      lastTick = performance.now();
      rafId = requestAnimationFrame(tick);
    }

    function stopPhotoTimer() {
      cancelAnimationFrame(rafId);
      rafId = 0;
    }

    function tick(now) {
      if (!active || !autoplay || !current || current.kind !== 'image' || target) {
        rafId = 0;
        return;
      }
      photoElapsed += Math.min(100, now - lastTick);
      lastTick = now;
      setProgress(photoElapsed / PHOTO_DURATION_MS);
      if (photoElapsed >= PHOTO_DURATION_MS) {
        rafId = 0;
        next();
        return;
      }
      rafId = requestAnimationFrame(tick);
    }

    function isPlaying() {
      if (current && current.kind === 'video') return !video.paused && !video.ended;
      return autoplay;
    }

    function updateToggle() {
      const playing = isPlaying();
      toggleBtn.classList.toggle('is-paused', !playing);
      toggleBtn.setAttribute('aria-label', playing ? 'Mettre en pause' : 'Reprendre la lecture');
    }

    function toggle() {
      if (!current || busy) {
        autoplay = !autoplay;
      } else if (current.kind === 'video') {
        if (video.paused || video.ended) {
          autoplay = true;
          playVideo();
        } else {
          autoplay = false;
          video.pause();
        }
      } else {
        autoplay = !autoplay;
        if (autoplay) startPhotoTimer();
        else stopPhotoTimer();
      }
      updateToggle();
    }

    function showToast(text) {
      toast.textContent = text;
      toast.classList.add('is-visible');
      clearTimeout(toastTimer);
      toastTimer = setTimeout(() => toast.classList.remove('is-visible'), 2800);
    }

    /* ---------- Gestes et clavier ---------- */

    let press = null;
    stage.addEventListener('pointerdown', (e) => {
      if (e.target.closest('.video-gate')) return;
      press = { x: e.clientX, y: e.clientY, t: performance.now() };
    });
    stage.addEventListener('pointerup', (e) => {
      if (!press) return;
      const dx = e.clientX - press.x;
      const dy = e.clientY - press.y;
      press = null;
      if (Math.abs(dx) > SWIPE_MIN_PX && Math.abs(dx) > Math.abs(dy) * 1.2) {
        if (dx < 0) next();
        else prev();
      } else if (Math.abs(dx) < 10 && Math.abs(dy) < 10 && e.target === video) {
        toggle(); // un toucher sur la vidéo = pause / reprise
      }
    });
    stage.addEventListener('pointercancel', () => {
      press = null;
    });

    prevBtn.addEventListener('click', prev);
    nextBtn.addEventListener('click', next);
    toggleBtn.addEventListener('click', toggle);

    function onKey(e) {
      if (!active || finished) return;
      if (e.key === 'ArrowRight') next();
      else if (e.key === 'ArrowLeft') prev();
      else if (e.key === ' ' || e.key === 'k') {
        if (e.target && e.target.tagName === 'BUTTON') return; // le bouton gère déjà Espace
        e.preventDefault();
        toggle();
      } else return;
    }
    document.addEventListener('keydown', onKey);

    window.addEventListener('resize', () => layout(current));
    document.addEventListener('visibilitychange', () => {
      if (!current || current.kind !== 'video') return;
      if (document.hidden) {
        resumeOnVisible = !video.paused;
        video.pause();
      } else if (resumeOnVisible) {
        resumeOnVisible = false;
        playVideo();
      }
    });

    /* ---------- API ---------- */

    function start(playlist) {
      stop();
      items = playlist;
      index = -1;
      intended = -1;
      finished = false;
      active = true;
      autoplay = true;
      recentTransitions = [];
      counter.textContent = `1 / ${items.length}`;
      request(0, 1);
    }

    function stop() {
      active = false;
      target = null;
      stopPhotoTimer();
      clearTimeout(endTimer);
      runningAnimations.forEach((a) => a.cancel());
      runningAnimations = [];
      if (current) current.slide.remove();
      current = null;
      stage.textContent = '';
      detachVideo();
      preloaded = null;
      L.releaseAll(items);
      setAmbient(null);
      setProgress(0);
    }

    return {
      start,
      stop,
      next,
      prev,
      toggle,
      /** Pour les tests et le débogage. */
      get state() {
        return {
          index,
          total: items.length,
          kind: current ? current.kind : null,
          name: current ? current.item.name : null,
          transition: current ? current.slide.dataset.transition : null,
          slides: stage.querySelectorAll('.slide').length,
          busy,
          finished,
          playing: isPlaying(),
          liveUrls: items.filter((it) => it.url).length,
        };
      },
      get order() {
        return items.map((it) => it.name);
      },
    };
  }

  A.createAlbum = createAlbum;
})(window.Amour);
