// Oficina de agentes: servidor local (solo 127.0.0.1) que lanza agentes con el Agent SDK y habla con la web.
import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import { readFileSync, mkdirSync, rmSync, writeFileSync, copyFileSync, existsSync, statSync } from 'node:fs';
import { join, dirname, basename, extname, isAbsolute, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { homedir, tmpdir } from 'node:os';
import { randomBytes } from 'node:crypto';
import { WebSocketServer, type WebSocket } from 'ws';
import { query as sdkQuery, listSessions, getSessionMessages, type EffortLevel } from '@anthropic-ai/claude-agent-sdk';
import { cargarConfig, validar, patronARegex, patronSeguro, MAX_PUESTO, MAX_ZONAS, MAX_CONTEXTO, PALETA, type Config, type Agente } from './config.ts';
import { asignarPuestos, puestoLibre, validarCarpeta, guardarAtomico } from './equipo.ts';
import { sesionesEnTerminal } from './agentes.ts';
import { agregarBuzon, preguntas, responderPregunta, hiloDirector } from './tablero.ts';
import { Estado } from './estado.ts';
import { crudoDemo, sembrarDemo, estadoDemo, queryDemo, DIR_DEMO } from './demo.ts';
import { Sesion, Permisos, deMensaje, recortar, type Ev, type FnQuery, type AdjuntoListo, type Idioma } from './chat.ts';
import { MAX_IMAGEN, MAX_ADJUNTO, nuevoToken, hostValido, origenValido, tokenValido, clasificar, nombreSeguro, dentroDe, firmar, TEXTO } from './seguridad.ts';
// @ts-ignore: módulo JS compartido con el navegador
import { t as tr } from '../public/i18n.js';

const RAIZ = join(dirname(fileURLToPath(import.meta.url)), '..');
const MODELOS = ['opus', 'sonnet', 'haiku'];
const ESFUERZOS: EffortLevel[] = ['low', 'medium', 'high', 'xhigh', 'max'];
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
const ID_ADJ = /^[0-9a-f]{16}_[A-Za-z0-9._-]{1,100}$/;
const DIR = '_director'; // clave interna del director cuando se lanza desde la web
const ESTATICOS: Record<string, [string, string]> = {
  '/app.js': ['public/app.js', 'text/javascript; charset=utf-8'],
  '/md.js': ['public/md.js', 'text/javascript; charset=utf-8'],
  '/i18n.js': ['public/i18n.js', 'text/javascript; charset=utf-8'],
  '/oficina.js': ['public/oficina.js', 'text/javascript; charset=utf-8'],
  '/plano.js': ['public/plano.js', 'text/javascript; charset=utf-8'],
  '/abeja.js': ['public/abeja.js', 'text/javascript; charset=utf-8'],
  '/favicon.svg': ['public/favicon.svg', 'image/svg+xml'],
  '/estilo.css': ['public/estilo.css', 'text/css; charset=utf-8'],
};
const TIPOS: Record<string, string> = { png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg', gif: 'image/gif', webp: 'image/webp', svg: 'image/svg+xml', pdf: 'application/pdf' };

export type Opciones = {
  rutaConfig?: string; // por defecto oficina.config.json (o el ejemplo); también --config u OFICINA_CONFIG
  home?: string; // carpeta personal para validar carpetas de agentes nuevos (por defecto la del sistema)
  demo?: boolean;
  puerto?: number;
  query?: FnQuery;
  esperaPermisoMs?: number;
  dirSesiones?: string; // ~/.claude/sessions (para saber quién está en una terminal)
  dirSubidas?: string;
  dirParaDirector?: string;
  generador?: () => unknown; // estado de la oficina; por defecto el generador propio (src/estado.ts)
  listar?: (dir: string) => Promise<{ sessionId: string; customTitle?: string; summary: string; firstPrompt?: string; lastModified: number; cwd?: string }[]>;
};

export function crear(o: Opciones = {}) {
  // Config: el archivo se lee una vez; los cambios desde la web (crear/editar/quitar agentes, puestos) se escriben
  // de forma atómica con copia .bak. Con el ejemplo no se escribe nada hasta que el usuario cree o edite algo.
  let origen: string, crudo: any, config: Config;
  if (o.demo) { crudo = crudoDemo(); origen = join(DIR_DEMO, 'oficina.config.json'); config = validar(crudo, RAIZ); sembrarDemo(config); guardarAtomico(origen, crudo); }
  else ({ config, origen, crudo } = cargarConfig(RAIZ, o.rutaConfig ?? process.env.OFICINA_CONFIG));
  const esEjemplo = basename(origen) === 'oficina.config.example.json';
  const destino = esEjemplo ? join(dirname(origen), 'oficina.config.json') : origen;
  if (asignarPuestos(crudo, config) && !esEjemplo) guardarAtomico(destino, crudo); // el puesto adivinado queda fijo
  const home = o.home ?? (o.demo ? DIR_DEMO : homedir());
  const puerto = o.puerto ?? (Number(process.env.PUERTO) || config.puerto);
  const l: Idioma = config.idioma === 'es' ? 'es' : 'en';
  const tx = (k: string, p?: Record<string, unknown>) => tr(l, k, p) as string;
  const token = nuevoToken();
  const director = config.director;
  const dirRe = director ? patronARegex(director.patronSesion) : null;
  const agDir: Agente | null = director?.carpeta ? { nombre: DIR, carpeta: director.carpeta, color: director.color, modelo: director.modelo, descripcion: '' } : null;
  let roster = config.agentes;
  let porNombre = new Map([...roster, ...(agDir ? [agDir] : [])].map(a => [a.nombre, a]));
  function recargar() { // tras crear/editar/quitar: se valida todo de nuevo antes de usarlo
    const nuevo = validar(crudo, RAIZ);
    asignarPuestos(crudo, nuevo);
    config.agentes = nuevo.agentes;
    config.oficina = nuevo.oficina;
    roster = config.agentes;
    porNombre = new Map([...roster, ...(agDir ? [agDir] : [])].map(a => [a.nombre, a]));
  }
  const dirCoord = config.coordinacion.dir;
  mkdirSync(dirCoord, { recursive: true });
  const tmp = join(RAIZ, 'tmp');
  const dirSubidas = o.dirSubidas ?? join(tmp, 'subidas');
  rmSync(dirSubidas, { recursive: true, force: true }); // ponytail: se limpia en cada arranque
  mkdirSync(dirSubidas, { recursive: true, mode: 0o700 });
  // ponytail: lo enviado al director no se borra solo (lo abre después); limpiar a mano si crece.
  const dirParaDirector = o.dirParaDirector ?? join(tmp, 'para-general');
  mkdirSync(dirParaDirector, { recursive: true, mode: 0o700 });
  for (const a of porNombre.values()) if (o.demo || a.carpeta.startsWith(tmpdir() + sep)) mkdirSync(a.carpeta, { recursive: true }); // carpetas de prueba temporales
  const dirSesiones = o.dirSesiones ?? (o.demo ? join(tmpdir(), 'agenthive-demo', 'sesiones') : undefined);
  if (dirSesiones) mkdirSync(dirSesiones, { recursive: true });
  const listar = o.listar ?? (o.demo ? async () => [] : (dir: string) => listSessions({ dir, limit: 40 }));
  const generador = o.generador ?? (o.demo ? estadoDemo() : (() => {
    const e = new Estado({ home: homedir(), memoria: join(tmp, 'vistos.json'), esDirector: n => !!dirRe?.test(n), nombreDirector: director?.nombre, codex: config.codex, idioma: l });
    return () => e.generar();
  })());

  // ---- Archivos servibles: firma por archivo + ruta real dentro de raíces permitidas ----
  const raices = (alcance: string) => (alcance === '_' ? [tmp, dirSubidas, dirParaDirector] : porNombre.has(alcance) ? [porNombre.get(alcance)!.carpeta, tmp] : []);
  function enlace(alcance: string, ruta: string) {
    const real = dentroDe(ruta, raices(alcance));
    if (!real) return null;
    const q = `a=${encodeURIComponent(alcance)}&r=${encodeURIComponent(real)}&k=${firmar(token, alcance, real)}`;
    const ext = extname(real).slice(1).toLowerCase();
    return { nombre: basename(real), ext, tam: statSync(real).size, url: `/archivo?${q}`, ...(ext === 'html' || ext === 'htm' ? { vista: `/vista?${q}` } : {}) };
  }

  const clientes = new Set<WebSocket>();
  const logs = new Map<string, Ev[]>(); // sobrevive a relanzar: el chat no se borra
  const enviarA = (ws: WebSocket, x: unknown) => ws.readyState === ws.OPEN && ws.send(JSON.stringify(x));
  const difundir = (x: unknown) => { const s = JSON.stringify(x); for (const ws of clientes) if (ws.readyState === ws.OPEN) ws.send(s); };
  const emitir = (agente: string, ev: Ev) => {
    if (ev.k === 'archivo') { // solo archivos dentro de su carpeta; se agregan enlaces firmados
      const a = porNombre.get(agente), r = String(ev.ruta);
      const e = a && enlace(agente, isAbsolute(r) ? r : resolve(a.carpeta, r));
      if (!e) return;
      ev = { ...ev, ...e };
    }
    if (ev.k !== 'delta' && ev.k !== 'permiso') {
      const lg = logs.get(agente) ?? [];
      lg.push({ ...ev, ts: Date.now() });
      if (lg.length > 400) lg.splice(0, lg.length - 400);
      logs.set(agente, lg);
    }
    difundir({ t: 'ev', agente, ev });
    if (ev.k === 'permiso' || ev.k === 'permiso-fin') cambio();
  };
  const permisos = new Permisos(emitir, o.esperaPermisoMs ?? 10 * 60_000, l);
  const sesiones = new Map<string, Sesion>();
  const sesion = (a: Agente) => {
    let s = sesiones.get(a.nombre);
    // El director lanzado desde la web se titula según su patrón ("lead-*" → "lead-web") para reconocerlo como director.
    if (!s) sesiones.set(a.nombre, (s = new Sesion(a, { query: o.query ?? (o.demo ? queryDemo : (sdkQuery as unknown as FnQuery)), permisos, emitir, cambio }, l, a.nombre === DIR ? director!.patronSesion.replace(/\*/g, 'web').replace(/\?/g, 'x') : undefined)));
    return s;
  };

  let terminal = sesionesEnTerminal(dirSesiones);
  const enTerminal = (a: Agente) => terminal.find(t => (a.nombre === DIR ? !!dirRe?.test(t.nombre) : t.nombre === a.nombre));
  function estado() {
    const filas = roster.map(a => {
      const s = sesiones.get(a.nombre), t = enTerminal(a);
      return {
        nombre: a.nombre, carpeta: a.carpeta, color: a.color, descripcion: a.descripcion, modeloDefecto: a.modelo, zona: a.zona, puesto: a.puesto, contexto: a.contexto,
        estado: t ? 'terminal' : s?.viva ? s.estado : 'libre', terminalEstado: t?.estado,
        sesionId: s?.sessionId, modelo: s?.modelo, esfuerzo: s?.esfuerzo, plan: !!s?.plan, permisos: permisos.pendientesDe(a.nombre).length,
      };
    });
    if (director) {
      // Solo un director: si el de la web está activo, se muestra «en la web» aunque se abra otro en una terminal.
      const s = sesiones.get(DIR), t = agDir && enTerminal(agDir) || terminal.find(x => dirRe!.test(x.nombre));
      filas.push({
        nombre: DIR, director: true, mostrar: director.nombre, lanzable: !!agDir, carpeta: director.carpeta ?? '', color: director.color, descripcion: '', modeloDefecto: director.modelo, zona: undefined,
        estado: s?.viva ? s.estado : t ? 'terminal' : 'libre', terminalEstado: t?.estado,
        sesionId: s?.sessionId, modelo: s?.modelo, esfuerzo: s?.esfuerzo, plan: !!s?.plan, permisos: permisos.pendientesDe(DIR).length,
      } as any);
    }
    return filas;
  }
  const msgEstado = () => ({ t: 'estado', agentes: estado(), pendientes: permisos.todas() });
  function cambio() { difundir(msgEstado()); }

  // La oficina (generador), las preguntas y el hilo con el director: se empujan cuando cambian.
  let oficina: unknown = null, ultimaOficina = '';
  const refrescarOficina = () => { try { oficina = generador(); } catch (e) { console.error('generador:', (e as Error).message); } };
  refrescarOficina();
  const hilo = () => !director ? [] : hiloDirector(dirCoord, director.nombre).map(m => ({
    ...m, imagenes: (m as any).imagenes?.map((r: string) => enlace('_', r)?.url).filter(Boolean),
  }));
  const msgOficina = () => ({ t: 'oficina', estado: oficina, preguntas: director ? preguntas(dirCoord, director.nombre) : { pendientes: [], respondidas: [] }, hilo: hilo() });
  function revisarOficina() {
    const s = JSON.stringify(msgOficina());
    if (s !== ultimaOficina) { ultimaOficina = s; for (const ws of clientes) if (ws.readyState === ws.OPEN) ws.send(s); }
  }
  let vuelta = 0;
  const vigia = setInterval(() => {
    vuelta++;
    if (vuelta % 3 === 0) refrescarOficina(); // ~4,5 s, como estado.sh
    revisarOficina();
    if (vuelta % 2) return;
    const n = sesionesEnTerminal(dirSesiones);
    if (JSON.stringify(n) !== JSON.stringify(terminal)) { terminal = n; cambio(); }
  }, 1500);

  async function sesionesDe(a: Agente) {
    const vivas = new Set(terminal.map(t => t.sessionId));
    const lista = await listar(a.carpeta);
    return lista.filter(s => !s.cwd || s.cwd === a.carpeta).map(s => ({
      id: s.sessionId, titulo: recortar(s.customTitle || s.summary || s.firstPrompt || '—', 120), fecha: s.lastModified,
      propia: a.nombre === DIR ? !!dirRe?.test(s.customTitle ?? '') : s.customTitle === a.nombre, enTerminal: vivas.has(s.sessionId),
    }));
  }

  // Solo agentes del roster (o el director configurado), solo en su carpeta, nunca una sesión viva en terminal.
  async function lanzar(a: Agente, d: Record<string, unknown>) {
    if (enTerminal(a)) throw new Error(tx('err_terminal'));
    if (!existsSync(a.carpeta) || !statSync(a.carpeta).isDirectory()) throw new Error(tx('err_carpeta'));
    const modelo = typeof d.modelo === 'string' && MODELOS.includes(d.modelo) ? d.modelo : a.modelo;
    const esfuerzo = ESFUERZOS.includes(d.esfuerzo as EffortLevel) ? (d.esfuerzo as EffortLevel) : undefined;
    const lista = (await sesionesDe(a)).sort((x, y) => y.fecha - x.fecha);
    let resume: string | undefined;
    // El director retoma su última sesión con nombre de director; si no hay, la última de la carpeta.
    if (d.sesion === 'ultima') resume = (lista.find(s => s.propia && !s.enTerminal) ?? (a.nombre === DIR ? lista.find(s => !s.enTerminal) : undefined))?.id;
    else if (typeof d.sesion === 'string' && d.sesion !== 'nueva') {
      const s = UUID.test(d.sesion) && lista.find(x => x.id === d.sesion);
      if (!s) throw new Error(tx('err_sesion_carpeta'));
      if (s.enTerminal) throw new Error(tx('err_sesion_terminal'));
      resume = s.id;
    }
    const s = sesion(a);
    await s.cerrar();
    // Otra conversación = otro chat. "Aplicar modelo" (mantener) y el relanzado automático con chat ya visible lo conservan.
    if (d.mantener !== true && (d.sesion !== 'ultima' || !logs.get(a.nombre)?.length)) {
      const msgs = resume && !o.demo ? await getSessionMessages(resume, { dir: a.carpeta }).catch(() => []) : [];
      const evs = msgs.filter(m => !m.parent_tool_use_id).slice(-60).flatMap(m => deMensaje(m.type, m.message, true));
      logs.set(a.nombre, evs.map(e => ({ ...e, viejo: true })));
      difundir({ t: 'log', agente: a.nombre, eventos: logs.get(a.nombre), permisos: [] });
    }
    await s.lanzar({ resume, modelo, esfuerzo, plan: d.plan === true, contexto: contextoDe(a) });
  }

  // Lo que se añade al prompt: el contexto de su zona y después el suyo propio.
  function contextoDe(a: Agente) {
    const z = a.puesto ? config.oficina.zonas[a.puesto.zona] : undefined;
    return [z?.contexto && tx('ctx_zona', { z: z.nombre, c: z.contexto }), a.contexto && tx('ctx_agente', { c: a.contexto })].filter(Boolean).join('\n\n') || undefined;
  }

  // Adjunto subido a tmp/subidas/<chat>/: se vuelve a validar al usarlo.
  function adjunto(chat: string, id: unknown): AdjuntoListo {
    if (typeof id !== 'string' || !ID_ADJ.test(id)) throw new Error(tx('err_adjunto'));
    const ruta = dentroDe(join(dirSubidas, chat, id), [join(dirSubidas, chat)]);
    if (!ruta) throw new Error(tx('err_adjunto'));
    const b = readFileSync(ruta), c = clasificar(id, b);
    if (!c || c === 'contenido') throw new Error(tx('err_adjunto'));
    return { clase: c.clase, tipo: c.tipo, ruta, nombre: id.slice(17), tam: b.length, ...(c.clase === 'imagen' || c.clase === 'pdf' ? { datos: b.toString('base64') } : {}) };
  }

  let ventana: number[] = [];
  function cupoEscritura() { // ponytail: un cupo global de 20 escrituras por minuto a los archivos de coordinación
    const ahora = Date.now();
    ventana = ventana.filter(x => ahora - x < 60_000);
    if (ventana.length >= 20) return false;
    ventana.push(ahora);
    return true;
  }

  // Mensaje al director por el buzón: los adjuntos se copian a una carpeta que no se borra y viajan como rutas absolutas.
  function aDirector(ws: WebSocket, d: Record<string, unknown>) {
    if (!director) throw new Error(tx('err_sin_director'));
    const texto = typeof d.texto === 'string' ? d.texto.trim() : '';
    const adj = (Array.isArray(d.adjuntos) ? d.adjuntos : []).slice(0, 8).map(id => adjunto(DIR, id));
    if ((!texto && !adj.length) || texto.length > 4000) throw new Error(tx('err_dir_largo', { d: director.nombre }));
    if (!cupoEscritura()) throw new Error(tx('err_cupo'));
    const copia = (a: AdjuntoListo) => { const r = join(dirParaDirector, basename(a.ruta)); copyFileSync(a.ruta, r); return r; };
    const imagenes = adj.filter(a => a.clase === 'imagen').map(copia), otros = adj.filter(a => a.clase !== 'imagen').map(copia);
    agregarBuzon(dirCoord, { to: director.nombre, texto: texto || '(adjunto)', ...(imagenes.length ? { imagenes } : {}), ...(otros.length ? { adjuntos: otros } : {}) });
    revisarOficina();
    enviarA(ws, { t: 'aviso', s: tx('aviso_dir', { d: director.nombre }) });
  }

  async function comando(ws: WebSocket, d: Record<string, unknown>) {
    if (d.t === 'general') return aDirector(ws, d);
    if (d.t === 'buzon') { // a un agente del roster o a una sesión viva en terminal; el director revisa y entrega
      const to = typeof d.agente === 'string' ? d.agente : '', texto = typeof d.texto === 'string' ? d.texto.trim() : '';
      if (to === DIR || (!porNombre.has(to) && !terminal.some(x => x.nombre === to))) throw new Error(tx('err_buzon_dest'));
      if (!texto || texto.length > 1000) throw new Error(tx('err_buzon_largo'));
      if (!cupoEscritura()) throw new Error(tx('err_cupo'));
      const id = agregarBuzon(dirCoord, { to, texto });
      revisarOficina();
      return enviarA(ws, { t: 'aviso', agente: to, s: director ? tx('aviso_buzon', { id, d: director.nombre }) : tx('aviso_buzon_sin_dir', { id }) });
    }
    const a = typeof d.agente === 'string' ? porNombre.get(d.agente) : undefined;
    if (!a) throw new Error(tx('err_roster'));
    const s = sesiones.get(a.nombre);
    switch (d.t) {
      case 'abrir': return enviarA(ws, { t: 'log', agente: a.nombre, eventos: logs.get(a.nombre) ?? [], permisos: permisos.pendientesDe(a.nombre) });
      case 'historial': return enviarA(ws, { t: 'historial', agente: a.nombre, sesiones: await sesionesDe(a) });
      case 'lanzar': return lanzar(a, d);
      case 'enviar': {
        const texto = typeof d.texto === 'string' ? d.texto.slice(0, 50_000) : '';
        const adj = (Array.isArray(d.adjuntos) ? d.adjuntos : []).slice(0, 8).map(id => adjunto(a.nombre, id));
        if (!texto.trim() && !adj.length) throw new Error(tx('err_vacio'));
        if (!s?.viva) await lanzar(a, { sesion: 'ultima', modelo: d.modelo, esfuerzo: d.esfuerzo, plan: d.plan });
        return sesion(a).enviar(texto, adj);
      }
      case 'permiso':
        if (typeof d.id !== 'string' || !permisos.decidir(a.nombre, d.id, d.permitir === true, typeof d.mensaje === 'string' ? d.mensaje.slice(0, 2000) : '', respuestasValidas(d.respuestas)))
          throw new Error(tx('err_permiso'));
        return;
      case 'detener': return s?.detener();
      case 'cerrar': return s?.cerrar();
      case 'plan': return s?.modoPlan(d.plan === true);
      default: throw new Error(tx('err_comando'));
    }
  }

  function respuestasValidas(r: unknown) {
    if (!r || typeof r !== 'object' || Array.isArray(r)) return undefined;
    const e = Object.entries(r).filter(([k, v]) => typeof v === 'string' && k.length <= 1000).slice(0, 4).map(([k, v]) => [k, (v as string).slice(0, 2000)]);
    return e.length ? Object.fromEntries(e) as Record<string, string> : undefined;
  }

  const responderTexto = (res: ServerResponse, code: number, msg: string) => res.writeHead(code, { 'Content-Type': 'text/plain; charset=utf-8' }).end(msg);
  const prohibido = (res: ServerResponse) => responderTexto(res, 403, tx('http_prohibido'));

  // POST /preguntas {id, respuesta}: responde una pregunta del director.
  function responder(req: IncomingMessage, res: ServerResponse) {
    if (!origenValido(req.headers.origin, puerto) || !tokenValido(req.headers['x-token'], token)) return prohibido(res);
    let cuerpo = '';
    req.setEncoding('utf8');
    req.on('data', (x: string) => { cuerpo += x; if (cuerpo.length > 8192) req.destroy(); });
    req.on('end', () => {
      let d: Record<string, unknown> = {};
      try { d = JSON.parse(cuerpo); } catch { return responderTexto(res, 400, tx('http_json')); }
      const respuesta = typeof d.respuesta === 'string' ? d.respuesta.trim() : '';
      if (typeof d.id !== 'string' || !respuesta || respuesta.length > 1000) return responderTexto(res, 400, tx('http_resp_largo'));
      if (!cupoEscritura()) return responderTexto(res, 429, tx('err_cupo'));
      const r = responderPregunta(dirCoord, d.id, respuesta, director?.nombre ?? 'director', p => tx('resp_pregunta', { p, r: respuesta }));
      if (r !== 200) return responderTexto(res, r, tx(r === 404 ? 'http_pregunta_no' : 'http_pregunta_ya'));
      revisarOficina();
      res.writeHead(200, { 'Content-Type': 'application/json' }).end('{"ok":true}');
    });
  }

  // POST /agentes {accion: crear|editar|quitar, ...}: cambia el equipo fijo en la config (nunca carpetas ni sesiones).
  // El director y los bucles de Codex no se tocan desde aquí. Crear no lanza al agente.
  function equipo(req: IncomingMessage, res: ServerResponse) {
    if (!origenValido(req.headers.origin, puerto) || !tokenValido(req.headers['x-token'], token)) return prohibido(res);
    let cuerpo = '';
    req.setEncoding('utf8');
    req.on('data', (x: string) => { cuerpo += x; if (cuerpo.length > 16384) req.destroy(); });
    req.on('end', async () => {
      let d: any;
      try { d = JSON.parse(cuerpo); } catch { return responderTexto(res, 400, tx('http_json')); }
      const err = (code: number, k: string) => responderTexto(res, code, tx(k));
      const nombre = typeof d?.nombre === 'string' ? d.nombre : '';
      if (nombre === DIR || nombre.startsWith('_')) return err(400, 'err_no_dir_ui');
      const k = crudo.agentes.findIndex((a: any) => a?.nombre === nombre), antes = JSON.stringify(crudo);
      const puesto = d.puesto === undefined ? undefined : d.puesto;
      if (puesto !== undefined && !(Number.isInteger(puesto?.zona) && Number.isInteger(puesto?.i) && puesto.zona >= 0 && puesto.zona < config.oficina.zonas.length && puesto.i >= 0 && puesto.i <= MAX_PUESTO)) return err(400, 'err_puesto');
      if (puesto && !puestoLibre(config, puesto, d.accion === 'editar' ? nombre : undefined)) return err(409, 'err_puesto_ocupado');
      if (d.modelo !== undefined && !MODELOS.includes(d.modelo)) return err(400, 'err_modelo');
      if (d.descripcion !== undefined && (typeof d.descripcion !== 'string' || d.descripcion.length > 200)) return err(400, 'err_desc');
      if (d.color !== undefined && !(typeof d.color === 'string' && /^#[0-9a-fA-F]{6}$/.test(d.color))) return err(400, 'err_color');
      if (d.contexto !== undefined && (typeof d.contexto !== 'string' || d.contexto.length > MAX_CONTEXTO)) return err(400, 'err_contexto');
      if (d.accion === 'crear') {
        if (!/^[a-z0-9][a-z0-9-]{1,30}$/.test(nombre)) return err(400, 'err_nombre');
        if (k >= 0) return err(409, 'err_nombre_ya');
        const c = validarCarpeta(d.carpeta, home);
        if ('error' in c) return err(400, c.error);
        if (!puesto) return err(400, 'err_puesto');
        crudo.agentes.push({ nombre, carpeta: c.ruta, color: d.color ?? '#a98bff', modelo: d.modelo ?? 'sonnet', descripcion: (d.descripcion ?? '').trim(), puesto, ...(d.contexto?.trim() ? { contexto: d.contexto.trim() } : {}) });
      } else if (d.accion === 'editar' || d.accion === 'quitar') {
        if (k < 0) return err(404, 'err_agente_no');
        if (d.accion === 'quitar') {
          await sesiones.get(nombre)?.cerrar();
          sesiones.delete(nombre); logs.delete(nombre); permisos.cancelarDe(nombre, tx('perm_sesion_cerrada'));
          crudo.agentes.splice(k, 1);
        } else {
          const a = crudo.agentes[k];
          if (d.descripcion !== undefined) a.descripcion = d.descripcion.trim();
          if (d.color !== undefined) a.color = d.color;
          if (d.modelo !== undefined) a.modelo = d.modelo;
          if (puesto) a.puesto = puesto;
          if (d.contexto !== undefined) { if (d.contexto.trim()) a.contexto = d.contexto.trim(); else delete a.contexto; }
        }
      } else return err(400, 'err_comando');
      try { recargar(); } catch (e) { crudo = JSON.parse(antes); return responderTexto(res, 400, (e as Error).message); }
      guardarAtomico(destino, crudo);
      cambio();
      res.writeHead(200, { 'Content-Type': 'application/json' }).end('{"ok":true}');
    });
  }

  // POST /zonas {accion: crear|editar|quitar, indice, nombre, color, patron, contexto}: las zonas de la oficina.
  // Quitar solo si nadie del equipo tiene escritorio ahí; los índices de las zonas siguientes se corren.
  function zonas(req: IncomingMessage, res: ServerResponse) {
    if (!origenValido(req.headers.origin, puerto) || !tokenValido(req.headers['x-token'], token)) return prohibido(res);
    let cuerpo = '';
    req.setEncoding('utf8');
    req.on('data', (x: string) => { cuerpo += x; if (cuerpo.length > 16384) req.destroy(); });
    req.on('end', () => {
      let d: any;
      try { d = JSON.parse(cuerpo); } catch { return responderTexto(res, 400, tx('http_json')); }
      const err = (code: number, k: string, p?: Record<string, unknown>) => responderTexto(res, code, tx(k, p));
      crudo.oficina ??= {};
      if (!Array.isArray(crudo.oficina.zonas) || !crudo.oficina.zonas.length) crudo.oficina.zonas = config.oficina.zonas.map(z => ({ ...z }));
      const zs: any[] = crudo.oficina.zonas, antes = JSON.stringify(crudo), k = d?.indice;
      if (d.nombre !== undefined && (typeof d.nombre !== 'string' || !d.nombre.trim() || d.nombre.trim().length > 20)) return err(400, 'err_zona_nombre');
      if (d.color !== undefined && !PALETA.includes(d.color)) return err(400, 'err_zona_color');
      if (d.patron !== undefined && (typeof d.patron !== 'string' || (d.patron && !patronSeguro(d.patron)))) return err(400, 'err_zona_patron');
      if (d.contexto !== undefined && (typeof d.contexto !== 'string' || d.contexto.length > MAX_CONTEXTO)) return err(400, 'err_contexto');
      const campos = (z: any) => {
        if (d.nombre !== undefined) z.nombre = d.nombre.trim();
        if (d.color !== undefined) z.color = d.color;
        for (const c of ['patron', 'contexto']) if (d[c] !== undefined) { if (d[c].trim()) z[c] = d[c].trim(); else delete z[c]; }
        return z;
      };
      if (d.accion === 'crear') {
        if (zs.length >= MAX_ZONAS) return err(400, 'err_zona_max', { n: MAX_ZONAS });
        if (d.nombre === undefined) return err(400, 'err_zona_nombre');
        zs.push(campos({}));
      } else if (d.accion === 'editar' || d.accion === 'quitar') {
        if (!Number.isInteger(k) || k < 0 || k >= zs.length) return err(404, 'err_zona_no');
        if (d.accion === 'editar') campos(zs[k]);
        else {
          const ahi = config.agentes.filter(a => a.puesto?.zona === k).map(a => a.nombre);
          if (ahi.length) return err(409, 'err_zona_ocupada', { a: ahi.join(', ') });
          if (zs.length === 1) return err(400, 'err_zona_ultima');
          zs.splice(k, 1);
          for (const a of crudo.agentes) { // los índices de zona de los demás se corren
            if (a.puesto?.zona > k) a.puesto.zona--;
            if (a.zona === k) delete a.zona; else if (a.zona > k) a.zona--;
          }
        }
      } else return err(400, 'err_comando');
      try { recargar(); } catch (e) { crudo = JSON.parse(antes); return responderTexto(res, 400, (e as Error).message); }
      guardarAtomico(destino, crudo);
      difundir({ t: 'config', oficina: config.oficina });
      cambio();
      res.writeHead(200, { 'Content-Type': 'application/json' }).end('{"ok":true}');
    });
  }

  // POST /subir: cabeceras X-Chat (agente o _director) y X-Nombre (nombre original, codificado).
  function subir(req: IncomingMessage, res: ServerResponse) {
    if (!origenValido(req.headers.origin, puerto) || !tokenValido(req.headers['x-token'], token)) return prohibido(res);
    const chat = String(req.headers['x-chat'] ?? '');
    let nombre = 'archivo';
    try { nombre = nombreSeguro(decodeURIComponent(String(req.headers['x-nombre'] ?? 'archivo'))); } catch { /* nombre por defecto */ }
    if (!porNombre.has(chat) && !(chat === DIR && director)) return responderTexto(res, 400, tx('err_roster'));
    const largo = Number(req.headers['content-length'] ?? NaN);
    const grande = () => responderTexto(res, 413, tx('http_grande', { mb: MAX_ADJUNTO / 1048576 }));
    if (!(largo > 0) || largo > MAX_ADJUNTO) { grande(); return req.destroy(); }
    const partes: Buffer[] = [];
    let n = 0;
    req.on('data', (b: Buffer) => { n += b.length; if (n > MAX_ADJUNTO) { grande(); req.destroy(); } else partes.push(b); });
    req.on('end', () => {
      if (res.headersSent) return;
      const b = Buffer.concat(partes), c = clasificar(nombre, b);
      if (!c) return responderTexto(res, 415, tx('http_tipo'));
      if (c === 'contenido') return responderTexto(res, 415, tx('http_contenido'));
      if (c.clase === 'imagen' && b.length > MAX_IMAGEN) return responderTexto(res, 413, tx('http_grande', { mb: MAX_IMAGEN / 1048576 }));
      const dir = join(dirSubidas, chat), id = `${randomBytes(8).toString('hex')}_${nombre}`;
      mkdirSync(dir, { recursive: true, mode: 0o700 });
      writeFileSync(join(dir, id), b, { mode: 0o600 });
      res.writeHead(200, { 'Content-Type': 'application/json' }).end(JSON.stringify({ id, nombre, clase: c.clase, tam: b.length }));
    });
  }

  // GET /archivo y /vista: solo con firma válida para esa ruta, dentro de las raíces del alcance, hasta 25 MB.
  // /vista sirve HTML en un sandbox (CSP sandbox allow-scripts, sin allow-same-origin): no puede tocar la oficina.
  function servirArchivo(req: IncomingMessage, res: ServerResponse, u: URL, vista: boolean) {
    const a = u.searchParams.get('a') ?? '', r = u.searchParams.get('r') ?? '', k = u.searchParams.get('k') ?? '';
    if (!tokenValido(k, firmar(token, a, r))) return prohibido(res);
    const real = dentroDe(r, raices(a));
    if (!real || real !== r) return responderTexto(res, 404, tx('http_no_existe'));
    const tam = statSync(real).size;
    if (tam > MAX_ADJUNTO) return responderTexto(res, 413, tx('http_grande', { mb: MAX_ADJUNTO / 1048576 }));
    const ext = extname(real).slice(1).toLowerCase(), html = ext === 'html' || ext === 'htm';
    if (vista && !html) return responderTexto(res, 404, tx('http_no_existe'));
    const cab: Record<string, string> = { 'X-Content-Type-Options': 'nosniff', 'Cache-Control': 'no-store', 'Referrer-Policy': 'no-referrer' };
    if (vista) {
      cab['Content-Type'] = 'text/html; charset=utf-8';
      cab['Content-Security-Policy'] = "sandbox allow-scripts; default-src 'none'; script-src 'unsafe-inline' data:; style-src 'unsafe-inline' data:; img-src data: blob:; font-src data:; media-src data: blob:; frame-ancestors 'self'";
    } else {
      cab['Content-Type'] = TIPOS[ext] ?? (TEXTO.has(ext) || ext === 'svg' ? 'text/plain; charset=utf-8' : 'application/octet-stream');
      if (ext !== 'pdf') cab['Content-Security-Policy'] = "sandbox; default-src 'none'; img-src 'self'; style-src 'unsafe-inline'; frame-ancestors 'self'";
      else cab['Content-Security-Policy'] = "frame-ancestors 'self'";
      cab['Content-Disposition'] = `${u.searchParams.get('d') === '1' ? 'attachment' : 'inline'}; filename*=UTF-8''${encodeURIComponent(basename(real))}`;
    }
    res.writeHead(200, cab).end(readFileSync(real));
  }

  const cabeceras = {
    'Content-Security-Policy': `default-src 'none'; script-src 'self'; style-src 'self'; img-src 'self' blob:; font-src 'self'; frame-src 'self'; connect-src 'self' ws://127.0.0.1:${puerto} ws://localhost:${puerto}; base-uri 'none'; form-action 'none'; frame-ancestors 'none'`,
    'X-Content-Type-Options': 'nosniff', 'Referrer-Policy': 'no-referrer', 'Cache-Control': 'no-store', 'X-Frame-Options': 'DENY',
  };
  // Lo que la página necesita saber de la configuración (sin rutas de agentes).
  const publico = () => JSON.stringify({
    titulo: config.titulo, idioma: config.idioma, demo: !!o.demo, oficina: config.oficina, paleta: PALETA,
    director: director ? { nombre: director.nombre, color: director.color } : null,
  }).replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;');

  const server = createServer((req, res) => {
    if (!hostValido(req.headers.host, puerto)) return prohibido(res);
    const u = new URL(req.url ?? '/', 'http://x'), ruta = u.pathname;
    if (req.method === 'GET' && (ruta === '/archivo' || ruta === '/vista')) return servirArchivo(req, res, u, ruta === '/vista');
    for (const [k, v] of Object.entries(cabeceras)) res.setHeader(k, v);
    if (req.method === 'POST' && ruta === '/subir') return subir(req, res);
    if (req.method === 'POST' && ruta === '/preguntas') return responder(req, res);
    if (req.method === 'POST' && ruta === '/agentes') return equipo(req, res);
    if (req.method === 'POST' && ruta === '/zonas') return zonas(req, res);
    if (req.method !== 'GET') return responderTexto(res, 405, 'no');
    if (ruta === '/') {
      const titulo = (config.titulo || tx('titulo_def')).replace(/[<>&"]/g, '');
      const html = readFileSync(join(RAIZ, 'public', 'index.html'), 'utf8').replace('__TOKEN__', token).replace('__CONFIG__', () => publico()).replace(/__TITULO__/g, titulo).replace('__LANG__', l);
      return res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' }).end(html);
    }
    const e = ESTATICOS[ruta];
    if (e) return res.writeHead(200, { 'Content-Type': e[1] }).end(readFileSync(join(RAIZ, e[0])));
    responderTexto(res, 404, tx('http_no_existe'));
  });

  const wss = new WebSocketServer({ noServer: true, maxPayload: 256 * 1024 });
  server.on('upgrade', (req, sock, head) => {
    const u = new URL(req.url ?? '/', 'http://x');
    if (u.pathname !== '/ws' || !hostValido(req.headers.host, puerto) || !origenValido(req.headers.origin, puerto) || !tokenValido(u.searchParams.get('t'), token)) {
      sock.end('HTTP/1.1 403 Forbidden\r\n\r\n');
      return;
    }
    wss.handleUpgrade(req, sock, head, ws => {
      clientes.add(ws);
      ws.on('close', () => clientes.delete(ws));
      ws.on('message', async raw => {
        let d: Record<string, unknown> = {};
        try {
          d = JSON.parse(String(raw));
          await comando(ws, d);
        } catch (e) {
          enviarA(ws, { t: 'error', agente: d?.agente, s: recortar(String((e as Error)?.message ?? e), 500) });
        }
      });
      enviarA(ws, msgEstado());
      enviarA(ws, msgOficina());
    });
  });

  return {
    server, token, puerto, config, enlace, rutaConfig: () => destino, contextoDe,
    escuchar: () => new Promise<void>(r => server.listen(puerto, '127.0.0.1', r)),
    async cerrar() {
      clearInterval(vigia);
      await Promise.all([...sesiones.values()].map(s => s.cerrar()));
      for (const ws of clientes) ws.terminate();
      await new Promise(r => server.close(r));
    },
  };
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  let app: ReturnType<typeof crear>;
  const i = process.argv.indexOf('--config');
  try { app = crear({ demo: process.argv.includes('--demo'), rutaConfig: i > 0 ? process.argv[i + 1] : undefined }); } catch (e) { console.error('Error de configuración:', (e as Error).message); process.exit(1); }
  await app.escuchar();
  console.log(`${app.config.titulo || 'AgentHive'}: http://127.0.0.1:${app.puerto}${process.argv.includes('--demo') ? '  (demo)' : ''}  (Ctrl+C)`);
  const salir = async () => { await app.cerrar(); process.exit(0); };
  process.on('SIGINT', salir);
  process.on('SIGTERM', salir);
}
