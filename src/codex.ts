// Integración local de Codex. Solo /proc y rollouts; nunca lee auth.json ni otro archivo de credenciales.
import { readdirSync, statSync, lstatSync, readFileSync, readlinkSync, openSync, readSync, closeSync } from 'node:fs';
import { join, basename } from 'node:path';
import { homedir } from 'node:os';
import { spawn as spawnReal, type ChildProcessWithoutNullStreams } from 'node:child_process';
import type { Agente, Modo } from './config.ts';
import { descendienteDe } from './agentes.ts';
import { UUID_RE } from './config.ts';
import type { AdjuntoListo, Emitir, Idioma, Lanzamiento } from './chat.ts';
import { tapar } from './estado.ts';

function trozo(ruta: string, max: number, final = false) {
  let fd: number | undefined;
  try {
    const n = statSync(ruta).size;
    fd = openSync(ruta, 'r');
    const b = Buffer.alloc(Math.min(n, max)), pos = final ? Math.max(0, n - max) : 0;
    readSync(fd, b, 0, b.length, pos);
    const txt = b.toString('utf8');
    return pos ? txt.slice(txt.indexOf('\n') + 1) : txt;
  } catch { return ''; }
  finally { if (fd !== undefined) closeSync(fd); }
}

export type RolloutCodex = { sessionId: string; cwd: string; modelo: string; pedido: string; lastModified: number; inicio: number; vuelta: number; vueltaMinima: boolean; actividad: string };
// El encabezado y la cola se leen con límites, incluso cuando un rollout pesa cientos de MB.
export function listarRolloutsCodex(home = homedir(), limite = 30): RolloutCodex[] {
  const archivos: { f: string; mt: number }[] = [];
  let vistos = 0;
  function recorrer(d: string, nivel: number) {
    if (nivel > 4 || vistos > 10_000) return;
    let xs: string[];
    try { xs = readdirSync(d).sort().reverse(); } catch { return; }
    for (const x of xs) {
      if (++vistos > 10_000) break;
      const f = join(d, x);
      // No sigue symlinks ni lee archivos que no sean rollouts.
      try {
        const st = lstatSync(f);
        if (st.isSymbolicLink()) continue;
        if (st.isDirectory() && /^\d{2,4}$/.test(x)) recorrer(f, nivel + 1);
        else if (st.isFile() && /^rollout-.*\.jsonl$/.test(x)) archivos.push({ f, mt: st.mtimeMs });
      } catch { /* entrada desaparecida */ }
    }
  }
  recorrer(join(home, '.codex', 'sessions'), 0);
  return archivos.sort((a, b) => b.mt - a.mt).slice(0, Math.max(0, Math.min(100, limite))).flatMap(({ f, mt }) => {
    let sessionId = '', cwd = '', modelo = '', pedido = '', inicio = 0, vuelta = 0, actividad = '';
    const lineas = new Map<string, unknown>();
    for (const l of (trozo(f, 64_000) + '\n' + trozo(f, 160_000, true)).split('\n')) {
      if (!l || lineas.has(l)) continue;
      lineas.set(l, true);
      let e: any;
      try { e = JSON.parse(l); } catch { continue; }
      const p = e.payload ?? {};
      if (e.type === 'session_meta') {
        sessionId = typeof p.id === 'string' && UUID_RE.test(p.id) ? p.id : '';
        cwd = typeof p.cwd === 'string' ? p.cwd : '';
        inicio = Date.parse(p.timestamp ?? e.timestamp) || 0;
      } else if (e.type === 'turn_context') {
        if (typeof p.model === 'string') modelo = p.model.slice(0, 80);
        if (!cwd && typeof p.cwd === 'string') cwd = p.cwd;
      } else if (e.type === 'event_msg') {
        if (p.type === 'user_message' && typeof p.message === 'string') { pedido = tapar(p.message); vuelta++; }
        if (['task_started', 'task_complete', 'turn_aborted', 'agent_message'].includes(p.type)) actividad = p.type;
      }
    }
    let vueltaMinima = false;
    try { vueltaMinima = statSync(f).size > 224_000; } catch { /* desaparecido */ }
    return sessionId && cwd ? [{ sessionId, cwd, modelo, pedido, lastModified: mt, inicio, vuelta, vueltaMinima, actividad }] : [];
  });
}

