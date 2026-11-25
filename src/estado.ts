// Generador del estado de la oficina (portado de tablero/estado.sh + extra.py).
// Lee solo metadatos de sesiones (~/.claude/sessions/<pid>.json), la COLA de las conversaciones (último pedido y
// mensajes entre agentes) y los meta.json de subagentes. Todo texto mostrado pasa por tapar() antes de salir.
import { readFileSync, readdirSync, existsSync, statSync, openSync, readSync, closeSync, writeFileSync, renameSync, mkdirSync } from 'node:fs';
import { join, basename, dirname } from 'node:path';
import { execFileSync } from 'node:child_process';
import type { Bucle } from './config.ts';

const RE_TAPAR: [RegExp, string][] = [
  // \w de Python es Unicode; en JS no: se usan clases Unicode para tapar igual (josé@x.com).
  [/[\p{L}\p{M}\p{N}_.+-]+@[\p{L}\p{M}\p{N}_-]+\.[\p{L}\p{M}\p{N}_.-]+/gu, '[correo]'],
  [/https?:\/\/\S+\?\S*/gu, '[enlace]'],
  // \b de JS no ve "ñ" como letra: se usan límites Unicode para que "contraseña" se tape como en Python.
  [/(?<![\p{L}\p{N}_])(password|contraseña|clave|token|key|secret|secreto)(?![\p{L}\p{N}_])\s*[:=]?\s*\S+/giu, '$1 [oculto]'],
  [/[A-Za-z0-9_-]{24,}/gu, '[…]'],
  [/(?<!\d)(?:\+?57\s?)?3\d{2}[\s-]?\d{3}[\s-]?\d{4}(?!\d)/gu, '[teléfono]'],
];

export function tapar(t: string | null | undefined, n = 140) {
  let s = (t || '').replace(/\s+/gu, ' ').trim();
  for (const [r, x] of RE_TAPAR) s = s.replace(r, x);
  const c = Array.from(s);
  return c.length <= n ? s : c.slice(0, n - 1).join('') + '…';
}

// Últimos b bytes del archivo; la primera línea se descarta (puede venir cortada), como en extra.py.
export function cola(f: string, b = 200_000): string[] {
  try {
    const n = statSync(f).size, fd = openSync(f, 'r'), buf = Buffer.alloc(Math.min(n, b));
    readSync(fd, buf, 0, buf.length, n - buf.length); closeSync(fd);
    return buf.toString('utf8').split(/\r?\n/).slice(1);
  } catch { return []; }
}

const tsDe = (e: any) => { const v = Date.parse(String(e?.timestamp ?? '').slice(0, 19) + 'Z'); return Number.isFinite(v) ? Math.floor(v / 1000) : 0; };
const RE_DE = /<cross-session-message[^>]*from-name="([^"]+)"/;
const vivo = (pid: number) => { try { process.kill(pid, 0); return true; } catch (e) { return (e as NodeJS.ErrnoException).code === 'EPERM'; } };

export type Reunion = { de: string; para: string; tema?: string; ts: number };

export class Estado {
  private home: string;
  private memoria: string;
  private esDirector: (n: string) => boolean;
  private codex: { cupo: boolean; bucles: Bucle[] };
  private rutas = new Map<string, string>(); // sessionId → transcript
  private nombreDirector: string;
  private en: boolean;
  constructor(o: { home: string; memoria: string; esDirector?: (n: string) => boolean; nombreDirector?: string; codex?: { cupo: boolean; bucles: Bucle[] }; idioma?: 'es' | 'en' }) {
    this.home = o.home; this.memoria = o.memoria; this.esDirector = o.esDirector ?? (() => false); this.codex = o.codex ?? { cupo: false, bucles: [] };
    this.nombreDirector = o.nombreDirector ?? 'director'; this.en = o.idioma === 'en';
  }

  private transcript(sid: string) {
    if (!/^[\w-]+$/.test(sid)) return null;
    const c = this.rutas.get(sid);
    if (c && existsSync(c)) return c;
    const base = join(this.home, '.claude', 'projects');
    let dirs: string[] = [];
    try { dirs = readdirSync(base); } catch { return null; }
    for (const d of dirs) { const f = join(base, d, sid + '.jsonl'); if (existsSync(f)) { this.rutas.set(sid, f); return f; } }
    return null;
  }

  // (último pedido tapado o null, mensajes entre agentes de los últimos 3 min)
  leerSesion(sid: string, nombre: string): [string | null, Reunion[]] {
    const [p, r] = this.leer(sid, nombre, 200_000);
    // ponytail: si en 200 KB no hay pedido (los blobs de API pesan), 3 MB. Más atrás no se busca.
    return p ? [p, r] : [this.leer(sid, nombre, 3_000_000)[0], r];
  }

