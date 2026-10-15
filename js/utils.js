/* Petits outils partagés par tous les modules. */
window.Amour = window.Amour || {};

(function (A) {
  'use strict';

  const reducedMotionQuery = window.matchMedia('(prefers-reduced-motion: reduce)');

  /** Vrai si le système demande de réduire les animations. */
  function prefersReducedMotion() {
    return reducedMotionQuery.matches;
  }

  /** Entier aléatoire uniforme dans [0, max), via crypto quand c'est possible. */
  function randomInt(max) {
    if (max <= 1) return 0;
    if (window.crypto && window.crypto.getRandomValues) {
      const buf = new Uint32Array(1);
      const limit = Math.floor(0x100000000 / max) * max;
      let x;
      do {
        window.crypto.getRandomValues(buf);
        x = buf[0];
      } while (x >= limit);
      return x % max;
    }
    return Math.floor(Math.random() * max);
  }

  /** Mélange de Fisher-Yates (renvoie une copie). */
  function shuffle(list) {
    const a = list.slice();
    for (let i = a.length - 1; i > 0; i--) {
      const j = randomInt(i + 1);
      [a[i], a[j]] = [a[j], a[i]];
    }
    return a;
  }

  function rand(min, max) {
    return min + Math.random() * (max - min);
  }

  /** Taille "contain" : tient dans la boîte sans déformation. */
  function fitContain(w, h, maxW, maxH, maxUpscale) {
    const scale = Math.min(maxW / w, maxH / h, maxUpscale || 1.6);
    return {
      width: Math.max(1, Math.floor(w * scale)),
      height: Math.max(1, Math.floor(h * scale)),
    };
  }

  function wait(ms) {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }

  function nextFrame() {
    return new Promise((resolve) => requestAnimationFrame(() => resolve()));
  }

  /** Taille réellement visible (tient compte du clavier / barres mobiles). */
  function viewportSize() {
    const vv = window.visualViewport;
    return {
      width: vv ? vv.width : window.innerWidth,
      height: vv ? vv.height : window.innerHeight,
    };
  }

  /** iPhone / iPad (les iPad récents se présentent comme des Mac tactiles). */
  const isIOS =
    /iP(hone|ad|od)/.test(navigator.platform || '') ||
    (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);

  /** Attend la fin d'une animation Web Animations sans jamais rejeter. */
  function settle(animation) {
    if (!animation) return Promise.resolve();
    return animation.finished.then(() => {}, () => {});
  }

  A.utils = {
    prefersReducedMotion,
    randomInt,
    shuffle,
    rand,
    fitContain,
    wait,
    nextFrame,
    viewportSize,
    settle,
    isIOS,
  };
})(window.Amour);
