// Una sesión del Agent SDK por agente: entrada en streaming, eventos al navegador y permisos.
import { randomUUID } from 'node:crypto';
import type { Query, SDKMessage, SDKUserMessage, Options, PermissionResult, EffortLevel, PermissionUpdate, PermissionRuleValue } from '@anthropic-ai/claude-agent-sdk';
import type { Agente, Modo } from './config.ts';
import { reglaValida } from './config.ts';
import type { Clase } from './seguridad.ts';
// @ts-ignore: módulo JS compartido con el navegador
import { t as tr } from '../public/i18n.js';

export type Idioma = 'es' | 'en';
export type AdjuntoListo = { clase: Clase; tipo: string; ruta: string; nombre: string; tam: number; datos?: string };
const ESCRIBE = new Set(['Write', 'Edit', 'MultiEdit', 'NotebookEdit']);
export const RE_ARTIFACT = /https:\/\/claude\.ai\/(?:code\/)?artifact\/[A-Za-z0-9-]{6,80}/g;
const tam = (n: number) => (n < 1024 ? `${n} B` : n < 1048576 ? `${(n / 1024).toFixed(0)} KB` : `${(n / 1048576).toFixed(1)} MB`);

export type Ev = { k: string; [x: string]: unknown };
export type Emitir = (agente: string, ev: Ev) => void;
export type FnQuery = (p: { prompt: AsyncIterable<SDKUserMessage>; options: Options }) =>
  AsyncIterable<SDKMessage> & Pick<Query, 'interrupt' | 'setPermissionMode'>;

export const recortar = (s: string, n: number) => (s.length > n ? s.slice(0, n) + '…' : s);

// Cola que alimenta el prompt en streaming: el SDK la lee como AsyncIterable.
class Cola<T> {
  private items: T[] = [];
  private despertar?: () => void;
  private cerrada = false;
  push(x: T) { this.items.push(x); this.despertar?.(); }
  close() { this.cerrada = true; this.despertar?.(); }
  async *[Symbol.asyncIterator]() {
    for (;;) {
      while (this.items.length) yield this.items.shift()!;
      if (this.cerrada) return;
      await new Promise<void>(r => (this.despertar = r));
      this.despertar = undefined;
    }
  }
}

function resumir(h: string, e: Record<string, unknown>) {
  const v = e.command ?? e.file_path ?? e.notebook_path ?? e.pattern ?? e.url ?? e.query ?? e.path ?? e.description;
  return typeof v === 'string' ? recortar(v, 300) : '';
}

// Preguntas de AskUserQuestion en forma segura para la web.
function preguntasDe(e: Record<string, unknown>) {
  return (Array.isArray(e.questions) ? e.questions : []).slice(0, 4).map((q: any) => ({
    pregunta: String(q?.question ?? '').slice(0, 1000), titulo: String(q?.header ?? '').slice(0, 40), multiple: q?.multiSelect === true,
    opciones: (Array.isArray(q?.options) ? q.options : []).slice(0, 6).map((o: any) => ({ etiqueta: String(o?.label ?? '').slice(0, 200), detalle: String(o?.description ?? '').slice(0, 500) })),
  }));
}

// Se muestran las reglas exactas antes de pedir confirmación. Solo se aceptan sugerencias
// addRules/allow del SDK. Sin sugerencia, Bash admite únicamente un comando simple y corto:
// nunca se trunca ni se convierte un comando compuesto en permiso para toda la herramienta.
export const reglaTexto = (r: PermissionRuleValue) => (r.ruleContent ? `${r.toolName}(${r.ruleContent})` : r.toolName);
function reglasPara(h: string, e: Record<string, unknown>, sug?: PermissionUpdate[]): PermissionRuleValue[] {
  if (h === 'AskUserQuestion' || h === 'ExitPlanMode') return [];
  const sugeridas = (sug ?? []).flatMap(u => (u.type === 'addRules' && u.behavior === 'allow' ? u.rules : []));
  const validas = sugeridas.filter(r => r && typeof r.toolName === 'string'
    && /^[A-Za-z_][\w-]*$/.test(r.toolName)
    && (r.ruleContent === undefined || typeof r.ruleContent === 'string') && reglaValida(reglaTexto(r)));
  if (validas.length) return validas.map(r => ({ toolName: r.toolName, ...(r.ruleContent !== undefined ? { ruleContent: r.ruleContent } : {}) }));
  if (sugeridas.length) return []; // una sugerencia inválida no provoca una regla inferida
  if (h === 'Bash' && typeof e.command === 'string' && e.command.length > 0 && e.command.length <= 200
      && /^[A-Za-z0-9_./ -]+$/.test(e.command)) return [{ toolName: 'Bash', ruleContent: e.command }];
  // Los paths de Write/Edit siguen la sintaxis de patrones del SDK. No inferimos patrones de un path literal.
  return [];
}

