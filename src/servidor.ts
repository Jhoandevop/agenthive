// Oficina de agentes: servidor local (solo 127.0.0.1) que lanza agentes con el Agent SDK y habla con la web.
import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import { readFileSync, mkdirSync, rmSync, writeFileSync, copyFileSync, existsSync, statSync, renameSync } from 'node:fs';
import { join, dirname, basename, extname, isAbsolute, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { homedir, tmpdir } from 'node:os';
import { randomBytes } from 'node:crypto';
import { WebSocketServer, type WebSocket } from 'ws';
import { query as sdkQuery, listSessions, getSessionMessages, type EffortLevel } from '@anthropic-ai/claude-agent-sdk';
import { cargarConfig, validar, patronARegex, patronSeguro, MAX_PUESTO, MAX_ZONAS, MAX_CONTEXTO, PALETA, MODOS, UUID_RE, type Config, type Agente, type Modo } from './config.ts';
import { asignarPuestos, puestoLibre, validarCarpeta, guardarAtomico } from './equipo.ts';
import { sesionesEnTerminal, descendienteDe } from './agentes.ts';
import { agregarBuzon, preguntas, responderPregunta, hiloDirector } from './tablero.ts';
import { SesionCodex, detectarCodex, listarRolloutsCodex, type SpawnCodex } from './codex.ts';
import { cupoDeEvento as parsearCupoEvento, cupoDeUsage, cupoDeError } from './cupo.ts';
import { unirSesiones, propietario } from './sesiones.ts';
import { rutaReglas, reglasProyecto } from './reglas.ts';
import { Estado, tapar } from './estado.ts';
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
  '/hormiga.js': ['public/hormiga.js', 'text/javascript; charset=utf-8'],
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
  listarTodas?: () => Promise<{ sessionId: string; customTitle?: string; summary: string; firstPrompt?: string; lastModified: number; cwd?: string }[]>;
  spawnCodex?: SpawnCodex;
  detectarCodex?: () => ReturnType<typeof detectarCodex>;
  listarCodex?: () => ReturnType<typeof listarRolloutsCodex>;
  cupoClaude?: boolean; // consultar el uso del plan (5 h / semana); por defecto solo con el SDK real
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
    if (director && nuevo.director) Object.assign(director, nuevo.director);
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
  const listarTodas = o.listarTodas ?? (o.demo ? async () => [] : () => listSessions({ limit: 80 }));
  const generador = o.generador ?? (o.demo ? estadoDemo() : (() => {
    const e = new Estado({ home, memoria: join(tmp, 'vistos.json'), esDirector: n => !!dirRe?.test(n), nombreDirector: director?.nombre, codex: config.codex, idioma: l });
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
    if (ev.error && porNombre.get(agente)?.motor !== 'codex') { const dato = cupoDeError(ev.s ?? ev.error); if (dato) anotarCupo(dato); }
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
  const sesiones = new Map<string, Sesion | SesionCodex>();
  const sesion = (a: Agente) => {
    let s = sesiones.get(a.nombre);
    // El director lanzado desde la web se titula según su patrón ("lead-*" → "lead-web") para reconocerlo como director.
    if (!s) {
      s = a.motor === 'codex' ? new SesionCodex(a, { emitir, cambio, spawn: o.spawnCodex }, l) : new Sesion(a, { query: o.query ?? (o.demo ? queryDemo : (sdkQuery as unknown as FnQuery)), permisos, emitir, cambio, cupo: i => cupoDeEvento(i) }, l, a.nombre === DIR ? director!.patronSesion.replace(/\*/g, 'web').replace(/\?/g, 'x') : undefined);
      sesiones.set(a.nombre, s);
    }
    return s;
  };

  const leerCodex = o.detectarCodex ?? (o.demo || o.generador ? () => [] : () => detectarCodex({ home }));
  const listarCX = o.listarCodex ?? (o.demo ? () => [] : () => listarRolloutsCodex(home));
  let codexActual = leerCodex();
  const leerTerminales = () => [
    ...sesionesEnTerminal(dirSesiones).map(t => ({ ...t, motor: 'claude' as const })),
    ...codexActual.filter(x => 'pid' in x && x.pid && ![...sesiones.values()].some(s => s instanceof SesionCodex && (s.pid === x.pid || (!!s.pid && descendienteDe(Number(x.pid), s.pid))))).map(x => ({ pid: 'pid' in x ? x.pid : 0, nombre: x.nombre, cwd: x.cwd, estado: x.estado, sessionId: x.sesionId, inicio: x.inicio, motor: 'codex' as const })),
  ];
  let terminal = leerTerminales();
  // En terminal: por nombre, o por la sesión fijada (adoptada) del agente. El director: por su patrón.
  const enTerminal = (a: Agente) => terminal.find(t => propietario({ ...t, sesionId: t.sessionId, tipo: t.motor }, roster, [], director?.patronSesion) === a.nombre);
  const modoDe = (a: Agente): Modo => (a.nombre === DIR ? director?.modoPermisos : a.modoPermisos) ?? 'default';
  function estado() {
    const filas = roster.map(a => {
      const s = sesiones.get(a.nombre), t = enTerminal(a);
      return {
        nombre: a.nombre, motor: a.motor ?? 'claude', carpeta: a.carpeta, color: a.color, descripcion: a.descripcion, modeloDefecto: a.modelo, zona: a.zona, puesto: a.puesto, contexto: a.contexto,
        estado: t ? 'terminal' : s?.viva ? s.estado : 'libre', terminalEstado: t?.estado, terminalNombre: t?.nombre,
        sesionId: s?.sessionId, sesionFija: a.sesion, modelo: s?.modelo, esfuerzo: s?.esfuerzo, modo: s?.viva ? s.modo : modoDe(a),
        reglasWeb: a.reglasWeb ?? [], reglasSesion: s?.viva ? s.reglasSesion : [], permisos: permisos.pendientesDe(a.nombre).length,
      };
    });
    if (director) {
      // Un solo escritorio de director aunque haya varias sesiones: manda la de la terminal; si no, la de la web.
      // «×N» y la lista de todas van en `directores` (la pastilla de la oficina las muestra).
      const s = sesiones.get(DIR), ts = terminal.filter(x => dirRe!.test(x.nombre)), t = ts[0];
      const directores = [...ts.map(x => ({ nombre: x.nombre, donde: 'terminal', estado: x.estado })), ...(s?.viva ? [{ nombre: director.nombre, donde: 'web', estado: s.estado }] : [])];
      filas.push({
        nombre: DIR, director: true, mostrar: director.nombre, lanzable: !!agDir, carpeta: director.carpeta ?? '', color: director.color, descripcion: '', modeloDefecto: director.modelo, zona: undefined,
        estado: s?.viva ? s.estado : t ? 'terminal' : 'libre', terminalEstado: t?.estado, web: !!s?.viva, directores,
        sesionId: s?.sessionId, modelo: s?.modelo, esfuerzo: s?.esfuerzo, modo: s?.viva ? s.modo : modoDe(agDir ?? ({ nombre: DIR } as Agente)),
        reglasWeb: director.reglasWeb ?? [], reglasSesion: s?.viva ? s.reglasSesion : [], permisos: permisos.pendientesDe(DIR).length,
      } as any);
    }
    return filas;
  }
  const msgEstado = () => ({ t: 'estado', agentes: estado(), pendientes: permisos.todas() });
  function cambio() { difundir(msgEstado()); }

  // La oficina (generador), las preguntas y el hilo con el director: se empujan cuando cambian.
  let oficina: unknown = null, ultimaOficina = '';
  // Cada sesión que es de un agente (lanzada desde aquí, o adoptada) se une a SU escritorio: nunca toma otro asiento.
  // La del director va solo a Dirección. Una hija de este proceso sin dueño conocido todavía no se muestra.
  function unirPropias(e: any) {
    if (!e || !Array.isArray(e.agentes)) return e;
    return unirSesiones(e, roster, [...sesiones].filter(([, x]) => x.viva).map(([nombre, x]) => ({ nombre, sessionId: x.sessionId, pid: x instanceof SesionCodex ? x.pid : undefined })), director?.patronSesion);
  }
  const refrescarOficina = () => { try { codexActual = leerCodex(); const e: any = generador(); oficina = unirPropias(e && typeof e === 'object' ? { ...e, agentes: [...(e.agentes ?? []), ...codexActual] } : e); } catch (e) { console.error('generador:', (e as Error).message); } };
  refrescarOficina();
  const hilo = () => !director ? [] : hiloDirector(dirCoord, director.nombre).map(m => ({
    ...m, imagenes: (m as any).imagenes?.map((r: string) => enlace('_', r)?.url).filter(Boolean),
  }));
  const conCupo = (e: any) => (e && typeof e === 'object' && cupoClaude ? { ...e, cupo: { ...(e.cupo ?? {}), claude: cupoClaude } } : e);
  const msgOficina = () => ({ t: 'oficina', estado: conCupo(oficina), preguntas: director ? preguntas(dirCoord, director.nombre) : { pendientes: [], respondidas: [] }, hilo: hilo() });
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
    const n = leerTerminales();
    if (JSON.stringify(n) !== JSON.stringify(terminal)) { terminal = n; cambio(); }
  }, 1500);

  async function sesionesDe(a: Agente) {
    const vivas = new Set(terminal.map(t => t.sessionId));
    const lista = a.motor === 'codex' ? listarCX().filter(s => s.cwd === a.carpeta).map(s => ({ ...s, summary: s.pedido, firstPrompt: '', customTitle: a.sesion === s.sessionId ? a.nombre : undefined })) : await listar(a.carpeta);
    return lista.filter(s => !s.cwd || s.cwd === a.carpeta).map(s => ({
      id: s.sessionId, titulo: recortar(s.customTitle || s.summary || s.firstPrompt || '—', 120), fecha: s.lastModified,
      propia: a.nombre === DIR ? !!dirRe?.test(s.customTitle ?? '') : s.customTitle === a.nombre, enTerminal: vivas.has(s.sessionId),
    }));
  }

  // Solo agentes del roster (o el director configurado), solo en su carpeta, nunca una sesión viva en terminal.
  async function lanzar(a: Agente, d: Record<string, unknown>) {
    if (d.modo !== undefined && !MODOS.includes(d.modo as Modo)) throw new Error(tx('err_modo'));
    if (enTerminal(a)) throw new Error(tx('err_terminal'));
    if (!existsSync(a.carpeta) || !statSync(a.carpeta).isDirectory()) throw new Error(tx('err_carpeta'));
    const modelo = typeof d.modelo === 'string' && (a.motor === 'codex' ? /^[a-zA-Z0-9._-]{1,80}$/.test(d.modelo) : MODELOS.includes(d.modelo)) ? d.modelo : a.modelo;
    const esfuerzo = ESFUERZOS.includes(d.esfuerzo as EffortLevel) ? (d.esfuerzo as EffortLevel) : undefined;
    const lista = (await sesionesDe(a)).sort((x, y) => y.fecha - x.fecha);
    let resume: string | undefined;
    // El director retoma su última sesión con nombre de director; si no hay, la última de la carpeta.
    // «Llamar»: la sesión fijada (adoptada) si existe y no está en una terminal; si no, la última suya (el director: la última de la carpeta).
    const fija = a.sesion ? lista.find(x => x.id === a.sesion && !x.enTerminal) : undefined;
    if (d.sesion === 'ultima' && a.sesion && !fija) throw new Error(tx('err_sesion_carpeta'));
    if (d.sesion === 'ultima') resume = fija?.id ?? (lista.find(s => s.propia && !s.enTerminal) ?? (a.nombre === DIR ? lista.find(s => !s.enTerminal) : undefined))?.id;
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
      const msgs = resume && !o.demo && a.motor !== 'codex' ? await getSessionMessages(resume, { dir: a.carpeta }).catch(() => []) : [];
      const evs = msgs.filter(m => !m.parent_tool_use_id).slice(-60).flatMap(m => deMensaje(m.type, m.message, true));
      logs.set(a.nombre, evs.map(e => ({ ...e, viejo: true })));
      difundir({ t: 'log', agente: a.nombre, eventos: logs.get(a.nombre), permisos: [] });
    }
    const modo: Modo = MODOS.includes(d.modo as Modo) ? (d.modo as Modo) : d.plan === true ? 'plan' : modoDe(a);
    await s.lanzar({ resume, modelo, esfuerzo, modo, contexto: contextoDe(a) });
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
    if (d.t === 'adoptables' && !d.agente) return enviarA(ws, { t: 'adoptables', agente: '', ...(await adoptables(null, Number(d.desde) || 0)) });
    if (d.t === 'buzon') { // a un agente del roster o a una sesión viva en terminal; el director revisa y entrega
      let to = typeof d.agente === 'string' ? d.agente : '';
      const texto = typeof d.texto === 'string' ? d.texto.trim() : '';
      const ra = porNombre.get(to);
      if (ra && to !== DIR) to = enTerminal(ra)?.nombre ?? to; // una sesión adoptada recibe a su nombre de terminal
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
        if (!s?.viva) await lanzar(a, { sesion: 'ultima', modelo: d.modelo, esfuerzo: d.esfuerzo, modo: d.modo });
        return sesion(a).enviar(texto, adj);
      }
      case 'permiso': {
        const siempre = d.siempre === 'sesion' || d.siempre === 'proyecto' ? d.siempre : undefined;
        const anteriores = siempre === 'proyecto' ? reglasProyecto(a.carpeta) : [];
        const r = typeof d.id === 'string' ? permisos.decidir(a.nombre, d.id, d.permitir === true, typeof d.mensaje === 'string' ? d.mensaje.slice(0, 2000) : '', respuestasValidas(d.respuestas), siempre) : false;
        if (!r) throw new Error(tx('err_permiso'));
        if (r.siempre === 'sesion' && s) s.reglasSesion = [...new Set([...s.reglasSesion, ...r.reglas])];
        if (r.siempre === 'proyecto') { // se anota para poder listarla y quitarla después (solo las que agregó la web)
          const dst = a.nombre === DIR ? crudo.director : crudo.agentes.find((x: any) => x?.nombre === a.nombre);
          if (dst) { dst.reglasWeb = [...new Set([...(dst.reglasWeb ?? []), ...r.reglas.filter(x => !anteriores.includes(x))])]; recargar(); guardarAtomico(destino, crudo); }
        }
        if (r.siempre) cambio();
        return;
      }
      case 'modo': {
        if (a.motor === 'codex' && !['default', 'plan'].includes(String(d.modo))) throw new Error(tx('err_modo'));
        if (!MODOS.includes(d.modo as Modo)) throw new Error(tx('err_modo'));
        const dst = a.nombre === DIR ? crudo.director : crudo.agentes.find((x: any) => x?.nombre === a.nombre);
        if (s) await s.cambiarModo(d.modo as Modo);
        if (dst) { dst.modoPermisos = d.modo; recargar(); guardarAtomico(destino, crudo); }
        cambio();
        return;
      }
      case 'quitarRegla': return quitarRegla(a, d);
      case 'adoptables': return enviarA(ws, { t: 'adoptables', agente: a.nombre, ...(await adoptables(a, Number(d.desde) || 0)) });
      case 'detener': return s?.detener();
      case 'cerrar': return s?.cerrar();
      case 'plan': return comando(ws, { t: 'modo', agente: a.nombre, modo: d.plan === true ? 'plan' : 'default' });
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

  let colaEquipo = Promise.resolve();
  const enCola = (fn: () => Promise<unknown>) => { colaEquipo = colaEquipo.then(async () => { await fn(); }).catch(e => console.error('equipo:', e.message)); };

  // POST /agentes {accion: crear|editar|quitar, ...}: cambia el equipo fijo en la config (nunca carpetas ni sesiones).
  // El director y los bucles de Codex no se tocan desde aquí. Crear no lanza al agente.
  function equipo(req: IncomingMessage, res: ServerResponse) {
    if (!origenValido(req.headers.origin, puerto) || !tokenValido(req.headers['x-token'], token)) return prohibido(res);
    let cuerpo = '';
    req.setEncoding('utf8');
    req.on('data', (x: string) => { cuerpo += x; if (cuerpo.length > 16384) req.destroy(); });
    req.on('end', () => enCola(async () => {
      try {
      let d: any;
      try { d = JSON.parse(cuerpo); } catch { return responderTexto(res, 400, tx('http_json')); }
      const err = (code: number, k: string) => responderTexto(res, code, tx(k));
      const nombre = typeof d?.nombre === 'string' ? d.nombre : '';
      if (nombre === DIR || nombre.startsWith('_')) return err(400, 'err_no_dir_ui');
      const k = crudo.agentes.findIndex((a: any) => a?.nombre === nombre), antes = JSON.stringify(crudo);
      const puesto = d.puesto === undefined ? undefined : d.puesto;
      if (puesto !== undefined && !(Number.isInteger(puesto?.zona) && Number.isInteger(puesto?.i) && puesto.zona >= 0 && puesto.zona < config.oficina.zonas.length && puesto.i >= 0 && puesto.i <= MAX_PUESTO)) return err(400, 'err_puesto');
      if (puesto && !puestoLibre(config, puesto, d.accion === 'editar' ? nombre : undefined)) return err(409, 'err_puesto_ocupado');
      if (d.modoPermisos !== undefined && !MODOS.includes(d.modoPermisos)) return err(400, 'err_modo');
      const motor = d.motor ?? (k >= 0 ? crudo.agentes[k].motor : undefined) ?? 'claude';
      if (!['claude', 'codex'].includes(motor) || (k >= 0 && motor !== (crudo.agentes[k].motor ?? 'claude'))) return err(400, 'err_modelo');
      if (d.modelo !== undefined && !(motor === 'codex' ? typeof d.modelo === 'string' && /^[a-zA-Z0-9._-]{1,80}$/.test(d.modelo) : MODELOS.includes(d.modelo))) return err(400, 'err_modelo');
      if (d.descripcion !== undefined && (typeof d.descripcion !== 'string' || d.descripcion.length > 200)) return err(400, 'err_desc');
      if (d.color !== undefined && !(typeof d.color === 'string' && /^#[0-9a-fA-F]{6}$/.test(d.color))) return err(400, 'err_color');
      if (d.contexto !== undefined && (typeof d.contexto !== 'string' || d.contexto.length > MAX_CONTEXTO)) return err(400, 'err_contexto');
      let papel: string | undefined;
      if (d.accion === 'deshacer') { // devuelve la entrada quitada o soltada hace menos de 15 s
        const p = typeof d.id === 'string' ? papelera.get(d.id) : undefined;
        if (!p || Date.now() > p.vence) return err(404, 'err_deshacer');

        const j = crudo.agentes.findIndex((a: any) => a?.nombre === p.entrada.nombre);
        if (p.tipo === 'soltar') { if (j < 0) return err(404, 'err_agente_no'); if (p.entrada.sesion && roster.some(a => a.nombre !== p.entrada.nombre && a.sesion === p.entrada.sesion)) return err(409, 'err_sesion_ya'); crudo.agentes[j].sesion = p.entrada.sesion; }
        else {
          if (j >= 0) return err(409, 'err_nombre_ya');
          if (p.entrada.sesion && roster.some(a => a.sesion === p.entrada.sesion)) return err(409, 'err_sesion_ya');
          if (p.entrada.puesto && !puestoLibre(config, p.entrada.puesto)) delete p.entrada.puesto; // su escritorio se ocupó: se le da otro
          crudo.agentes.splice(Math.min(p.indice, crudo.agentes.length), 0, p.entrada);
        }
      } else if (d.accion === 'adoptar') { // una sesión existente (viva o pasada) pasa a ser un agente del equipo
        if (!/^[a-z0-9][a-z0-9-]{1,30}$/.test(nombre)) return err(400, 'err_nombre');
        if (k >= 0) return err(409, 'err_nombre_ya');
        if (typeof d.sesion !== 'string' || !UUID_RE.test(d.sesion)) return err(400, 'err_sesion_no');
        if (dirRe?.test(nombre) || sesiones.get(DIR)?.sessionId === d.sesion) return err(400, 'err_no_dir_ui');
        if (roster.some(a => a.sesion === d.sesion)) return err(409, 'err_sesion_ya');
        const ses = await buscarSesion(d.sesion, undefined, motor);
        if (!ses) return err(404, 'err_sesion_no');
        if (dirRe?.test(ses.nombre ?? '') || roster.some(a => a.nombre === ses.nombre)) return err(400, 'err_no_dir_ui');
        const c = validarCarpeta(ses.cwd, home);
        if ('error' in c) return err(400, c.error);
        if (!puesto) return err(400, 'err_puesto');
        crudo.agentes.push({ nombre, ...(motor === 'codex' ? { motor } : {}), carpeta: c.ruta, sesion: d.sesion, color: d.color ?? '#a98bff', modelo: d.modelo ?? (motor === 'codex' ? 'default' : 'sonnet'), descripcion: (d.descripcion ?? '').trim(), puesto, ...(d.contexto?.trim() ? { contexto: d.contexto.trim() } : {}) });
      } else if (d.accion === 'crear') {
        if (!/^[a-z0-9][a-z0-9-]{1,30}$/.test(nombre)) return err(400, 'err_nombre');
        if (k >= 0) return err(409, 'err_nombre_ya');
        const c = validarCarpeta(d.carpeta, home);
        if ('error' in c) return err(400, c.error);
        if (!puesto) return err(400, 'err_puesto');
        crudo.agentes.push({ nombre, ...(motor === 'codex' ? { motor } : {}), carpeta: c.ruta, color: d.color ?? '#a98bff', modelo: d.modelo ?? (motor === 'codex' ? 'default' : 'sonnet'), descripcion: (d.descripcion ?? '').trim(), puesto, ...(d.contexto?.trim() ? { contexto: d.contexto.trim() } : {}) });
      } else if (d.accion === 'editar' || d.accion === 'quitar') {
        if (k < 0) return err(404, 'err_agente_no');
        if (d.accion === 'quitar') {
          // Solo sale de la config: nunca se borra su carpeta, su conversación ni se cierra una sesión de terminal.
          await sesiones.get(nombre)?.cerrar();
          sesiones.delete(nombre); logs.delete(nombre); permisos.cancelarDe(nombre, tx('perm_sesion_cerrada'));
          papel = alPapelero('quitar', crudo.agentes[k], k);
          crudo.agentes.splice(k, 1);
        } else {
          const a = crudo.agentes[k];
          if (d.sesion === null) { papel = alPapelero('soltar', a, k); delete a.sesion; } // «Solo soltar la sesión»
          else if (d.sesion !== undefined) { // «Cambiar sesión»: otra de SU carpeta
            const ses = typeof d.sesion === 'string' && UUID_RE.test(d.sesion) ? await buscarSesion(d.sesion, a.carpeta, a.motor ?? 'claude') : null;
            if (!ses) return err(404, 'err_sesion_no');
            if (dirRe?.test(ses.nombre ?? '') || sesiones.get(DIR)?.sessionId === d.sesion) return err(400, 'err_no_dir_ui');
            if (roster.some(x => x.nombre !== nombre && x.sesion === d.sesion)) return err(409, 'err_sesion_ya');
            a.sesion = d.sesion;
          }
          if (d.descripcion !== undefined) a.descripcion = d.descripcion.trim();
          if (d.color !== undefined) a.color = d.color;
          if (d.modelo !== undefined) a.modelo = d.modelo;
          if (puesto) a.puesto = puesto;
          if (d.contexto !== undefined) { if (d.contexto.trim()) a.contexto = d.contexto.trim(); else delete a.contexto; }
        }
      } else return err(400, 'err_comando');
      try { recargar(); } catch (e) { crudo = JSON.parse(antes); if (papel) papelera.delete(papel); return responderTexto(res, 400, (e as Error).message); }
      guardarAtomico(destino, crudo);
      if (d.accion === 'deshacer') papelera.delete(d.id);
      refrescarOficina(); revisarOficina(); cambio();
      res.writeHead(200, { 'Content-Type': 'application/json' }).end(JSON.stringify({ ok: true, ...(papel ? { deshacer: papel } : {}) }));
      } catch (e) { responderTexto(res, 400, String((e as Error).message)); }
    }));
  }

  // Papelera de ~15 s para «Deshacer» al quitar un agente o soltar su sesión (guarda la entrada tal cual estaba).
  const papelera = new Map<string, { tipo: 'quitar' | 'soltar'; entrada: any; indice: number; vence: number }>();
  function alPapelero(tipo: 'quitar' | 'soltar', entrada: any, indice: number) {
    const id = randomBytes(6).toString('hex'), ahora = Date.now();
    for (const [i, p] of papelera) if (ahora > p.vence) papelera.delete(i);
    papelera.set(id, { tipo, entrada: JSON.parse(JSON.stringify(entrada)), indice, vence: ahora + 15_000 });
    return id;
  }

  // Busca una sesión por id: viva en una terminal o en el historial de Claude Code (solo metadatos). `carpeta` la restringe.
  async function buscarSesion(id: string, carpeta?: string, motor = 'claude'): Promise<{ cwd: string; nombre?: string } | null> {
    const t = terminal.find(x => x.sessionId === id && x.motor === motor);
    if (t) return !carpeta || t.cwd === carpeta ? { cwd: t.cwd, nombre: t.nombre } : null;
    let l: any[] = [];
    try { l = motor === 'codex' ? listarCX() : carpeta ? await listar(carpeta) : await listarTodas(); } catch { /* sin historial */ }
    const x = l.find(y => y.sessionId === id);
    const cwd = x?.cwd ?? carpeta;
    return x && cwd && (!carpeta || cwd === carpeta) ? { cwd, nombre: x.customTitle } : null;
  }

  // Lo que se puede poner en un escritorio: sesiones vivas fuera del equipo y sesiones pasadas (sin el director ni las ya fijadas).
  // Con agente: solo las de su carpeta («Cambiar sesión»).
  async function adoptables(a: Agente | null, desde: number) {
    const fijas = new Set([...roster.map(x => x.sesion), ...[...sesiones.values()].filter(x => x.viva).map(x => x.sessionId)].filter(Boolean));
    const ok = (cwd: string) => (a ? cwd === a.carpeta : !('error' in validarCarpeta(cwd, home)));
    const vivas = terminal.filter(t => (!a || t.motor === (a.motor ?? 'claude')) && !dirRe?.test(t.nombre) && !porNombre.has(t.nombre) && !fijas.has(t.sessionId) && (!a || t.cwd === a.carpeta))
      .map(t => ({ sesion: t.sessionId, motor: t.motor, nombre: t.nombre, cwd: t.cwd, estado: t.estado, inicio: t.inicio, valida: ok(t.cwd) }));
    const vivasIds = new Set(terminal.map(t => t.sessionId));
    let todas: any[] = [];
    try { todas = a?.motor === 'codex' ? listarCX().filter(x => x.cwd === a.carpeta).map(x => ({ ...x, motor: 'codex', summary: x.pedido })) : (await (a ? listar(a.carpeta) : listarTodas())).map(x => ({ ...x, motor: 'claude' }));
      if (!a) todas.push(...listarCX().map(x => ({ ...x, motor: 'codex', summary: x.pedido }))); } catch { /* sin historial */ }
    const pasadas = todas.filter(x => !vivasIds.has(x.sessionId) && !fijas.has(x.sessionId) && !(dirRe && dirRe.test(x.customTitle ?? '')) && (!a || !x.cwd || x.cwd === a.carpeta))
      .sort((x, y) => y.lastModified - x.lastModified).slice(desde, desde + 30)
      .map(x => ({ sesion: x.sessionId, motor: x.motor, modelo: x.modelo, titulo: tapar(x.customTitle || x.summary || x.firstPrompt || '—', 120), cwd: x.cwd ?? a?.carpeta ?? '', fecha: x.lastModified, valida: ok(x.cwd ?? a?.carpeta ?? '') }));
    return { vivas, pasadas, desde };
  }

  // Quita una regla agregada desde la web. Proyecto: se borra de .claude/settings.local.json de su carpeta (solo esa
  // línea, y solo si la agregó la web). Sesión: vive en el proceso; se quita reiniciando la sesión (retomándola).
  async function quitarRegla(a: Agente, d: Record<string, unknown>) {
    const regla = typeof d.regla === 'string' ? d.regla : '';
    if (d.destino === 'sesion') {
      const s = sesiones.get(a.nombre);
      if (!s?.viva || !s.reglasSesion.includes(regla)) throw new Error(tx('err_regla_no'));
      await s.lanzar({ resume: s.sessionId, modelo: s.modelo, esfuerzo: s.esfuerzo, modo: s.modo, contexto: contextoDe(a) });
      return cambio();
    }
    const lista = (a.nombre === DIR ? director?.reglasWeb : a.reglasWeb) ?? [];
    if (!lista.includes(regla)) throw new Error(tx('err_regla_no'));
    const f = rutaReglas(a.carpeta);
    if (sesiones.get(a.nombre)?.viva) throw new Error('Cierra la sesión web antes de quitar una regla de proyecto');
    try {
      const j = JSON.parse(readFileSync(f, 'utf8')), allow = j?.permissions?.allow;
      if (Array.isArray(allow) && allow.includes(regla)) {
        j.permissions.allow = allow.filter((x: unknown) => x !== regla);
        guardarAtomico(f, j);
      }
    } catch (e) { if (existsSync(f)) throw e; }
    const dst = a.nombre === DIR ? crudo.director : crudo.agentes.find((x: any) => x?.nombre === a.nombre);
    dst.reglasWeb = (dst.reglasWeb ?? []).filter((x: string) => x !== regla);
    recargar(); guardarAtomico(destino, crudo); cambio();
  }

  // ---- Uso del plan de Claude (ventana de 5 h y semanal) ----
  // Fuente real: la misma consulta que usa /usage (API experimental del SDK, sin turno del modelo ni tokens), cada 5 min;
  // entre consultas, los rate_limit_event de las sesiones abiertas. Si nada responde, queda el último dato con su hora.
  let cupoClaude: any = (() => { try { return JSON.parse(readFileSync(join(tmp, 'cupo-claude.json'), 'utf8')); } catch { return null; } })();
  function anotarCupo(c: Record<string, unknown>) {
    cupoClaude = { ...(cupoClaude ?? {}), ...c, visto: Math.floor(Date.now() / 1000) };
    try { writeFileSync(join(tmp, 'cupo-claude.json'), JSON.stringify(cupoClaude)); } catch { /* sin disco */ }
    revisarOficina();
  }
  function cupoDeEvento(i: unknown) { const dato = parsearCupoEvento(i); if (dato) anotarCupo(dato); }
  async function consultarCupo() {
    let suelta: () => void = () => {};
    const nunca = { async *[Symbol.asyncIterator]() { await new Promise<void>(r => (suelta = r)); } };
    const ac = new AbortController(), tope = setTimeout(() => ac.abort(), 30_000);
    try {
      const q: any = sdkQuery({ prompt: nunca as any, options: { cwd: tmp, model: 'haiku', permissionMode: 'default', abortController: ac, canUseTool: async () => ({ behavior: 'deny', message: 'no' }) } });
      const u = await q.usage_EXPERIMENTAL_MAY_CHANGE_DO_NOT_RELY_ON_THIS_API_YET({ skipBehaviors: true });
      const dato = cupoDeUsage(u); if (dato) anotarCupo(dato);
    } catch { /* la API experimental puede cambiar: queda el último dato o los eventos */ }
    finally { clearTimeout(tope); suelta(); ac.abort(); }
  }
  const usarCupo = o.cupoClaude ?? (!o.query && !o.demo);
  const relojCupo = usarCupo ? setInterval(consultarCupo, 5 * 60_000) : null;
  const inicioCupo = usarCupo ? setTimeout(consultarCupo, 2000) : null;

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
    titulo: config.titulo, idioma: config.idioma, demo: !!o.demo, oficina: config.oficina, paleta: PALETA, modos: MODOS,
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
      if (inicioCupo) clearTimeout(inicioCupo);
      if (relojCupo) clearInterval(relojCupo);
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
