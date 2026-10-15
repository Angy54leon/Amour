/*
 * Lecture minimale de la date de prise de vue EXIF (JPEG uniquement).
 * Sert à écrire la date du souvenir au bas de la photo, façon Polaroid.
 * Si la date est absente ou illisible, on n'affiche simplement rien.
 */
(function (A) {
  'use strict';

  const TAG_EXIF_IFD = 0x8769;
  const TAG_DATETIME = 0x0132;
  const TAG_DATETIME_ORIGINAL = 0x9003;
  const TAG_DATETIME_DIGITIZED = 0x9004;

  function readExifDate(buffer) {
    try {
      const view = new DataView(buffer);
      const len = view.byteLength;
      if (len < 4 || view.getUint16(0) !== 0xffd8) return null;

      let offset = 2;
      while (offset + 4 <= len) {
        const marker = view.getUint16(offset);
        if ((marker & 0xff00) !== 0xff00) return null;
        if (marker === 0xffda) return null; // début de l'image : plus d'en-têtes
        const size = view.getUint16(offset + 2);
        if (
          marker === 0xffe1 &&
          offset + 10 <= len &&
          view.getUint32(offset + 4) === 0x45786966 && // "Exif"
          view.getUint16(offset + 8) === 0
        ) {
          return parseTiff(view, offset + 10);
        }
        offset += 2 + size;
      }
    } catch (_) {
      /* fichier tronqué ou exotique */
    }
    return null;
  }

  function parseTiff(view, tiff) {
    const len = view.byteLength;
    const little = view.getUint16(tiff) === 0x4949;
    const u16 = (o) => view.getUint16(o, little);
    const u32 = (o) => view.getUint32(o, little);
    if (u16(tiff + 2) !== 42) return null;

    function readIfd(ifdOffset, wanted) {
      const out = {};
      const base = tiff + ifdOffset;
      if (base + 2 > len) return out;
      const count = u16(base);
      for (let i = 0; i < count; i++) {
        const entry = base + 2 + i * 12;
        if (entry + 12 > len) break;
        const tag = u16(entry);
        if (wanted.indexOf(tag) !== -1) {
          out[tag] = { count: u32(entry + 4), valueOffset: entry + 8 };
        }
      }
      return out;
    }

    function readAscii(field) {
      const start = field.count > 4 ? tiff + u32(field.valueOffset) : field.valueOffset;
      let s = '';
      for (let i = 0; i < field.count && start + i < len; i++) {
        const c = view.getUint8(start + i);
        if (c === 0) break;
        s += String.fromCharCode(c);
      }
      return s;
    }

    const ifd0 = readIfd(u32(tiff + 4), [TAG_EXIF_IFD, TAG_DATETIME]);
    let raw = null;
    if (ifd0[TAG_EXIF_IFD]) {
      const exif = readIfd(u32(ifd0[TAG_EXIF_IFD].valueOffset), [
        TAG_DATETIME_ORIGINAL,
        TAG_DATETIME_DIGITIZED,
      ]);
      const field = exif[TAG_DATETIME_ORIGINAL] || exif[TAG_DATETIME_DIGITIZED];
      if (field) raw = readAscii(field);
    }
    if (!raw && ifd0[TAG_DATETIME]) raw = readAscii(ifd0[TAG_DATETIME]);
    return parseExifDateString(raw);
  }

  function parseExifDateString(raw) {
    if (!raw) return null;
    const m = /^(\d{4}):(\d{2}):(\d{2})[ T](\d{2}):(\d{2})/.exec(raw.trim());
    if (!m) return null;
    const year = Number(m[1]);
    if (year < 1990 || year > 2100) return null;
    const d = new Date(year, Number(m[2]) - 1, Number(m[3]), Number(m[4]), Number(m[5]));
    return isNaN(d.getTime()) ? null : d;
  }

  const formatter = new Intl.DateTimeFormat('fr-FR', {
    day: 'numeric',
    month: 'long',
    year: 'numeric',
  });

  function formatDate(date) {
    return date ? formatter.format(date) : '';
  }

  A.exif = { readExifDate, formatDate };
})(window.Amour);