// Tarjetas de permiso: cada pedido de canUseTool espera el clic del usuario. Sin respuesta a tiempo = rechazo.
export class Permisos {
  private pend = new Map<string, { agente: string; tarjeta: Ev; fin: (r: PermissionResult, como: string) => void; entrada: Record<string, unknown>; reglas: PermissionRuleValue[] }>();
  private emitir: Emitir;
  private esperaMs: number;
  private l: Idioma;
  constructor(emitir: Emitir, esperaMs: number, idioma: Idioma = 'es') { this.emitir = emitir; this.esperaMs = esperaMs; this.l = idioma; }

  pedir(agente: string, herramienta: string, entrada: Record<string, unknown>, op: { signal: AbortSignal; title?: string; decisionReason?: string; suggestions?: PermissionUpdate[] }): Promise<PermissionResult> {
    if (op.signal.aborted) return Promise.resolve({ behavior: 'deny', message: tr(this.l, 'perm_cancelado') });
    return new Promise(res => {
      const id = randomUUID(), reglas = reglasPara(herramienta, entrada, op.suggestions);
      const tarjeta: Ev = {
        k: 'permiso', id, herramienta, titulo: op.title ?? '', motivo: op.decisionReason ?? '',
        resumen: resumir(herramienta, entrada), entrada: recortar(JSON.stringify(entrada, null, 2), 4000), vence: Date.now() + this.esperaMs,
        ...(herramienta === 'AskUserQuestion' ? { preguntas: preguntasDe(entrada) } : {}),
        reglas: reglas.map(reglaTexto), // lo que agregaría «Permitir siempre» (se muestra antes de confirmar)
      };
      const fin = (r: PermissionResult, como: string) => {
        if (!this.pend.delete(id)) return;
        clearTimeout(reloj);
        op.signal.removeEventListener('abort', abortar);
        this.emitir(agente, { k: 'permiso-fin', id, como, herramienta, resumen: tarjeta.resumen });
        res(r);
      };
      const reloj = setTimeout(() => fin({ behavior: 'deny', message: tr(this.l, 'perm_vencido') }, 'vencido'), this.esperaMs);
      const abortar = () => fin({ behavior: 'deny', message: tr(this.l, 'perm_cancelado') }, 'cancelado');
      op.signal.addEventListener('abort', abortar, { once: true });
      this.pend.set(id, { agente, tarjeta, fin, entrada, reglas });
      this.emitir(agente, tarjeta);
    });
  }

  // respuestas: solo para AskUserQuestion ({pregunta: respuesta}); viajan como `answers` en updatedInput.
  // siempre: 'sesion' (destino session, se va al cerrar) o 'proyecto' (localSettings: .claude/settings.local.json de su
  // carpeta). Nunca userSettings ni projectSettings. Devuelve las reglas agregadas para que el servidor las anote.
  decidir(agente: string, id: string, permitir: boolean, mensaje: string, respuestas?: Record<string, string>, siempre?: 'sesion' | 'proyecto'): false | { reglas: string[]; siempre?: 'sesion' | 'proyecto' } {
    const p = this.pend.get(id);
    if (!p || p.agente !== agente) return false;
    if (permitir && respuestas && p.tarjeta.herramienta === 'AskUserQuestion') { p.fin({ behavior: 'allow', updatedInput: { ...p.entrada, answers: respuestas } }, 'respondido'); return { reglas: [] }; }
    if (permitir && siempre && p.reglas.length) {
      const destination = siempre === 'sesion' ? 'session' : 'localSettings';
      p.fin({ behavior: 'allow', updatedInput: p.entrada, updatedPermissions: [{ type: 'addRules', rules: p.reglas, behavior: 'allow', destination }] }, siempre === 'sesion' ? 'permitido-sesion' : 'permitido-proyecto');
      return { reglas: p.reglas.map(reglaTexto), siempre };
    }
    p.fin(permitir ? { behavior: 'allow', updatedInput: p.entrada } : { behavior: 'deny', message: mensaje || tr(this.l, 'perm_rechazado') }, permitir ? 'permitido' : 'rechazado');
    return { reglas: [] };
  }

