// Configuración: oficina.config.json (local, fuera de git) o, si no existe, oficina.config.example.json.
import { readFileSync, existsSync } from 'node:fs';
import { join, isAbsolute, resolve } from 'node:path';
import { homedir, tmpdir } from 'node:os';

export type Puesto = { zona: number; i: number };
export type Agente = { nombre: string; carpeta: string; color: string; modelo: string; descripcion: string; zona?: number; puesto?: Puesto; contexto?: string; sesion?: string; motor?: 'claude' | 'codex'; modoPermisos?: Modo; reglasWeb?: string[] };
// Modos de permisos que se ofrecen desde la web. bypassPermissions NUNCA (salta todos los permisos).
export const MODOS = ['default', 'acceptEdits', 'plan', 'auto'] as const;
export type Modo = typeof MODOS[number];
export const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
// Regla de permisos de Claude Code (p. ej. "Bash(npm test:*)" o "Read"): sin saltos de línea y corta.
export const reglaValida = (r: unknown): r is string => typeof r === 'string' && r.length > 0 && r.length <= 300 && !/[\n\r]/.test(r) && /^[A-Za-z_][\w-]*(\(.*\))?$/.test(r);
export type Zona = { nombre: string; patron?: string; color: string; contexto?: string };
export const MAX_ZONAS = 6, MAX_PUESTO = 63, MAX_CONTEXTO = 2000;
// Colores de suelo legibles con el pixel art (sin rojo). El de contratistas (#8a6a3a) queda aparte.
export const PALETA = ['#4b5e9c', '#3f7d62', '#7d4c86', '#2f7a80', '#5a6a2a', '#3a6a9a', '#6a5a9c', '#4a7a5a', '#6b5b3a', '#596273'];

// Patrón de zona: corto, compila y no tarda (se descartan los que explotan con retroceso, p. ej. (a+)+).
export function patronSeguro(p: string): boolean {
  if (p.length > 100) return false;
  let re: RegExp;
  try { re = new RegExp(p, 'i'); } catch { return false; }
  if (/\\[1-9]|\\k</.test(p) || /\([^)]*[+*][^)]*\)\s*[+*{]/.test(p)) return false; // retrorreferencias y cuantificadores anidados
  const t0 = performance.now();
  for (const s of ['a'.repeat(3000) + '!', 'ab'.repeat(1500) + '!', '-'.repeat(3000) + '!']) re.test(s);
  return performance.now() - t0 < 50;
}
export type Bucle = { nombre: string; script: string; marcador?: string; textoHecho?: string; vueltas?: string };
export type Config = {
  titulo: string;
  idioma: 'es' | 'en' | 'auto';
  puerto: number;
  agentes: Agente[];
  director?: { nombre: string; patronSesion: string; carpeta?: string; modelo: string; color: string; modoPermisos?: Modo; reglasWeb?: string[] }; // con carpeta se puede llamar desde la web
  coordinacion: { dir: string }; // buzon.jsonl, preguntas.jsonl, general.jsonl
  oficina: { zonas: Zona[]; carteles: { texto: string; fondo: string; color: string }[]; tv: string };
  codex: { cupo: boolean; bucles: Bucle[] };
};

const RAIZ = join(import.meta.dirname, '..');

// "~/x" → home, "{tmp}/x" → carpeta temporal del sistema. Así el ejemplo no lleva rutas personales.
export const expandir = (p: string) => resolve(p.replace(/^~(?=$|[\\/])/, homedir()).replace(/^\{tmp\}/, tmpdir()));

