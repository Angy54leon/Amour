/*
 * Écran d'accueil : le bouton taquin.
 * Règle exacte : les tentatives 1, 2 et 3 font esquiver le bouton,
 * la 4e tentative ouvre l'album. Une tentative = un appui (souris, doigt,
 * stylet) ou une activation clavier sur le bouton.
 */
(function (A) {
  'use strict';

  const U = A.utils;
  const DODGES = 3;
  const MARGIN = 16;
  const PRESS_CLICK_WINDOW_MS = 1500;
  const TEASES = [
    'Hé ! Pas si vite 😜',
    'Presque… encore un petit effort 🙈',
    "Bon d'accord, cette fois c'est la bonne 🥰",
  ];

  function createIntro({ button, slot, question, tease, onOpen }) {
    let dodges = 0;
    let pressWasDodged = false;
    let pressTime = 0;
    let opened = false;
    let lastPointer = null;
    let moveAnimation = null;

    function reset() {
      dodges = 0;
      pressWasDodged = false;
      opened = false;
      lastPointer = null;
      if (moveAnimation) moveAnimation.cancel();
      button.classList.remove('is-free', 'is-ready', 'is-opening');
      button.style.left = button.style.top = '';
      slot.style.minHeight = '';
      tease.textContent = '';
    }

    function rectsOverlap(a, b, pad) {
      return !(
        a.right + pad < b.left ||
        a.left - pad > b.right ||
        a.bottom + pad < b.top ||
        a.top - pad > b.bottom
      );
    }

    /** Nouvelle position : visible, loin du doigt/curseur, sans cacher la question. */
    function pickPosition(from) {
      const vp = U.viewportSize();
      const w = button.offsetWidth;
      const h = button.offsetHeight;
      const maxX = Math.max(MARGIN, vp.width - w - MARGIN);
      const maxY = Math.max(MARGIN, vp.height - h - MARGIN);
      const avoid = [question.getBoundingClientRect(), tease.getBoundingClientRect()];
      const pointer = lastPointer || { x: from.x + w / 2, y: from.y + h / 2 };
      const minJump = Math.min(220, Math.hypot(vp.width, vp.height) * 0.28);

      let best = null;
      for (let i = 0; i < 40; i++) {
        const x = U.rand(MARGIN, maxX);
        const y = U.rand(MARGIN, maxY);
        const box = { left: x, top: y, right: x + w, bottom: y + h };
        const cx = x + w / 2;
        const cy = y + h / 2;
        const distPointer = Math.hypot(cx - pointer.x, cy - pointer.y);
        const distJump = Math.hypot(x - from.x, y - from.y);
        let score = distPointer + Math.min(distJump, minJump);
        if (distJump < minJump) score -= 400;
        if (avoid.some((r) => r.width && rectsOverlap(box, r, 12))) score -= 1000;
        if (!best || score > best.score) best = { x, y, score };
      }
      return { x: Math.min(Math.max(best.x, MARGIN), maxX), y: Math.min(Math.max(best.y, MARGIN), maxY) };
    }

    function dodge() {
      const before = button.getBoundingClientRect();
      if (!button.classList.contains('is-free')) {
        // On garde la place du bouton dans la mise en page avant de le libérer.
        slot.style.minHeight = slot.offsetHeight + 'px';
        button.classList.add('is-free');
      }
      const target = pickPosition({ x: before.left, y: before.top });
      button.style.left = target.x + 'px';
      button.style.top = target.y + 'px';

      const dx = before.left - target.x;
      const dy = before.top - target.y;
      if (moveAnimation) moveAnimation.cancel();
      const reduced = U.prefersReducedMotion();
      moveAnimation = button.animate(
        reduced
          ? [{ transform: `translate(${dx}px, ${dy}px)`, opacity: 0.4 }, { transform: 'none', opacity: 1 }]
          : [
              { transform: `translate(${dx}px, ${dy}px) scale(1) rotate(0deg)` },
              { transform: `translate(${dx * 0.45}px, ${dy * 0.45}px) scale(0.86) rotate(${dx > 0 ? -8 : 8}deg)`, offset: 0.35 },
              { transform: 'translate(0, 0) scale(1.06) rotate(0deg)', offset: 0.75 },
              { transform: 'none' },
            ],
        { duration: reduced ? 200 : 620, easing: reduced ? 'ease-out' : 'cubic-bezier(.3,1.35,.5,1)' }
      );

      dodges++;
      tease.textContent = TEASES[dodges - 1] || '';
      tease.classList.remove('is-visible');
      void tease.offsetWidth; // relance l'animation du petit texte
      tease.classList.add('is-visible');
      if (dodges === DODGES) button.classList.add('is-ready');
    }

    function open() {
      if (opened) return;
      opened = true;
      button.classList.add('is-opening');
      const r = button.getBoundingClientRect();
      A.hearts.burst(r.left + r.width / 2, r.top + r.height / 2, 14);
      onOpen();
    }

    /** Une tentative : esquive tant qu'on n'a pas esquivé 3 fois, sinon ouvre. */
    function attempt() {
      if (opened) return;
      if (dodges < DODGES) dodge();
      else open();
    }

    button.addEventListener('pointerdown', (e) => {
      lastPointer = { x: e.clientX, y: e.clientY };
      pressTime = performance.now();
      pressWasDodged = dodges < DODGES;
      if (pressWasDodged) {
        e.preventDefault(); // pas de focus/sélection, le bouton file avant le relâchement
        attempt();
      }
    });

    button.addEventListener('click', () => {
      // Le clic qui suit un appui déjà esquivé (souris ou doigt) ne compte pas
      // une 2e fois. Sans appui récent, c'est le clavier ou un lecteur d'écran.
      const followsDodgedPress = pressWasDodged && performance.now() - pressTime < PRESS_CLICK_WINDOW_MS;
      pressWasDodged = false;
      if (followsDodgedPress) return;
      attempt();
    });

    // Le bouton ne doit jamais sortir de l'écran (rotation, barre Safari…).
    function keepInside() {
      if (!button.classList.contains('is-free')) return;
      const vp = U.viewportSize();
      const x = Math.min(Math.max(parseFloat(button.style.left) || MARGIN, MARGIN), Math.max(MARGIN, vp.width - button.offsetWidth - MARGIN));
      const y = Math.min(Math.max(parseFloat(button.style.top) || MARGIN, MARGIN), Math.max(MARGIN, vp.height - button.offsetHeight - MARGIN));
      button.style.left = x + 'px';
      button.style.top = y + 'px';
    }
    window.addEventListener('resize', keepInside);
    if (window.visualViewport) window.visualViewport.addEventListener('resize', keepInside);

    return {
      reset,
      get dodges() {
        return dodges;
      },
    };
  }

  A.createIntro = createIntro;
})(window.Amour);