  private leer(sid: string, nombre: string, b: number): [string | null, Reunion[]] {
    const f = this.transcript(sid);
    if (!f) return [null, []];
    let pedido: string | null = null;
    const reun: Reunion[] = [], ahora = Date.now() / 1000;
    for (const l of cola(f, b)) {
      let e: any;
      try { e = JSON.parse(l); } catch { continue; }
      const c = e?.message?.content;
      if (e?.type === 'user' && !e.isMeta && !e.isCompactSummary) {
        const txt: string = typeof c === 'string' ? c : Array.isArray(c) ? c.filter((p: any) => p && typeof p === 'object' && p.type === 'text').map((p: any) => p.text ?? '').join(' ') : '';
        const t0 = txt.trimStart();
        if (!txt || txt.slice(0, 40).includes('<system-reminder') || ['This session is being continued', '<command-', '<local-command', '<task-notification'].some(x => t0.startsWith(x))) continue;
        const m = RE_DE.exec(txt);
        if (m) {
          pedido = `mensaje de ${m[1]}`;
          if (ahora - tsDe(e) < 180) reun.push({ de: m[1], para: nombre, ts: tsDe(e) });
        } else if (!txt.includes('<agent-message') && !txt.includes('<cross-session')) pedido = tapar(txt);
      } else if (e?.type === 'assistant' && Array.isArray(c)) {
        for (const p of c)
          if (p && typeof p === 'object' && p.type === 'tool_use' && p.name === 'SendMessage' && ahora - tsDe(e) < 180) {
            const i = p.input ?? {};
            reun.push({ de: nombre, para: String(i.to ?? '').slice(0, 40), tema: tapar(i.summary ?? '', 60), ts: tsDe(e) });
          }
      }
    }
    return [pedido, reun];
  }

  // Contratados temporales: subagentes con actividad en los últimos 15 min (solo metadatos).
  subagentes(sid: string, padre: string) {
    const out: any[] = [], ahora = Date.now() / 1000, f = this.transcript(sid);
    if (!f) return out;
    const dir = join(dirname(f), sid, 'subagents');
    let metas: string[] = [];
    try { metas = readdirSync(dir).filter(x => /^agent-.*\.meta\.json$/.test(x)); } catch { return out; }
    for (const meta of metas) {
      try {
        const log = join(dir, meta.slice(0, -'.meta.json'.length) + '.jsonl');
        const hace = ahora - statSync(existsSync(log) ? log : join(dir, meta)).mtimeMs / 1000;
        if (hace > 900) continue;
        const m = JSON.parse(readFileSync(join(dir, meta), 'utf8'));
        out.push({ id: basename(log).slice(6, -6), padre, tarea: tapar(m.description ?? '', 60), tipo: m.agentType ?? '', modelo: m.model || '', estado: hace < 300 ? 'trabajando' : 'saliendo', hace: Math.floor(hace) });
      } catch { /* meta a medio escribir */ }
    }
    return out;
  }

  cupoCodex() {
    const base = join(this.home, '.codex', 'sessions'), fs: string[] = [];
    const recorrer = (d: string, prof: number) => { let xs: string[] = []; try { xs = readdirSync(d); } catch { return; } for (const x of xs) { const p = join(d, x); if (prof < 3) recorrer(p, prof + 1); else if (x.endsWith('.jsonl')) fs.push(p); } };
    recorrer(base, 0);
    const ult = fs.map(f => [f, statSync(f).mtimeMs] as const).sort((a, b) => a[1] - b[1]).slice(-3);
    for (const [f, mt] of ult.reverse()) {
      for (const l of cola(f, 300_000).reverse()) {
        if (!l.includes('"rate_limits"')) continue;
        try {
          const j = JSON.parse(l), r = (j.payload ?? j).rate_limits ?? j.rate_limits, p = r.primary ?? {}, s = r.secondary ?? {};
          return { usado: p.used_percent, renueva: p.resets_at, semana: s.used_percent, renueva_semana: s.resets_at, visto: Math.floor(mt / 1000) };
        } catch { continue; }
      }
    }
    return null;
  }