export type ProcesoCodex = { pid: number; ppid: number; cwd: string; inicio: number; args: string[] };
export function procesosCodex(procRoot = '/proc', now = Date.now(), clockTicks = 100): ProcesoCodex[] {
  let pids: string[];
  try { pids = readdirSync(procRoot).filter(x => /^\d+$/.test(x)); } catch { return []; }
  let arranque = now;
  try { arranque = Number(readFileSync(join(procRoot, 'stat'), 'utf8').match(/^btime (\d+)$/m)?.[1]) * 1000 || now; } catch { /* /proc parcial */ }
  const out: ProcesoCodex[] = [];
  for (const p of pids) {
    try {
      const dir = join(procRoot, p), args = trozo(join(dir, 'cmdline'), 8192).split('\0').filter(Boolean);
      const exe = basename(args[0] ?? ''), script = basename(args[1] ?? '');
      if (!(exe === 'codex' || exe === 'codex.exe' || (/^node(?:js)?$/.test(exe) && /^codex(?:\.js)?$/.test(script)))) continue;
      const campos = trozo(join(dir, 'stat'), 8192).split(') ').slice(1).join(') ').split(' ');
      const ppid = Number(campos[1]), ticks = Number(campos[19]);
      const cwd = readlinkSync(join(dir, 'cwd'));
      out.push({ pid: Number(p), ppid, cwd, inicio: Number.isFinite(ticks) ? arranque + ticks / clockTicks * 1000 : now, args });
    } catch { /* proceso terminado o ajeno no accesible */ }
  }
  // El lanzador Node y su binario nativo representan una sola criatura.
  const padres = new Set(out.map(p => p.ppid));
  return out.filter(p => !padres.has(p.pid));
}

export function detectarCodex(o: { home?: string; procRoot?: string; now?: number; clockTicks?: number } = {}) {
  const now = o.now ?? Date.now(), rollouts = listarRolloutsCodex(o.home), procesos = procesosCodex(o.procRoot, now, o.clockTicks);
  const usados = new Set<string>();
  const vivos = procesos.map(p => {
    const sid = p.args.find(x => UUID_RE.test(x));
    const r = rollouts.find(r => !usados.has(r.sessionId) && (sid ? r.sessionId === sid : r.cwd === p.cwd && r.lastModified >= p.inicio - 5000));
    if (r) usados.add(r.sessionId);
    return { id: `codex-${p.pid}`, tipo: 'codex', motor: 'codex', propio: descendienteDe(p.pid), pid: p.pid, ppid: p.ppid, cwd: p.cwd, inicio: p.inicio, desde: p.inicio, nombre: `Codex ${p.pid}`, estado: 'busy', detalle: basename(p.cwd), modelo: r?.modelo ?? '', pedido: r?.pedido ?? '', sesionId: r?.sessionId ?? sid ?? '', vuelta: r ? `vuelta ${r.vueltaMinima ? '≥' : ''}${r.vuelta}` : '', directora: false, bucle: false };
  });
  const recientes = rollouts.filter(r => !usados.has(r.sessionId) && now - r.lastModified < 24 * 3600_000).map(r => ({
    id: `codex-sesion-${r.sessionId}`, tipo: 'codex', motor: 'codex', nombre: 'Codex reciente', cwd: r.cwd, inicio: r.inicio, desde: r.lastModified, estado: 'idle', detalle: basename(r.cwd), modelo: r.modelo, pedido: r.pedido, sesionId: r.sessionId, vuelta: `vuelta ${r.vueltaMinima ? '≥' : ''}${r.vuelta}`, directora: false, bucle: false, reciente: true,
  }));
  return [...vivos, ...recientes];
}

