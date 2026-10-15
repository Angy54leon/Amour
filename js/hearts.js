/* Cœurs décoratifs : un champ de cœurs flottants et des petites gerbes. */
(function (A) {
  'use strict';

  const U = A.utils;
  const HEART_PATH =
    'M12 21.35l-1.45-1.32C5.4 15.36 2 12.28 2 8.5 2 5.42 4.42 3 7.5 3c1.74 0 3.41.81 4.5 2.09' +
    'C13.09 3.81 14.76 3 16.5 3 19.58 3 22 5.42 22 8.5c0 3.78-3.4 6.86-8.55 11.54L12 21.35z';

  function heartSvg(className) {
    const ns = 'http://www.w3.org/2000/svg';
    const svg = document.createElementNS(ns, 'svg');
    svg.setAttribute('viewBox', '0 0 24 24');
    svg.setAttribute('class', className);
    const path = document.createElementNS(ns, 'path');
    path.setAttribute('d', HEART_PATH);
    svg.appendChild(path);
    return svg;
  }

  /** Remplit le conteneur de quelques cœurs qui montent doucement. */
  function fillField(container, count) {
    container.textContent = '';
    for (let i = 0; i < count; i++) {
      const heart = heartSvg('floating-heart');
      const size = U.rand(10, 26);
      heart.style.setProperty('--x', U.rand(2, 98).toFixed(1) + 'vw');
      heart.style.setProperty('--size', size.toFixed(0) + 'px');
      heart.style.setProperty('--duration', U.rand(14, 26).toFixed(1) + 's');
      heart.style.setProperty('--delay', (-U.rand(0, 26)).toFixed(1) + 's');
      heart.style.setProperty('--drift', U.rand(-40, 40).toFixed(0) + 'px');
      heart.style.setProperty('--y', U.rand(6, 90).toFixed(1) + 'vh');
      heart.style.setProperty('--alpha', U.rand(0.25, 0.6).toFixed(2));
      container.appendChild(heart);
    }
  }

  /** Petite gerbe de cœurs depuis un point de l'écran. */
  function burst(x, y, count) {
    if (U.prefersReducedMotion()) return;
    const layer = document.createElement('div');
    layer.className = 'burst-layer';
    document.body.appendChild(layer);
    const animations = [];
    for (let i = 0; i < count; i++) {
      const heart = heartSvg('burst-heart');
      const size = U.rand(12, 26);
      heart.style.width = heart.style.height = size + 'px';
      heart.style.left = x - size / 2 + 'px';
      heart.style.top = y - size / 2 + 'px';
      layer.appendChild(heart);
      const angle = (Math.PI * 2 * i) / count + U.rand(-0.3, 0.3);
      const distance = U.rand(70, 170);
      const dx = Math.cos(angle) * distance;
      const dy = Math.sin(angle) * distance - 40;
      animations.push(
        heart.animate(
          [
            { transform: 'translate(0,0) scale(0.2) rotate(0deg)', opacity: 0 },
            { transform: `translate(${dx * 0.6}px, ${dy * 0.6}px) scale(1) rotate(${U.rand(-20, 20)}deg)`, opacity: 1, offset: 0.35 },
            { transform: `translate(${dx}px, ${dy - 60}px) scale(0.7) rotate(${U.rand(-30, 30)}deg)`, opacity: 0 },
          ],
          { duration: U.rand(1000, 1500), easing: 'cubic-bezier(.2,.7,.3,1)', fill: 'forwards' }
        )
      );
    }
    Promise.all(animations.map(U.settle)).then(() => layer.remove());
  }

  A.hearts = { fillField, burst, heartSvg };
})(window.Amour);