  todas() { return [...this.pend.values()].map(p => ({ ...p.tarjeta, agente: p.agente })); }

  cancelarDe(agente: string, mensaje: string) {
    for (const p of [...this.pend.values()]) if (p.agente === agente) p.fin({ behavior: 'deny', message: mensaje }, 'cancelado');
  }

  pendientesDe(agente: string) { return [...this.pend.values()].filter(p => p.agente === agente).map(p => p.tarjeta); }
}

// Traduce un mensaje (en vivo o del historial) a eventos de la web. Lo de subagentes se omite.
export function deMensaje(tipo: string, message: any, conTextoUsuario: boolean): Ev[] {
  const out: Ev[] = [];
  const bloques = typeof message?.content === 'string' ? [{ type: 'text', text: message.content }] : Array.isArray(message?.content) ? message.content : [];
  if (tipo === 'assistant') {
    for (const b of bloques) {
      if (b.type === 'text' && b.text) out.push({ k: 'texto', s: String(b.text) });
      else if (b.type === 'tool_use') out.push({ k: 'herramienta', id: b.id, nombre: String(b.name), resumen: resumir(String(b.name), b.input ?? {}), entrada: recortar(JSON.stringify(b.input ?? {}, null, 2), 4000), ruta: typeof (b.input?.file_path ?? b.input?.notebook_path) === 'string' ? (b.input.file_path ?? b.input.notebook_path) : undefined });
    }
  } else if (tipo === 'user') {
    let texto = '', imgs = 0;
    for (const b of bloques) {
      if (b.type === 'tool_result') {
        const c = typeof b.content === 'string' ? b.content : Array.isArray(b.content) ? b.content.map((x: any) => (x.type === 'text' ? x.text : `[${x.type}]`)).join('\n') : '';
        out.push({ k: 'resultado-herr', id: b.tool_use_id, s: recortar(c, 3000), error: !!b.is_error });
        for (const url of new Set(c.match(RE_ARTIFACT) ?? [])) out.push({ k: 'artifact', url, id: b.tool_use_id });
      } else if (b.type === 'image') imgs++;
      else if (b.type === 'text' && conTextoUsuario && /^\[Request interrupted/.test(b.text)) out.push({ k: 'sistema', clave: 'sis_interrumpido' });
      else if (b.type === 'text' && conTextoUsuario && !/^\s*<(system-reminder|command-|local-command)/.test(b.text)) texto += b.text;
    }
    if (texto || imgs) out.push({ k: 'usuario', s: texto, imgs });
  }
  return out;
}

export type Lanzamiento = { resume?: string; modelo: string; esfuerzo?: EffortLevel; modo: Modo; contexto?: string };

export class Sesion {
  estado: 'esperando' | 'trabajando' | 'cerrada' = 'cerrada';
  sessionId?: string;
  modelo = '';
  esfuerzo?: EffortLevel;
  modo: Modo = 'default';
  reglasSesion: string[] = []; // agregadas con «Permitir siempre (esta sesión)»; se van al cerrar
  private cola?: Cola<SDKUserMessage>;
  private q?: ReturnType<FnQuery>;
  private abort?: AbortController;
  private fin?: Promise<void>;
  private costoPrevio = 0;
  private anunciada?: string;
  private detenida = false;
  private herr = new Map<string, { nombre: string; ruta?: string }>();
  private vistos = new Set<string>();

  readonly agente: Agente;
  private deps: { query: FnQuery; permisos: Permisos; emitir: Emitir; cambio: () => void; cupo?: (info: unknown) => void };
  readonly l: Idioma;
  readonly titulo?: string;
  constructor(agente: Agente, deps: Sesion['deps'], idioma: Idioma = 'es', titulo?: string) { this.agente = agente; this.deps = deps; this.l = idioma; this.titulo = titulo; }
  private tx(k: string, p?: Record<string, unknown>) { return tr(this.l, k, p); }

  private emit(ev: Ev) { this.deps.emitir(this.agente.nombre, ev); }
  get viva() { return !!this.q; }

  async lanzar(o: Lanzamiento) {
    await this.cerrar();
    Object.assign(this, { modelo: o.modelo, esfuerzo: o.esfuerzo, modo: o.modo, reglasSesion: [], sessionId: o.resume, costoPrevio: 0, anunciada: undefined, detenida: false });
    this.herr.clear();
    const cola = (this.cola = new Cola<SDKUserMessage>()), abort = (this.abort = new AbortController());
    const q = (this.q = this.deps.query({
      prompt: cola,
      options: {
        cwd: this.agente.carpeta, // su casa: su CLAUDE.md, skills y memoria
        resume: o.resume,
        model: o.modelo,
        effort: o.esfuerzo,
        // Modo elegido entre los admitidos por la web; nunca bypassPermissions.
        permissionMode: o.modo,
        canUseTool: (h, e, op) => this.deps.permisos.pedir(this.agente.nombre, h, e, op),
        includePartialMessages: true,
        abortController: abort,
        ...(o.resume ? {} : { title: this.titulo ?? this.agente.nombre }),
        // Contexto de zona/agente: se AÑADE al prompt de Claude Code (su CLAUDE.md sigue igual; nada se escribe en su carpeta).
        ...(o.contexto ? { systemPrompt: { type: 'preset' as const, preset: 'claude_code' as const, append: o.contexto } } : {}),
      },
    }));
    this.estado = 'esperando';
    this.emit({ k: 'sistema', s: o.resume ? this.tx('sis_retomando', { id: o.resume.slice(0, 8) }) : this.tx('sis_nueva') });
    this.deps.cambio();
    this.fin = (async () => {
      try { for await (const m of q) this.manejar(m); }
      catch (e) { if (!abort.signal.aborted) this.emit({ k: 'sistema', s: this.tx('sis_error', { e: recortar(String((e as Error)?.message ?? e), 500) }), error: true }); }
      finally {
        if (this.q === q) {
          this.q = this.cola = undefined;
          this.estado = 'cerrada';
          this.deps.permisos.cancelarDe(this.agente.nombre, this.tx('perm_sesion_cerrada'));
          this.emit({ k: 'sistema', s: this.tx('sis_cerrada') });
          this.deps.cambio();
        }
      }
    })();
  }

  private manejar(m: SDKMessage) {
    if (m.type === 'system' && m.subtype === 'init') {
      if (this.anunciada === m.session_id) return; // el init llega en cada turno; se anuncia una vez
      this.sessionId = this.anunciada = m.session_id;
      this.emit({ k: 'sistema', s: this.tx('sis_init', { id: m.session_id.slice(0, 8), m: m.model, p: m.permissionMode }) });
      if (m.apiKeySource && m.apiKeySource !== 'none') this.emit({ k: 'sistema', s: this.tx('sis_apikey', { k: m.apiKeySource }), error: true });
      this.deps.cambio();
    } else if (m.type === 'rate_limit_event') {
      this.deps.cupo?.(m.rate_limit_info); // uso del plan (5 h / semana) para la batería de Claude
    } else if (m.type === 'stream_event') {
      const ev: any = m.event;
      if (!m.parent_tool_use_id && ev.type === 'content_block_delta' && ev.delta?.type === 'text_delta') this.emit({ k: 'delta', s: ev.delta.text });
    } else if ((m.type === 'assistant' || m.type === 'user') && !m.parent_tool_use_id) {
      for (const ev of deMensaje(m.type, m.message, false)) {
        if (ev.k === 'herramienta') this.herr.set(String(ev.id), { nombre: String(ev.nombre), ruta: ev.ruta as string | undefined });
        if (ev.k === 'artifact') { if (this.vistos.has(String(ev.url))) continue; this.vistos.add(String(ev.url)); ev.titulo = this.herr.get(String(ev.id))?.nombre ?? ''; }
        if (ev.k === 'texto') for (const url of new Set(String(ev.s).match(RE_ARTIFACT) ?? [])) if (!this.vistos.has(url)) { this.vistos.add(url); this.emit({ k: 'artifact', url, titulo: '' }); }
        this.emit(ev);
        // Resultados: archivos que el agente creó o editó (se sirven solo si están en su carpeta).
        const h = ev.k === 'resultado-herr' && !ev.error ? this.herr.get(String(ev.id)) : undefined;
        if (h && ESCRIBE.has(h.nombre) && h.ruta) this.emit({ k: 'archivo', ruta: h.ruta, herramienta: h.nombre });
      }
    } else if (m.type === 'result') {
      const total = m.total_cost_usd ?? 0;
      this.emit({
        k: 'fin', error: m.is_error && !this.detenida ? m.subtype : '', detenido: this.detenida, costo: Math.max(0, total - this.costoPrevio), total,
        entrada: (m.usage?.input_tokens ?? 0) + (m.usage?.cache_read_input_tokens ?? 0) + (m.usage?.cache_creation_input_tokens ?? 0),
        salida: m.usage?.output_tokens ?? 0, ms: m.duration_ms,
      });
      this.costoPrevio = total;
      this.detenida = false;
      this.estado = 'esperando';
      this.deps.cambio();
    }
  }

  // Imágenes → bloques image; PDF → bloque document; el resto → una línea con la ruta para que el agente lo lea.
  enviar(texto: string, adjuntos: AdjuntoListo[]) {
    if (!this.cola) throw new Error(this.tx('err_no_abierta'));
    const content: any[] = [], lineas: string[] = [];
    for (const a of adjuntos) {
      if (a.clase === 'imagen' && a.datos) content.push({ type: 'image', source: { type: 'base64', media_type: a.tipo, data: a.datos } });
      else if (a.clase === 'pdf' && a.datos) content.push({ type: 'document', source: { type: 'base64', media_type: 'application/pdf', data: a.datos }, title: a.nombre });
      else lineas.push(this.tx('adjunto_linea', { ruta: a.ruta, tipo: a.tipo, tam: tam(a.tam) }));
    }
    const todo = [texto, ...lineas].filter(Boolean).join('\n');
    if (todo) content.push({ type: 'text', text: todo });
    this.cola.push({ type: 'user', message: { role: 'user', content }, parent_tool_use_id: null } as SDKUserMessage);
    this.estado = 'trabajando';
    this.emit({ k: 'usuario', s: texto, imgs: adjuntos.filter(a => a.clase === 'imagen').length, adjuntos: adjuntos.filter(a => a.clase !== 'imagen').map(a => a.nombre) });
    this.deps.cambio();
  }

  async detener() {
    this.deps.permisos.cancelarDe(this.agente.nombre, this.tx('perm_detenido'));
    this.detenida = this.estado === 'trabajando';
    await this.q?.interrupt();
    this.emit({ k: 'sistema', s: this.tx('sis_detenido') });
  }

  // Cambia el modo de permisos de la sesión en curso (si no está abierta, vale desde el próximo lanzamiento).
  async cambiarModo(modo: Modo) {
    this.modo = modo;
    if (this.q) { await this.q.setPermissionMode(modo); this.emit({ k: 'sistema', s: this.tx('sis_modo', { m: this.tx('modo_' + modo) }) }); }
    this.deps.cambio();
  }

  async cerrar() {
    if (!this.q) return;
    this.cola?.close();
    this.abort?.abort();
    await this.fin?.catch(() => {});
  }
}