export type SandboxCodex = 'workspace-write' | 'read-only';
export function argumentosCodex(o: { modelo: string; resume?: string; esfuerzo?: string; sandbox?: string }) {
  const sandbox = o.sandbox ?? 'workspace-write';
  if (sandbox !== 'workspace-write' && sandbox !== 'read-only') throw new Error('Sandbox Codex inválido');
  if (o.resume !== undefined && !UUID_RE.test(o.resume)) throw new Error('Sesión Codex inválida');
  // Las opciones globales preceden a exec/resume. No interpolación shell ni flags aportadas por el cliente.
  const args = ['--sandbox', sandbox, '--ask-for-approval', 'never', 'exec', '--json', '--color', 'never'];
  if (o.modelo && o.modelo !== 'default') args.push('--model', o.modelo);
  if (o.esfuerzo && ['low', 'medium', 'high', 'xhigh', 'max'].includes(o.esfuerzo)) args.push('-c', `model_reasoning_effort="${o.esfuerzo}"`);
  if (o.resume) args.push('resume', o.resume);
  args.push('-');
  return args;
}

export type SpawnCodex = (cmd: string, args: string[], op: { cwd: string; env: NodeJS.ProcessEnv; stdio: ['pipe', 'pipe', 'pipe'] }) => ChildProcessWithoutNullStreams;
export class SesionCodex {
  estado: 'esperando' | 'trabajando' | 'cerrada' = 'cerrada';
  sessionId?: string;
  modelo = '';
  esfuerzo?: Lanzamiento['esfuerzo'];
  modo: Modo = 'default';
  reglasSesion: string[] = [];
  readonly agente: Agente;
  private deps: { emitir: Emitir; cambio: () => void; spawn?: SpawnCodex };
  private proceso?: ChildProcessWithoutNullStreams;
  private lista = false;
  private contexto?: string;
  private idioma: Idioma;
  private fin?: Promise<void>;
  constructor(agente: Agente, deps: SesionCodex['deps'], idioma: Idioma = 'es') { this.agente = agente; this.deps = deps; this.idioma = idioma; }
  get viva() { return this.lista; }
  get pid() { return this.proceso?.pid; }
  private emit(ev: Parameters<Emitir>[1]) { this.deps.emitir(this.agente.nombre, ev); }
  async lanzar(o: Lanzamiento) {
    await this.cerrar();
    if (o.resume && !UUID_RE.test(o.resume)) throw new Error('Sesión Codex inválida');
    if (!['default', 'plan'].includes(o.modo)) throw new Error('Codex: solo default (workspace-write) o plan (read-only)');
    this.sessionId = o.resume; this.modelo = o.modelo; this.esfuerzo = o.esfuerzo; this.modo = o.modo; this.contexto = o.contexto;
    this.lista = true; this.estado = 'esperando';
    this.emit({ k: 'sistema', s: this.idioma === 'es' ? 'Codex exec: sin aprobaciones interactivas. El sandbox deniega lo que requiere aprobación; plan usa solo lectura. Prueba real pendiente fuera del sandbox de Codex.' : 'Codex exec: no interactive approvals. The sandbox denies operations requiring approval; plan is read-only. Live validation outside Codex remains pending.' });
    this.deps.cambio();
  }
  enviar(texto: string, adjuntos: AdjuntoListo[]) {
    if (!this.lista) throw new Error('Codex: chat cerrado');
    if (this.proceso) throw new Error('Codex: espera a que termine el turno');
    const args = argumentosCodex({ modelo: this.modelo, resume: this.sessionId, esfuerzo: this.esfuerzo, sandbox: this.modo === 'plan' ? 'read-only' : 'workspace-write' });
    const prompt = [!this.sessionId && this.contexto, texto, ...adjuntos.map(a => `Adjunto: ${a.ruta} (${a.tipo})`)].filter(Boolean).join('\n\n');
    this.emit({ k: 'usuario', s: texto, adjuntos: adjuntos.map(a => a.nombre) });
    this.estado = 'trabajando';
    const child = (this.deps.spawn ?? (spawnReal as SpawnCodex))('codex', args, { cwd: this.agente.carpeta, env: { ...process.env }, stdio: ['pipe', 'pipe', 'pipe'] });
    this.proceso = child;
    let buffer = '', terminado = false, stderr = '', detenido = false;
    const inicio = Date.now();
    const mensaje = (e: any) => {
      if (e.type === 'thread.started' && UUID_RE.test(e.thread_id ?? '')) { this.sessionId = e.thread_id; this.deps.cambio(); }
      else if ((e.type === 'item.completed' || e.type === 'item.started') && e.item) {
        const i = e.item;
        if (i.type === 'agent_message' && e.type === 'item.completed') this.emit({ k: 'texto', s: String(i.text ?? '') });
        else if (i.type === 'command_execution') {
          if (e.type === 'item.started') this.emit({ k: 'herramienta', id: i.id, nombre: 'Bash', resumen: String(i.command ?? ''), entrada: String(i.command ?? '') });
          else this.emit({ k: 'resultado-herr', id: i.id, s: String(i.aggregated_output ?? '').slice(0, 10_000), error: i.exit_code !== 0 });
        } else if (i.type === 'file_change' && e.type === 'item.completed') {
          for (const c of Array.isArray(i.changes) ? i.changes : []) if (typeof c.path === 'string' && c.kind !== 'delete') this.emit({ k: 'archivo', ruta: c.path, herramienta: 'Codex' });
        }
      } else if (e.type === 'turn.completed' || e.type === 'turn.failed') {
        terminado = true;
        this.emit({ k: 'fin', costo: null, total: null, costoDesconocido: true, entrada: e.usage?.input_tokens ?? 0, salida: e.usage?.output_tokens ?? 0, ms: Date.now() - inicio, error: e.type === 'turn.failed' ? String(e.error?.message ?? 'Codex: error') : '' });
      } else if (e.type === 'error') this.emit({ k: 'sistema', error: true, s: String(e.message ?? 'Codex: error').slice(0, 2000) });
    };
    child.stdout.setEncoding('utf8');
    child.stdout.on('data', (chunk: string) => {
      buffer += chunk;
      if (buffer.length > 2_000_000) { buffer = ''; child.kill('SIGTERM'); this.emit({ k: 'sistema', error: true, s: 'Codex: salida JSON demasiado grande' }); return; }
      let pos: number;
      while ((pos = buffer.indexOf('\n')) >= 0) {
        const linea = buffer.slice(0, pos); buffer = buffer.slice(pos + 1);
        try { mensaje(JSON.parse(linea)); } catch { /* línea incompleta o no JSON */ }
      }
    });
    child.stderr.setEncoding('utf8'); child.stderr.on('data', (s: string) => { stderr = (stderr + s).slice(-4000); });
    this.fin = new Promise<void>(resolve => {
      let finalizado = false;
      const fin = (code: number | null, error?: Error) => {
        if (finalizado) return; finalizado = true;
        if (buffer.trim()) try { mensaje(JSON.parse(buffer)); } catch { /* cola rota */ }
        detenido = child.killed;
        if (!terminado) this.emit({ k: 'fin', costo: null, total: null, costoDesconocido: true, detenido, error: detenido ? '' : (error?.message ?? (code !== 0 ? stderr || `Codex terminó con código ${code}` : 'Codex terminó sin resultado')).slice(0, 2000), ms: Date.now() - inicio });
        if (this.proceso === child) { this.proceso = undefined; this.estado = this.lista ? 'esperando' : 'cerrada'; this.deps.cambio(); }
        resolve();
      };
      child.once('error', error => fin(null, error)); child.once('close', code => fin(code));
    });
    child.stdin.on('error', () => { /* EPIPE: el error del proceso llega por close */ });
    child.stdin.end(prompt);
    this.deps.cambio();
  }
  async detener() {
    const p = this.proceso;
    if (p) {
      p.kill('SIGTERM');
      const reloj = setTimeout(() => { if (this.proceso === p) p.kill('SIGKILL'); }, 2000);
      try { await this.fin; } finally { clearTimeout(reloj); }
    }
  }
  async cerrar() { this.lista = false; await this.detener(); this.estado = 'cerrada'; this.deps.cambio(); }
  async cambiarModo(modo: Modo) {
    if (!['default', 'plan'].includes(modo)) throw new Error('Codex: solo default o plan');
    if (this.proceso) throw new Error('Codex: detén el turno antes de cambiar el modo');
    this.modo = modo; this.deps.cambio();
  }
}
