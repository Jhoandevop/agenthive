// Archivos de coordinación con el director (carpeta configurable): buzon.jsonl (usuario → agentes/director),
// preguntas.jsonl (director → usuario) y general.jsonl (respuestas del director).
import { appendFileSync, statSync, openSync, readSync, closeSync } from 'node:fs';
import { join } from 'node:path';
import { randomBytes } from 'node:crypto';

const corto = (v: unknown, n: number) => (typeof v === 'string' ? v.slice(0, n) : '');
const num = (v: unknown) => (typeof v === 'number' && Number.isFinite(v) ? v : 0);
export const nuevoId = () => randomBytes(4).toString('hex');

// Lee un .jsonl (solo la cola si es grande) y descarta líneas rotas.
export function leerJsonl(ruta: string, max = 1_000_000): Record<string, unknown>[] {
  let txt = '';
  try {
    const n = statSync(ruta).size, fd = openSync(ruta, 'r'), b = Buffer.alloc(Math.min(n, max));
    readSync(fd, b, 0, b.length, n - b.length); closeSync(fd);
    txt = b.toString('utf8');
    if (n > max) txt = txt.slice(txt.indexOf('\n') + 1);
  } catch { return []; }
  const out: Record<string, unknown>[] = [];
  for (const l of txt.split('\n')) {
    try { const e = JSON.parse(l); if (e && typeof e === 'object' && !Array.isArray(e)) out.push(e); } catch { /* línea rota */ }
  }
  return out;
}

// Mezcla por id, como estado.sh: la última línea de cada campo gana.
function porId(lineas: Record<string, unknown>[]) {
  const m = new Map<string, Record<string, unknown>>();
  for (const e of lineas) if (typeof e.id === 'string') m.set(e.id, { ...m.get(e.id), ...e });
  return [...m.values()];
}

export function agregarBuzon(dir: string, campos: Record<string, unknown>) {
  const id = nuevoId();
  appendFileSync(join(dir, 'buzon.jsonl'), JSON.stringify({ id, ts: Date.now(), ...campos, estado: 'pendiente' }) + '\n');
  return id;
}

export type Pregunta = { id: string; ts: number; de: string; texto: string; opciones?: string[]; estado: string; respuesta?: string };

export function preguntas(dir: string, director = 'director') {
  const todas: Pregunta[] = porId(leerJsonl(join(dir, 'preguntas.jsonl'))).filter(p => typeof p.texto === 'string').map(p => ({
    id: String(p.id), ts: num(p.ts), de: corto(p.de, 60) || director, texto: corto(p.texto, 2000), estado: corto(p.estado, 30),
    ...(Array.isArray(p.opciones) ? { opciones: p.opciones.filter(o => typeof o === 'string').slice(0, 8).map(o => o.slice(0, 200)) } : {}),
    ...(typeof p.respuesta === 'string' ? { respuesta: p.respuesta.slice(0, 1000) } : {}),
  }));
  return { pendientes: todas.filter(p => p.estado === 'pendiente'), respondidas: todas.filter(p => p.estado === 'respondida').slice(-5) };
}

export function responderPregunta(dir: string, id: string, respuesta: string, para: string, texto: (pregunta: string) => string) {
  const p = porId(leerJsonl(join(dir, 'preguntas.jsonl'))).find(x => x.id === id);
  if (!p) return 404;
  if (p.estado !== 'pendiente') return 409;
  appendFileSync(join(dir, 'preguntas.jsonl'), JSON.stringify({ id, estado: 'respondida', respuesta, ts: Date.now() }) + '\n');
  agregarBuzon(dir, { to: para, texto: texto(String(p.texto).slice(0, 300)), pregunta_id: id });
  return 200;
}

// Hilo con el director: lo que el usuario dejó en el buzón para él + general.jsonl (lo que responde).
export function hiloDirector(dir: string, director: string) {
  const mios = porId(leerJsonl(join(dir, 'buzon.jsonl'))).filter(e => e.to === director && typeof e.texto === 'string').map(e => ({
    de: 'usuario', id: String(e.id), ts: num(e.ts), texto: corto(e.texto, 4000), estado: corto(e.estado, 30), nota: corto(e.nota, 300),
    imagenes: (Array.isArray(e.imagenes) ? e.imagenes : []).filter((x): x is string => typeof x === 'string').slice(0, 8),
    adjuntos: (Array.isArray(e.adjuntos) ? e.adjuntos : []).filter((x): x is string => typeof x === 'string').slice(0, 8).map(x => x.split(/[\\/]/).pop()!.slice(0, 120)),
  }));
  const suyos = leerJsonl(join(dir, 'general.jsonl')).filter(e => typeof e.texto === 'string').map(e => ({
    de: 'general', id: corto(e.id, 60), ts: num(e.ts), texto: corto(e.texto, 20000), responde_a: corto(e.responde_a, 60),
  }));
  return [...mios, ...suyos].sort((a, b) => a.ts - b.ts).slice(-100);
}
