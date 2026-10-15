#!/usr/bin/env node
/*
 * Empaquette la fonction d'envoi de @vercel/blob/client pour le navigateur
 * (fichier js/vendor/blob-client.js, versionné avec le projet).
 * À relancer seulement après une mise à jour de @vercel/blob :
 *   npm install && npm run vendor:blob
 */
import { build } from 'esbuild';
import path from 'node:path';
import { projectRoot } from './medias.mjs';

const out = path.join(projectRoot, 'js/vendor/blob-client.js');
await build({
  stdin: {
    contents: "export { upload } from '@vercel/blob/client';",
    resolveDir: projectRoot,
    loader: 'js',
  },
  bundle: true,
  minify: true,
  format: 'iife',
  globalName: 'AmourBlobClient',
  platform: 'browser',
  target: ['safari15', 'chrome100', 'firefox100'],
  legalComments: 'eof',
  // Pas de `process` dans un navigateur : toutes les options d'environnement sont absentes.
  define: { 'process.env': '{}' },
  outfile: out,
});
console.log(`✅ ${path.relative(projectRoot, out)} généré`);
