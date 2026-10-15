#!/usr/bin/env node
/*
 * Génère souvenirs.json à partir du dossier nos-souvenirs/ placé dans le projet.
 * Le site lit ce fichier au démarrage et lance directement l'album
 * (pratique pour l'ouvrir sur l'iPhone via le Wi-Fi avec `npm start`).
 *
 * Usage : npm run liste
 *         node scripts/generer-liste.mjs chemin/vers/un/autre-dossier
 */
import { promises as fs } from 'node:fs';
import path from 'node:path';
import { projectRoot, scanMedia, exifDate, toUrl, formatSize } from './medias.mjs';

const source = path.resolve(projectRoot, process.argv[2] || 'nos-souvenirs');
const relSource = path.relative(projectRoot, source);

if (relSource.startsWith('..') || path.isAbsolute(relSource)) {
  console.error('❌ Le dossier de souvenirs doit se trouver dans le projet (ex. ./nos-souvenirs).');
  process.exit(1);
}

const exists = await fs.stat(source).then((s) => s.isDirectory()).catch(() => false);
if (!exists) {
  console.error(`❌ Dossier introuvable : ${source}\n   Copie ton dossier nos-souvenirs à la racine du projet.`);
  process.exit(1);
}

const media = await scanMedia(source);
const items = [];
for (const m of media) {
  items.push({
    src: toUrl(path.join(relSource, m.rel)),
    kind: m.kind,
    name: m.name,
    size: m.size,
    lastModified: Math.round(m.mtimeMs),
    date: m.kind === 'image' ? await exifDate(m.abs) : null,
  });
}

await fs.writeFile(
  path.join(projectRoot, 'souvenirs.json'),
  JSON.stringify({ generatedAt: new Date().toISOString(), items }, null, 2)
);

const photos = items.filter((i) => i.kind === 'image').length;
const total = media.reduce((s, m) => s + m.size, 0);
console.log(`✅ souvenirs.json : ${photos} photos, ${items.length - photos} vidéos (${formatSize(total)}).`);
const heic = media.filter((m) => /\.hei[cf]$/i.test(m.name)).length;
if (heic) console.log(`ℹ️  ${heic} photo(s) HEIC : lisibles dans Safari, pas dans tous les navigateurs.`);
console.log('   Lance maintenant : npm start');
