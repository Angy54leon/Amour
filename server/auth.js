/*
 * Accès privé à l'album, sans base de données :
 *  - ALBUM_CODE : code à partager avec ta copine (voir les souvenirs) ;
 *  - ADMIN_CODE : ton code à toi (voir + envoyer + supprimer).
 * Une fois le code accepté, le serveur pose un cookie de session signé
 * (HttpOnly : illisible par le JavaScript de la page). Changer un code dans
 * Vercel déconnecte immédiatement les sessions ouvertes avec l'ancien.
 */
import crypto from 'node:crypto';

const COOKIE = 'amour_session';
const MAX_AGE_S = 60 * 60 * 24 * 180; // 6 mois

function normalize(code) {
  return String(code || '')
    .normalize('NFC')
    .trim()
    .replace(/\s+/g, ' ')
    .toLowerCase();
}

function sha256(value) {
  return crypto.createHash('sha256').update(String(value)).digest();
}

function codes() {
  return {
    admin: normalize(process.env.ADMIN_CODE),
    viewer: normalize(process.env.ALBUM_CODE),
  };
}

/** Clé de signature des sessions : jamais envoyée au navigateur. */
function signingKey() {
  const base =
    process.env.SESSION_SECRET ||
    process.env.BLOB_READ_WRITE_TOKEN ||
    process.env.SUPABASE_SERVICE_ROLE_KEY ||
    process.env.SUPABASE_SECRET_KEY ||
    process.env.STOCKAGE_LOCAL_SECRET;
  return base ? sha256('amour-session:' + base) : null;
}

/** Ce qui manque pour activer les codes (noms des variables, jamais leurs valeurs). */
export function authProblems() {
  const c = codes();
  const problems = [];
  if (!c.viewer) problems.push('ALBUM_CODE');
  if (!c.admin) problems.push('ADMIN_CODE');
  if (c.admin && c.viewer && c.admin === c.viewer) problems.push('ADMIN_CODE doit être différent de ALBUM_CODE');
  if (!signingKey()) problems.push('SESSION_SECRET');
  return problems;
}

export function authConfigured() {
  return authProblems().length === 0;
}

/** Comparaison à temps constant (pas d'indice sur le code via le temps de réponse). */
function sameCode(a, b) {
  return crypto.timingSafeEqual(sha256(a), sha256(b));
}

export function roleForCode(input) {
  const code = normalize(input);
  const c = codes();
  if (!code) return null;
  if (c.admin && sameCode(code, c.admin)) return 'admin';
  if (c.viewer && sameCode(code, c.viewer)) return 'viewer';
  return null;
}

function b64url(buf) {
  return Buffer.from(buf).toString('base64url');
}

function sign(payload) {
  return b64url(crypto.createHmac('sha256', signingKey()).update(payload).digest());
}

/** Empreinte du code en vigueur : la changer invalide les anciennes sessions. */
function codeVersion(role) {
  const c = codes();
  return sha256(role + ':' + (role === 'admin' ? c.admin : c.viewer)).toString('hex').slice(0, 12);
}

function isHttps(req) {
  const proto = String(req.headers['x-forwarded-proto'] || '').split(',')[0].trim();
  return proto === 'https' || !!(req.socket && req.socket.encrypted);
}

export function sessionCookie(req, role) {
  const payload = b64url(JSON.stringify({ r: role, v: codeVersion(role), e: Date.now() + MAX_AGE_S * 1000 }));
  const value = payload + '.' + sign(payload);
  return `${COOKIE}=${value}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${MAX_AGE_S}${isHttps(req) ? '; Secure' : ''}`;
}

export function clearedCookie(req) {
  return `${COOKIE}=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0${isHttps(req) ? '; Secure' : ''}`;
}

function readCookie(req, name) {
  const header = req.headers.cookie || '';
  for (const part of header.split(';')) {
    const i = part.indexOf('=');
    if (i !== -1 && part.slice(0, i).trim() === name) return part.slice(i + 1).trim();
  }
  return null;
}

/** 'admin' | 'viewer' | null */
export function roleOf(req) {
  if (!authConfigured()) return null;
  const raw = readCookie(req, COOKIE);
  if (!raw) return null;
  const dot = raw.lastIndexOf('.');
  if (dot <= 0) return null;
  const payload = raw.slice(0, dot);
  const given = Buffer.from(raw.slice(dot + 1));
  const expected = Buffer.from(sign(payload));
  if (given.length !== expected.length || !crypto.timingSafeEqual(given, expected)) return null;
  try {
    const data = JSON.parse(Buffer.from(payload, 'base64url').toString('utf8'));
    if (data.r !== 'admin' && data.r !== 'viewer') return null;
    if (!(data.e > Date.now())) return null;
    if (data.v !== codeVersion(data.r)) return null;
    return data.r;
  } catch {
    return null;
  }
}

/** Les requêtes qui modifient quelque chose doivent venir du site lui-même. */
export function sameOrigin(req) {
  const origin = req.headers.origin;
  if (!origin) return true; // navigateurs anciens / même origine sans en-tête
  const host = String(req.headers['x-forwarded-host'] || req.headers.host || '').split(',')[0].trim();
  try {
    return new URL(origin).host === host;
  } catch {
    return false;
  }
}

/** HMAC générique (URL signées du stockage local de test). */
export function hmac(value) {
  return b64url(crypto.createHmac('sha256', signingKey()).update(String(value)).digest());
}
