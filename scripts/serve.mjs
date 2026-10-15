#!/usr/bin/env node
/*
 * Petit serveur statique sans dépendance.
 *  - sert le site sur http://localhost:8080 et sur le Wi-Fi local
 *    (pour l'ouvrir depuis un iPhone connecté au même réseau) ;
 *  - gère les requêtes "Range", indispensables à Safari pour lire les vidéos.
 *
 * Usage : npm start            (port 8080)
 *         PORT=3000 npm start
 *         node scripts/serve.mjs dist   (sert un autre dossier)
 */
import { createServer } from 'node:http';
import { createReadStream, promises as fs } from 'node:fs';
import { networkInterfaces } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const root = path.resolve(projectRoot, process.argv[2] || '.');
const port = Number(process.env.PORT) || 8080;

const TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.webmanifest': 'application/manifest+json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.webp': 'image/webp',
  '.gif': 'image/gif',
  '.avif': 'image/avif',
  '.heic': 'image/heic',
  '.heif': 'image/heif',
  '.mp4': 'video/mp4',
  '.m4v': 'video/mp4',
  '.mov': 'video/quicktime',
  '.webm': 'video/webm',
  '.txt': 'text/plain; charset=utf-8',
};

const server = createServer(async (req, res) => {
  try {
    const url = new URL(req.url, 'http://localhost');
    let rel = decodeURIComponent(url.pathname);
    if (rel.endsWith('/')) rel += 'index.html';
    const file = path.resolve(root, '.' + rel);
    // Interdit de sortir du dossier servi (../../etc).
    if (file !== root && !file.startsWith(root + path.sep)) {
      res.writeHead(403).end('Interdit');
      return;
    }
    // Pas de fichiers cachés ni du dossier .git.
    if (rel.split('/').some((part) => part.startsWith('.'))) {
      res.writeHead(404).end('Introuvable');
      return;
    }
    const stat = await fs.stat(file).catch(() => null);
    if (!stat || !stat.isFile()) {
      res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' }).end('Introuvable');
      return;
    }

    const type = TYPES[path.extname(file).toLowerCase()] || 'application/octet-stream';
    const headers = {
      'Content-Type': type,
      'Accept-Ranges': 'bytes',
      'Cache-Control': 'no-cache',
    };

    const range = /^bytes=(\d*)-(\d*)$/.exec(req.headers.range || '');
    if (range) {
      let start = range[1] === '' ? null : Number(range[1]);
      let end = range[2] === '' ? null : Number(range[2]);
      if (start === null) {
        start = Math.max(0, stat.size - (end || 0));
        end = stat.size - 1;
      } else if (end === null || end >= stat.size) {
        end = stat.size - 1;
      }
      if (start > end || start >= stat.size) {
        res.writeHead(416, { 'Content-Range': `bytes */${stat.size}` }).end();
        return;
      }
      res.writeHead(206, {
        ...headers,
        'Content-Range': `bytes ${start}-${end}/${stat.size}`,
        'Content-Length': end - start + 1,
      });
      if (req.method === 'HEAD') return res.end();
      createReadStream(file, { start, end }).pipe(res);
      return;
    }

    res.writeHead(200, { ...headers, 'Content-Length': stat.size });
    if (req.method === 'HEAD') return res.end();
    createReadStream(file).pipe(res);
  } catch (err) {
    res.writeHead(500).end('Erreur');
    console.error(err);
  }
});

server.listen(port, '0.0.0.0', () => {
  const lan = Object.values(networkInterfaces())
    .flat()
    .filter((i) => i && i.family === 'IPv4' && !i.internal)
    .map((i) => i.address);
  console.log(`\n  💞 L'amour des deux zigs est prêt\n`);
  console.log(`  Sur cet ordinateur :  http://localhost:${port}`);
  for (const ip of lan) console.log(`  Sur l'iPhone (même Wi-Fi) :  http://${ip}:${port}`);
  console.log(`\n  Dossier servi : ${root}`);
  console.log('  Ctrl+C pour arrêter.\n');
});
