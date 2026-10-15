#!/usr/bin/env node
/*
 * Prépare un dossier dist/ prêt à être mis en ligne.
 *
 *   npm run build:site
 *       → le site seul, SANS aucune photo (GitHub Pages, Netlify…).
 *         On ajoute les souvenirs depuis l'iPhone avec « Ajouter nos souvenirs ».
 *
 *   npm run build
 *       → le site + nos-souvenirs/ allégé + souvenirs.json : l'album se lance
 *         directement pour qui ouvre le lien. Les vidéos sont recompressées en
 *         MP4 (H.264, 1280 px max) si ffmpeg est installé, pour que le
 *         téléphone les charge vite.
 *
 * Options : --source=chemin  --sortie=dist  --sans-medias  --copie-brute  --max-video=1920
 */
import { promises as fs } from 'node:fs';
import { spawnSync } from 'node:child_process';
import path from 'node:path';
import { projectRoot, scanMedia, exifDate, toUrl, formatSize } from './medias.mjs';

const args = Object.fromEntries(
  process.argv.slice(2).map((a) => {
    const [k, v] = a.replace(/^--/, '').split('=');
    return [k, v === undefined ? true : v];
  })
);

const source = path.resolve(projectRoot, args.source || 'nos-souvenirs');
const out = path.resolve(projectRoot, args.sortie || 'dist');
const withMedia = !args['sans-medias'];
const maxVideo = Number(args['max-video']) || 1280;

if (out === projectRoot || !out.startsWith(projectRoot + path.sep)) {
  console.error('❌ Le dossier de sortie doit être un sous-dossier du projet.');
  process.exit(1);
}

const APP_FILES = ['index.html', 'manifest.webmanifest', 'css', 'js', 'icons'];

await fs.rm(out, { recursive: true, force: true });
await fs.mkdir(out, { recursive: true });
for (const f of APP_FILES) {
  await fs.cp(path.join(projectRoot, f), path.join(out, f), { recursive: true });
}
console.log(`✅ Site copié dans ${path.relative(projectRoot, out)}/`);

if (!withMedia) {
  console.log('   (sans médias : les souvenirs s\'ajoutent depuis le téléphone)');
  process.exit(0);
}

const hasSource = await fs.stat(source).then((s) => s.isDirectory()).catch(() => false);
if (!hasSource) {
  console.error(`❌ Dossier introuvable : ${source}\n   Copie nos-souvenirs/ à la racine du projet, ou utilise --sans-medias.`);
  process.exit(1);
}

const hasFfmpeg = !args['copie-brute'] && spawnSync('ffmpeg', ['-version'], { stdio: 'ignore' }).status === 0;
if (!hasFfmpeg && !args['copie-brute']) {
  console.log('ℹ️  ffmpeg introuvable : les vidéos sont copiées telles quelles (plus lourdes).');
}

const media = await scanMedia(source);
const mediaDir = path.join(out, 'nos-souvenirs');
const used = new Set();
const items = [];
let totalIn = 0;
let totalOut = 0;
let index = 0;
const skippedFiles = [];

function uniqueRel(rel) {
  let candidate = rel;
  let n = 2;
  while (used.has(candidate.toLowerCase())) {
    const ext = path.extname(rel);
    candidate = rel.slice(0, -ext.length) + '-' + n++ + ext;
  }
  used.add(candidate.toLowerCase());
  return candidate;
}

for (const m of media) {
  index++;
  totalIn += m.size;
  const transcode = m.kind === 'video' && hasFfmpeg;
  const rel = uniqueRel(transcode ? m.rel.replace(/\.[^.]+$/, '.mp4') : m.rel);
  const dest = path.join(mediaDir, rel);
  await fs.mkdir(path.dirname(dest), { recursive: true });
  process.stdout.write(`\r  ${index}/${media.length} fichiers traités…`);

  if (transcode) {
    const scale = `scale='if(gt(iw,ih),min(${maxVideo},iw),-2)':'if(gt(iw,ih),-2,min(${maxVideo},ih))'`;
    const r = spawnSync(
      'ffmpeg',
      ['-hide_banner', '-loglevel', 'error', '-y', '-i', m.abs, '-vf', scale,
        '-c:v', 'libx264', '-preset', 'medium', '-crf', '24', '-pix_fmt', 'yuv420p',
        '-c:a', 'aac', '-b:a', '128k', '-movflags', '+faststart', dest],
      { stdio: ['ignore', 'ignore', 'pipe'] }
    );
    if (r.status !== 0) {
      // ffmpeg n'arrive pas à la lire : le téléphone n'y arrivera sans doute pas non plus.
      await fs.rm(dest, { force: true });
      skippedFiles.push(m.rel);
      continue;
    }
  } else {
    await fs.copyFile(m.abs, dest);
  }

  const stat = await fs.stat(dest);
  totalOut += stat.size;
  items.push({
    src: 'nos-souvenirs/' + toUrl(rel),
    kind: m.kind,
    name: path.basename(rel),
    size: stat.size,
    lastModified: Math.round(m.mtimeMs),
    date: m.kind === 'image' ? await exifDate(m.abs) : null,
  });
}

await fs.writeFile(
  path.join(out, 'souvenirs.json'),
  JSON.stringify({ generatedAt: new Date().toISOString(), items }, null, 2)
);

const photos = items.filter((i) => i.kind === 'image').length;
console.log(`\n✅ ${photos} photos et ${items.length - photos} vidéos dans ${path.relative(projectRoot, out)}/`);
console.log(`   Poids : ${formatSize(totalIn)} → ${formatSize(totalOut)}`);
if (skippedFiles.length) {
  console.log(`⚠️  Vidéo(s) illisible(s) par ffmpeg, écartée(s) : ${skippedFiles.join(', ')}`);
}
const heavy = items.filter((i) => i.size > 25 * 1024 * 1024);
if (heavy.length) {
  console.log(`⚠️  ${heavy.length} fichier(s) dépassent 25 Mo : certains hébergeurs les refusent.`);
}
const heic = items.filter((i) => /\.hei[cf]$/i.test(i.name)).length;
if (heic) {
  console.log(`ℹ️  ${heic} photo(s) HEIC : visibles sur iPhone (Safari), mais pas dans tous les navigateurs.`);
}
console.log('   Prochaine étape : mettre ce dossier en ligne (voir README).');
