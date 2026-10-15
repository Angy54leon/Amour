/*
 * Ordre de lecture : vraiment aléatoire, mais "intelligent".
 *  - photos et vidéos mélangées séparément (Fisher-Yates) ;
 *  - les vidéos sont réparties entre les photos pour éviter deux vidéos
 *    d'affilée (dès qu'il y a assez de photos) ;
 *  - les photos "jumelles" (rafales : prises à quelques secondes d'écart ou
 *    numéros de fichiers qui se suivent) sont écartées l'une de l'autre ;
 *  - chaque média apparaît exactement une fois par lecture.
 */
(function (A) {
  'use strict';

  const U = A.utils;
  const BURST_WINDOW_MS = 2 * 60 * 1000;

  /** Préfixe + numéro d'un nom type IMG_1234.JPG → { stem: 'img_', n: 1234 }. */
  function numbering(name) {
    const m = /^(.*?)(\d+)(?:\D*)\.[^.]+$/.exec(name.toLowerCase());
    return m ? { stem: m[1], n: Number(m[2]) } : null;
  }

  /** Les dates de fichier sont-elles exploitables (pas toutes identiques à la copie) ? */
  function timestampsAreMeaningful(photos) {
    const times = photos.map((p) => p.lastModified).filter(Boolean).sort((a, b) => a - b);
    if (times.length < 4) return false;
    const gaps = [];
    for (let i = 1; i < times.length; i++) gaps.push(times[i] - times[i - 1]);
    gaps.sort((a, b) => a - b);
    return gaps[Math.floor(gaps.length / 2)] > 5000;
  }

  function makeSimilarity(photos) {
    const useTime = timestampsAreMeaningful(photos);
    const nums = new Map(photos.map((p) => [p, numbering(p.name)]));
    return function similar(a, b) {
      if (!a || !b) return false;
      if (useTime && a.lastModified && b.lastModified &&
          Math.abs(a.lastModified - b.lastModified) < BURST_WINDOW_MS) {
        return true;
      }
      const na = nums.get(a);
      const nb = nums.get(b);
      return !!(na && nb && na.stem === nb.stem && Math.abs(na.n - nb.n) <= 3);
    };
  }

  /** Échange des photos pour séparer les jumelles voisines (effort borné). */
  function separateSimilar(photos) {
    const similar = makeSimilarity(photos);
    const n = photos.length;
    if (n < 4) return photos;
    const fits = (item, pos, ignore) =>
      !similar(item, pos - 1 === ignore ? null : photos[pos - 1]) &&
      !similar(item, pos + 1 === ignore ? null : photos[pos + 1]);

    for (let i = 1; i < n; i++) {
      if (!similar(photos[i - 1], photos[i])) continue;
      for (let attempt = 0; attempt < 40; attempt++) {
        const j = U.randomInt(n);
        if (Math.abs(j - i) <= 1) continue;
        const a = photos[i];
        const b = photos[j];
        if (fits(b, i, j) && fits(a, j, i)) {
          photos[i] = b;
          photos[j] = a;
          break;
        }
      }
    }
    return photos;
  }

  /**
   * Choisit k positions distinctes et triées parmi n, bien réparties
   * mais avec du hasard dans chaque intervalle.
   */
  function spreadPositions(n, k) {
    const out = [];
    const stride = n / k;
    for (let j = 0; j < k; j++) {
      const lo = Math.ceil(j * stride);
      const hi = Math.ceil((j + 1) * stride) - 1;
      out.push(lo + U.randomInt(hi - lo + 1));
    }
    return out;
  }

  /** Intercale `few` dans les interstices de `many` (au plus un par interstice). */
  function interleave(many, few) {
    const gaps = spreadPositions(many.length + 1, few.length);
    const result = [];
    let g = 0;
    for (let i = 0; i <= many.length; i++) {
      if (g < gaps.length && gaps[g] === i) result.push(few[g++]);
      if (i < many.length) result.push(many[i]);
    }
    return result;
  }

  function build(items) {
    const photos = separateSimilar(U.shuffle(items.filter((it) => it.kind === 'image')));
    const videos = U.shuffle(items.filter((it) => it.kind === 'video'));
    if (!videos.length) return photos;
    if (!photos.length) return videos;
    if (videos.length <= photos.length + 1) return interleave(photos, videos);
    // Plus de vidéos que de photos : ce sont les photos qui servent d'intermèdes.
    return interleave(videos, photos);
  }

  A.playlist = { build };
})(window.Amour);
