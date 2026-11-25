// Reglas de seguridad: quién entra (Host, Origin, token), qué se sube y qué archivos se sirven.
import { randomBytes, timingSafeEqual, createHmac } from 'node:crypto';
import { realpathSync, statSync } from 'node:fs';
import { sep, extname } from 'node:path';

export const MAX_IMAGEN = 10 * 1024 * 1024;
export const MAX_ADJUNTO = 25 * 1024 * 1024;

export const nuevoToken = () => randomBytes(24).toString('base64url');

// Host fijo: corta el DNS rebinding (una web ajena que resuelva a 127.0.0.1 llega con otro Host).
export const hostValido = (host: string | undefined, puerto: number) =>
  host === `127.0.0.1:${puerto}` || host === `localhost:${puerto}`;

// Origin exacto en cada POST y en el WebSocket. Sin Origin = rechazo.
export const origenValido = (origin: string | undefined, puerto: number) =>
  origin === `http://127.0.0.1:${puerto}` || origin === `http://localhost:${puerto}`;

export function tokenValido(dado: unknown, token: string) {
  if (typeof dado !== 'string') return false;
  const a = Buffer.from(dado), b = Buffer.from(token);
  return a.length === b.length && timingSafeEqual(a, b);
}

// Firma por archivo para /archivo y /vista: un enlace filtrado (p. ej. desde un iframe) solo abre ese archivo.
export const firmar = (token: string, alcance: string, ruta: string) => createHmac('sha256', token).update(alcance + '\0' + ruta).digest('base64url').slice(0, 32);

// ---- Adjuntos: lista blanca por extensión + bytes mágicos donde existen ----
const IMAGEN: Record<string, string> = { png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg', webp: 'image/webp', gif: 'image/gif' };
const ZIP: Record<string, string> = {
  docx: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  xlsx: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  pptx: 'application/vnd.openxmlformats-officedocument.presentationml.presentation',
  zip: 'application/zip',
};
export const TEXTO = new Set(('txt md csv json log yaml yml toml xml ini html htm css scss js mjs cjs ts tsx jsx py rb go rs java kt kts swift c h cpp hpp cs php sh sql dart lua r vue svelte').split(' '));

export type Clase = 'imagen' | 'pdf' | 'binario' | 'texto';
export type Adjunto = { ext: string; tipo: string; clase: Clase };

const empieza = (b: Buffer, s: string | number[]) => b.length >= s.length && b.subarray(0, s.length).equals(Buffer.from(s as any));

function imagenOk(ext: string, b: Buffer) {
  if (ext === 'png') return empieza(b, [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
  if (ext === 'jpg' || ext === 'jpeg') return empieza(b, [0xff, 0xd8, 0xff]);
  if (ext === 'gif') return empieza(b, 'GIF87a') || empieza(b, 'GIF89a');
  return b.length >= 12 && b.toString('latin1', 0, 4) === 'RIFF' && b.toString('latin1', 8, 12) === 'WEBP';
}
const utf8 = new TextDecoder('utf-8', { fatal: true });

// null = tipo no permitido; 'contenido' = la extensión no coincide con los bytes.
export function clasificar(nombre: string, b: Buffer): Adjunto | null | 'contenido' {
  const ext = extname(nombre).slice(1).toLowerCase();
  if (IMAGEN[ext]) return imagenOk(ext, b) ? { ext, tipo: IMAGEN[ext], clase: 'imagen' } : 'contenido';
  if (ext === 'pdf') return empieza(b, '%PDF-') ? { ext, tipo: 'application/pdf', clase: 'pdf' } : 'contenido';
  if (ZIP[ext]) return empieza(b, [0x50, 0x4b, 0x03, 0x04]) || empieza(b, [0x50, 0x4b, 0x05, 0x06]) ? { ext, tipo: ZIP[ext], clase: 'binario' } : 'contenido';
  if (TEXTO.has(ext)) {
    if (b.includes(0)) return 'contenido';
    try { utf8.decode(b); } catch { return 'contenido'; }
    return { ext, tipo: 'text/plain', clase: 'texto' };
  }
  return null;
}

// Nombre seguro para guardar: sin carpetas, solo [A-Za-z0-9._-].
export function nombreSeguro(n: string) {
  const base = (n.split(/[\\/]/).pop() || 'archivo').normalize('NFD').replace(/[̀-ͯ]/g, '');
  const s = base.replace(/[^A-Za-z0-9._-]+/g, '_').replace(/^[._]+/, '').slice(-100);
  return s || 'archivo';
}

// ¿La ruta real (siguiendo enlaces) está dentro de alguna raíz permitida? Devuelve la ruta real o null.
export function dentroDe(ruta: string, raices: string[]) {
  let real: string;
  try { real = realpathSync(ruta); } catch { return null; }
  for (const r of raices) {
    let rr: string;
    try { rr = realpathSync(r); } catch { continue; }
    if (real === rr || real.startsWith(rr.endsWith(sep) ? rr : rr + sep)) return statSync(real).isFile() ? real : null;
  }
  return null;
}