  private bucles() {
    const out: any[] = [];
    for (const b of this.codex.bucles) {
      let corre = false;
      if (process.platform !== 'win32') try { corre = !!execFileSync('pgrep', ['-f', '^/bin/bash .*' + b.script.replace(/\./g, '\\.')], { encoding: 'utf8' }).trim(); } catch { /* pgrep sale con 1 si no hay */ }
      let hecho = false;
      if (b.marcador && b.textoHecho) try { hecho = readFileSync(b.marcador, 'utf8').includes(b.textoHecho); } catch { /* sin marcador */ }
      let vuelta: string | undefined;
      if (b.vueltas) {
        const re = new RegExp('^' + basename(b.vueltas).replace(/[.+^${}()|[\]\\]/g, '\\$&').replace('\\*', '(\\d+)').replace('*', '(\\d+)') + '$');
        let ns: number[] = [];
        try { ns = readdirSync(dirname(b.vueltas)).map(x => re.exec(x)).filter(Boolean).map(m => Number(m![1])); } catch { /* sin carpeta */ }
        const hechas = ns.length ? Math.max(...ns) : 0;
        vuelta = this.en ? (corre ? `round ${hechas + 1}` : `${hechas} rounds`) : corre ? `vuelta ${hechas + 1}` : `${hechas} vueltas`;
      }
      if (corre || hecho) out.push({ id: b.script, tipo: 'codex', nombre: b.nombre, estado: hecho ? 'terminado' : 'busy', detalle: this.en ? 'Codex loop' : 'bucle de Codex', vuelta, directora: false });
    }
    return out;
  }

  // Una vuelta completa: lo mismo que imprimía estado.sh. La memoria (vistos.json) guarda llegadas y salidas.
  generar() {
    const ag: any[] = [];
    let reuniones: Reunion[] = [], temporales: any[] = [];
    const dirSes = join(this.home, '.claude', 'sessions');
    let xs: string[] = [];
    try { xs = readdirSync(dirSes).filter(f => /^\d+\.json$/.test(f)); } catch { /* sin sesiones */ }
    for (const f of xs) {
      try {
        const d = JSON.parse(readFileSync(join(dirSes, f), 'utf8')), pid = Number(d.pid);
        if (!Number.isInteger(pid) || !vivo(pid)) continue;
        const n = d.name || 'sin-nombre';
        const a: any = { id: `claude-${pid}`, tipo: 'claude', nombre: n, estado: d.status || 'idle', detalle: basename(String(d.cwd || '').replace(/[\\/]+$/, '')), updatedAt: d.updatedAt, desde: Number(d.statusUpdatedAt || d.updatedAt || 0), directora: this.esDirector(n) };
        ag.push(a);
        try {
          const [p, r] = this.leerSesion(String(d.sessionId), n);
          a.pedido = p; reuniones.push(...r); temporales.push(...this.subagentes(String(d.sessionId), n).map(t => ({ ...t, padreN: a.directora ? this.nombreDirector : n })));
        } catch { /* sin transcript */ }
      } catch { /* json a medio escribir */ }
    }
    ag.push(...this.bucles());
    let m: any = {};
    try { m = JSON.parse(readFileSync(this.memoria, 'utf8')); } catch { /* primera vez */ }
    const vis: Record<string, any> = m.agentes ?? {}, feed: any[] = m.feed ?? [];
    const hh = new Date().toTimeString().slice(0, 5);
    const ev = (tipo: string, n: string, v?: string) => feed.push({ h: hh, tipo, n, ...(v ? { v } : {}) });
    const act = new Set(ag.map(a => a.id));
    for (const a of ag) {
      if (!['idle', 'terminado', 'detenido', 'cerrada'].includes(a.estado)) a.estado_ui = 'busy';
      const p = vis[a.id], nom = a.directora ? this.nombreDirector : a.nombre;
      if (!p) ev('llego', nom);
      else if (p.estado !== a.estado) ev(a.estado === 'idle' ? 'esperando' : a.estado === 'terminado' ? 'termino' : 'trabajando', nom);
      else if (a.vuelta && p.vuelta !== a.vuelta && a.tipo === 'codex') ev('vuelta', nom, a.vuelta);
      vis[a.id] = a;
    }
    for (const [i, p] of Object.entries(vis)) {
      if (act.has(i)) continue;
      if (['detenido', 'cerrada', 'terminado'].includes(p.estado)) { ag.push(p); continue; }
      p.estado = p.tipo === 'codex' ? 'detenido' : 'cerrada';
      ev(p.tipo === 'codex' ? 'detuvo' : 'cerro', p.directora ? this.nombreDirector : p.nombre); ag.push(p);
    }
    const feed40 = feed.slice(-40);
    try {
      mkdirSync(dirname(this.memoria), { recursive: true });
      writeFileSync(this.memoria + '.tmp', JSON.stringify({ agentes: vis, feed: feed40 })); renameSync(this.memoria + '.tmp', this.memoria);
    } catch { /* memoria no persistida esta vuelta */ }
    let cupo = null;
    if (this.codex.cupo) try { cupo = this.cupoCodex(); } catch { /* sin dato */ }
    return { temporales, cupo: { codex: cupo, claude: null }, reuniones: reuniones.slice(-10), generado: Date.now(), agentes: ag, feed: feed40.slice().reverse().slice(0, 30) };
  }
}