const texto = (v: unknown, def: string, max = 80) => (typeof v === 'string' && v.trim() ? v.trim().slice(0, max) : def);
const color = (v: unknown, def: string) => (typeof v === 'string' && /^#[0-9a-fA-F]{6}$/.test(v) ? v : def);

export function validar(c: any, raiz = RAIZ): Config {
  if (!c || typeof c !== 'object' || Array.isArray(c)) throw new Error('la configuración debe ser un objeto JSON');
  if (!Array.isArray(c.agentes)) throw new Error('"agentes" debe ser una lista');
  const vistos = new Set<string>();
  const agentes = c.agentes.map((a: any, i: number) => {
    if (typeof a?.nombre !== 'string' || !/^[a-z0-9][a-z0-9-]{0,39}$/.test(a.nombre) || vistos.has(a.nombre)) throw new Error(`agentes[${i}].nombre inválido o repetido (minúsculas, números y guiones)`);
    if (typeof a.carpeta !== 'string' || !a.carpeta.trim()) throw new Error(`agentes[${i}].carpeta falta`);
    if (a.motor !== undefined && !['claude', 'codex'].includes(a.motor)) throw new Error('motor inválido');
    if (a.modoPermisos !== undefined && !MODOS.includes(a.modoPermisos)) throw new Error('modo de permisos inválido');
    const carpeta = expandir(a.carpeta.trim());
    if (!isAbsolute(carpeta)) throw new Error(`agentes[${i}].carpeta debe ser absoluta`);
    vistos.add(a.nombre);
    if (a.contexto !== undefined && (typeof a.contexto !== 'string' || a.contexto.length > MAX_CONTEXTO)) throw new Error(`agentes[${i}].contexto: texto de hasta ${MAX_CONTEXTO} caracteres`);
    return {
      nombre: a.nombre, carpeta, ...(a.motor ? { motor: a.motor } : {}), color: color(a.color, '#a98bff'), modelo: texto(a.modelo, 'opus', 40), descripcion: texto(a.descripcion, '', 300),
      ...(Number.isInteger(a.zona) && a.zona >= 0 && a.zona < MAX_ZONAS ? { zona: a.zona } : {}),
      ...(typeof a.contexto === 'string' && a.contexto.trim() ? { contexto: a.contexto.trim() } : {}),
      ...(typeof a.sesion === 'string' && UUID_RE.test(a.sesion) ? { sesion: a.sesion } : {}),
      ...(MODOS.includes(a.modoPermisos) ? { modoPermisos: a.modoPermisos } : {}),
      ...(Array.isArray(a.reglasWeb) ? { reglasWeb: a.reglasWeb.filter(reglaValida).slice(0, 100) } : {}),
      ...(Number.isInteger(a.puesto?.zona) && Number.isInteger(a.puesto?.i) && a.puesto.zona >= 0 && a.puesto.zona < MAX_ZONAS && a.puesto.i >= 0 && a.puesto.i <= MAX_PUESTO ? { puesto: { zona: a.puesto.zona, i: a.puesto.i } } : {}),
    };
  });
  const d = c.director;
  if (d !== undefined && (typeof d?.nombre !== 'string' || !d.nombre.trim() || typeof d.patronSesion !== 'string' || !d.patronSesion.trim()))
    throw new Error('"director" necesita "nombre" y "patronSesion" (p. ej. "lead-*")');
  if (d?.modoPermisos !== undefined && !MODOS.includes(d.modoPermisos)) throw new Error('modo de permisos inválido');
  const of = c.oficina ?? {};
  // Sin "zonas" (o vacía) hay 3 por defecto; si las trae, se usan tal cual (1 a 6).
  const zcrudas: any[] = Array.isArray(of.zonas) && of.zonas.length ? of.zonas.slice(0, MAX_ZONAS) : [{ nombre: 'ZONA 1' }, { nombre: 'ZONA 2' }, { nombre: 'ZONA 3' }];
  const zonas: Zona[] = zcrudas.map((z: any, i: number) => {
    if (z?.patron !== undefined && z.patron !== '' && (typeof z.patron !== 'string' || !patronSeguro(z.patron))) throw new Error(`patrón de zona inválido o inseguro: ${String(z.patron).slice(0, 60)}`);
    if (z?.contexto !== undefined && (typeof z.contexto !== 'string' || z.contexto.length > MAX_CONTEXTO)) throw new Error(`zonas[${i}].contexto: texto de hasta ${MAX_CONTEXTO} caracteres`);
    return {
      nombre: texto(z?.nombre, `ZONA ${i + 1}`, 20), color: PALETA.includes(z?.color) ? z.color : PALETA[i % PALETA.length],
      ...(typeof z?.patron === 'string' && z.patron ? { patron: z.patron } : {}), ...(typeof z?.contexto === 'string' && z.contexto.trim() ? { contexto: z.contexto.trim() } : {}),
    };
  });
  const DEF_C = [{ texto: 'IDEAS', fondo: '#0c6b4a', color: '#ffffff' }, { texto: 'EQUIPO', fondo: '#3a2f6c', color: '#ffd98a' }, { texto: 'OFICINA', fondo: '#26304a', color: '#ffffff' }];
  const carteles = DEF_C.map((dc, i) => { const x = Array.isArray(of.carteles) ? of.carteles[i] : undefined; return { texto: texto(x?.texto, dc.texto, 9), fondo: color(x?.fondo, dc.fondo), color: color(x?.color, dc.color) }; });
  const cx = c.codex ?? {};
  const bucles = (Array.isArray(cx.bucles) ? cx.bucles : []).map((b: any, i: number) => {
    if (typeof b?.nombre !== 'string' || typeof b?.script !== 'string' || !/^[\w.-]+$/.test(b.script)) throw new Error(`codex.bucles[${i}] necesita "nombre" y "script" (nombre de archivo)`);
    return { nombre: b.nombre.slice(0, 60), script: b.script, ...(typeof b.marcador === 'string' ? { marcador: expandir(b.marcador) } : {}), ...(typeof b.textoHecho === 'string' ? { textoHecho: b.textoHecho } : {}), ...(typeof b.vueltas === 'string' ? { vueltas: expandir(b.vueltas) } : {}) };
  });
  // Un puesto fuera de las zonas configuradas no vale: se vuelve a asignar.
  for (const a of agentes) if (a.puesto && a.puesto.zona >= zonas.length) delete a.puesto;
  return {
    titulo: texto(c.titulo, '', 40), // vacío = el nombre por defecto en el idioma de la página
    idioma: c.idioma === 'en' || c.idioma === 'auto' ? c.idioma : 'es',
    puerto: Number.isInteger(c.puerto) && c.puerto > 0 && c.puerto < 65536 ? c.puerto : 8890,
    agentes,
    ...(d ? { director: { nombre: d.nombre.trim().slice(0, 30), patronSesion: d.patronSesion.trim(), modelo: texto(d.modelo, 'opus', 40), color: color(d.color, '#F2B33D'), ...(MODOS.includes(d.modoPermisos) ? { modoPermisos: d.modoPermisos } : {}), ...(Array.isArray(d.reglasWeb) ? { reglasWeb: d.reglasWeb.filter(reglaValida).slice(0, 100) } : {}), ...(typeof d.carpeta === 'string' && d.carpeta.trim() ? { carpeta: expandir(d.carpeta.trim()) } : {}) } } : {}),
    coordinacion: { dir: typeof c.coordinacion?.dir === 'string' ? expandir(c.coordinacion.dir) : join(raiz, 'tmp', 'coordinacion') },
    oficina: { zonas, carteles, tv: texto(of.tv, 'TV', 9) },
    codex: { cupo: cx.cupo === true, bucles },
  };
}

export function cargarConfig(raiz = RAIZ, ruta?: string): { config: Config; origen: string; crudo: any } {
  const origen = ruta ?? (existsSync(join(raiz, 'oficina.config.json')) ? join(raiz, 'oficina.config.json') : join(raiz, 'oficina.config.example.json'));
  let crudo: any;
  try { crudo = JSON.parse(readFileSync(origen, 'utf8')); } catch (e) { throw new Error(`no se pudo leer ${origen}: ${(e as Error).message}`); }
  try { return { config: validar(crudo, raiz), origen, crudo }; } catch (e) { throw new Error(`${origen}: ${(e as Error).message}`); }
}

// "lead-*" → /^lead-.*$/
export const patronARegex = (p: string) => new RegExp('^' + p.replace(/[.+^${}()|[\]\\]/g, '\\$&').replace(/\*/g, '.*').replace(/\?/g, '.') + '$');
