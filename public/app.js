// Oficina de agentes (cliente): una sola página. La oficina (oficina.js) y el chat al costado.
// Todo texto que viene de agentes o archivos pasa por render() (escapa) o textContent.
import { render } from './md.js';
import { t as tr } from './i18n.js';
import { iconoAbeja } from './abeja.js';
import { iconoHormiga } from './hormiga.js';
import { aplicar, setPendientes, seleccionar, ganchos, listaAgentes, iniciar, actualizarZonas } from './oficina.js';

const TOKEN = document.querySelector('meta[name=token]').content;
const CFG = JSON.parse(document.querySelector('meta[name=config]').content);
const L = CFG.idioma === 'auto' ? (navigator.language || 'es').toLowerCase().startsWith('es') ? 'es' : 'en' : CFG.idioma;
const t = (k, p) => tr(L, k, p);
const DIRN = CFG.director?.nombre || '', DIRC = CFG.director?.color || '#F2B33D';
const TITULO = CFG.titulo || t('titulo_def');
const $ = id => document.getElementById(id);
const el = (tag, cls, txt) => { const e = document.createElement(tag); if (cls) e.className = cls; if (txt != null) e.textContent = txt; return e; };
const boton = (txt, cls, fn) => { const b = el('button', cls, txt); b.type = 'button'; b.onclick = fn; return b; };
// Lista blanca de adjuntos (el servidor la vuelve a comprobar con los bytes).
const EXT_OK = new Set('png jpg jpeg webp gif pdf docx xlsx pptx zip txt md csv json log yaml yml toml xml ini html htm css scss js mjs cjs ts tsx jsx py rb go rs java kt kts swift c h cpp hpp cs php sh sql dart lua r vue svelte'.split(' '));
const EXT_IMG = new Set(['png', 'jpg', 'jpeg', 'webp', 'gif']);
const ext = n => (n.split('.').pop() || '').toLowerCase();
const tam = n => (n < 1024 ? `${n} B` : n < 1048576 ? `${(n / 1024).toFixed(0)} KB` : `${(n / 1048576).toFixed(1)} MB`);

document.documentElement.lang = L;
document.querySelector('h1').textContent = TITULO;
for (const e of document.querySelectorAll('[data-t]')) e.textContent = t(e.dataset.t);
for (const e of document.querySelectorAll('[data-tt]')) e.title = t(e.dataset.tt);
for (const e of document.querySelectorAll('[data-tp]')) e.placeholder = t(e.dataset.tp);

let ws, roster = [], pendientesTodos = [], oficina = { estado: null, preguntas: { pendientes: [], respondidas: [] }, hilo: [] };
let modo = null, sel = null, infoA = null, adjuntos = [], ultimosLocales = [];
const logs = new Map(), pendientes = new Map(), herrEls = new Map();
const avisar = s => { const x = $('toast'); x.textContent = s; x.style.display = 'block'; clearTimeout(avisar.t); avisar.t = setTimeout(() => (x.style.display = 'none'), 4000); };
const mandar = o => { if (ws?.readyState === 1) ws.send(JSON.stringify(o)); else avisar(t('sin_conexion_corto')); };
const agente = n => roster.find(a => a.nombre === n);
const nombreDe = a => a?.mostrar || a?.nombre || '';
const viva = a => a && (a.estado === 'esperando' || a.estado === 'trabajando');
const ESTADO = e => t('estado_' + e);
const pintarIcono = (e, col, corona = null, codex = false) => { e.textContent = ''; e.append(codex ? iconoHormiga(col) : iconoAbeja(col, corona)); };
const MODOS = CFG.modos || ['default', 'acceptEdits', 'plan', 'auto'];
for (const m of MODOS) $('c-modo').append(Object.assign(el('option', '', t('modo_' + m)), { value: m }));

// ---------- Oficina ----------
iniciar(CFG, L);
function repintarOficina() { aplicar(oficina.estado || {}, roster); setPendientes(oficina.preguntas.pendientes.length); }
ganchos({
  abrir(a) {
    if (a.roster) abrirAgente(a.raw);
    else if (a.dir) viva(agente('_director')) ? abrirAgente('_director') : abrirDirector();
    else abrirInfo(a);
  },
  llamar: n => llamar(n),
  crear: p => abrirMenuPuesto(p),
  adoptar: (a, p) => abrirAdopcion(p, null, a.sesionId),
  quitar: a => abrirQuitar(a.raw),
  crearZona: i => abrirZona('crear', i),
  editarZona: i => abrirZona('editar', i),
});
function llamar(n) {
  const a = agente(n);
  if (a?.estado === 'terminal') return avisar(t('ya_terminal', { n: nombreDe(a) }));
  pedirAvisos();
  mandar({ t: 'lanzar', agente: n, sesion: 'ultima', modelo: a?.modeloDefecto });
  abrirAgente(n);
}

// ---------- Panel lateral: agente, director (buzón) o ficha ----------
function abrirPanel(m, id) {
  modo = m; sel = id; adjuntos = []; $('c-prev').textContent = ''; $('c-coste').textContent = ''; $('c-hist').hidden = true; $('c-res').hidden = true; $('c-reglas').hidden = true; herrEls.clear(); vivoEl = null;
  $('chat').classList.remove('cerrado'); document.body.classList.add('con-chat');
  seleccionar(m === 'agente' ? (id === '_director' ? 'general' : 'r-' + id) : m === 'general' ? 'general' : id);
}
function cerrarPanel() { modo = sel = infoA = null; $('chat').classList.add('cerrado'); document.body.classList.remove('con-chat'); seleccionar(null); }
$('c-x').onclick = cerrarPanel;

function abrirAgente(n) {
  abrirPanel('agente', n); $('c-msgs').textContent = '';
  mandar({ t: 'abrir', agente: n }); pintarCab(); pedirAvisos();
  $('c-texto').placeholder = t('escribele', { n: nombreDe(agente(n)) });
  $('c-texto').focus();
}
function abrirDirector() {
  abrirPanel('general', '_director'); pintarCab(); pintarHilo(true);
  $('c-texto').placeholder = t('escribele_dir', { n: DIRN });
  $('c-texto').focus();
}
function abrirInfo(a) {
  infoA = a; abrirPanel('info', a.id); pintarCab();
  const dl = $('c-info'); dl.textContent = '';
  const filas = a.tipo === 'temp' ? [[t('tipo'), t('temporal_sub')], [t('tarea'), a.tarea], [t('modelo'), a.modelo], [t('contratado_por'), a.padreN]]
    : [[t('tipo'), a.tipo === 'codex' ? t(a.bucle ? 'bucle_codex' : 'sesion_codex') : t('sesion_claude')], [t('carpeta'), a.carpeta], [t('estado'), a.busy ? (a.vuelta || ESTADO('trabajando')) : ESTADO('esperando')], [t('ultimo_pedido'), a.pedido]];
  for (const [k, v] of filas) dl.append(el('dt', '', k), el('dd', '', v || '—'));
  $('c-msgs').textContent = '';
}

function pintarCab() {
  if (!modo) return;
  const g = modo === 'general', inf = modo === 'info', a = modo === 'agente' ? agente(sel) : null, d = agente('_director');
  // Si el director se lanza (o se cierra) mientras su panel está abierto, se cambia de vista sola.
  if (g && viva(d)) return abrirAgente('_director');
  if (a?.director && a.estado !== 'esperando' && a.estado !== 'trabajando' && a.estado !== 'libre') return abrirDirector();
  $('c-barra').hidden = !a || a.estado === 'libre' || a.estado === 'terminal';
  $('c-equipo').hidden = !a || !!a.director;
  $('c-modo-ayuda').hidden = !a;
  pintarContexto(a);
  $('c-info').hidden = !inf;
  $('c-plant').hidden = !a;
  const llamable = (a && a.estado === 'libre') || (g && d?.lanzable && d.estado === 'libre');
  $('c-llamar').hidden = !llamable;
  $('b-llamar-g').textContent = t('llamar_a', { n: g ? DIRN : nombreDe(a) });
  $('c-term').hidden = !(a?.estado === 'terminal' || (inf && infoA.tipo === 'claude'));
  $('c-form').hidden = inf || a?.estado === 'terminal';
  if (g) {
    $('c-nombre').textContent = t('hablar_con', { n: DIRN }); pintarIcono($('c-punto'), DIRC, DIRC);
    $('c-sub').textContent = t('dir_sub', { n: DIRN });
    $('c-estado').textContent = d?.estado === 'terminal' ? ESTADO('terminal') : t('sin_sesion');
  } else if (inf) {
    $('c-nombre').textContent = infoA.nombre; pintarIcono($('c-punto'), infoA.color, null, infoA.tipo === 'codex');
    $('c-sub').textContent = infoA.carpeta || ''; $('c-estado').textContent = infoA.tipo === 'temp' ? ESTADO('temporal') : ESTADO(infoA.busy ? 'trabajando' : 'esperando');
    $('t-aviso').textContent = t('info_aviso');
  } else if (a) {
    $('c-nombre').textContent = nombreDe(a); pintarIcono($('c-punto'), a.color, a.director ? DIRC : null, a.motor === 'codex');
    $('c-sub').textContent = `${a.carpeta}${a.sesionId ? ' · ' + a.sesionId.slice(0, 8) : ''}`; $('c-sub').title = a.descripcion || '';
    $('c-estado').textContent = a.director && viva(a) ? t('en_web') + ' · ' + ESTADO(a.estado) : ESTADO(a.estado);
    $('t-aviso').textContent = t('term_aviso');
    if (document.activeElement !== $('c-modelo')) { const m = a.modelo || a.modeloDefecto; if (![...$('c-modelo').options].some(x => x.value === m)) $('c-modelo').append(Object.assign(el('option', '', m), { value: m })); $('c-modelo').value = m; }
    if (viva(a) && document.activeElement !== $('c-esfuerzo')) $('c-esfuerzo').value = a.esfuerzo || '';
    if (document.activeElement !== $('c-modo')) $('c-modo').value = a.modo || 'default';
    $('c-modo').disabled = false;
    for (const op of $('c-modo').options) op.disabled = a.motor === 'codex' && !['default', 'plan'].includes(op.value);
    $('c-modo-ayuda').textContent = a.motor === 'codex' ? t('codex_limitacion') : t('modo_' + (a.modo || 'default') + '_ayuda');
    if (!$('c-reglas').hidden) pintarReglas(a);
    $('b-aplicar').disabled = !viva(a); $('b-detener').disabled = a.estado !== 'trabajando'; $('b-cerrar').disabled = !viva(a);
    $('b-res').textContent = t('resultados', { n: archivos(sel).length });
  }
}
function opciones() { return { modelo: $('c-modelo').value, esfuerzo: $('c-esfuerzo').value || undefined, modo: $('c-modo').value }; }
$('b-llamar-g').onclick = () => llamar(modo === 'general' ? '_director' : sel);
$('b-nueva').onclick = () => mandar({ t: 'lanzar', agente: sel, sesion: 'nueva', ...opciones() });
$('b-aplicar').onclick = () => mandar({ t: 'lanzar', agente: sel, sesion: agente(sel)?.sesionId, mantener: true, ...opciones() });
$('b-detener').onclick = () => mandar({ t: 'detener', agente: sel });
$('b-cerrar').onclick = () => mandar({ t: 'cerrar', agente: sel });
$('b-hist').onclick = () => { const h = $('c-hist'); h.hidden = !h.hidden; if (!h.hidden) { h.textContent = t('cargando'); mandar({ t: 'historial', agente: sel }); } };
$('b-res').onclick = () => { const r = $('c-res'); r.hidden = !r.hidden; if (!r.hidden) pintarResultados(); };
$('c-modo').onchange = () => mandar({ t: 'modo', agente: sel, modo: $('c-modo').value });
$('b-reglas').onclick = () => { $('c-reglas').hidden = !$('c-reglas').hidden; if (!$('c-reglas').hidden) pintarReglas(agente(sel)); };
function pintarReglas(a) {
  const box = $('c-reglas'); box.textContent = '';
  for (const [destino, reglas] of [['sesion', a?.reglasSesion || []], ['proyecto', a?.reglasWeb || []]]) for (const regla of reglas) {
    const row = el('div', 'fila'); row.append(el('code', '', regla + ' · ' + t('destino_' + destino)), boton(t('quitar'), 'b-sec', () => { if (confirm(t('quitar_regla_conf', { r: regla }))) mandar({ t: 'quitarRegla', agente: a.nombre, destino, regla }); })); box.append(row);
  }
  if (!box.children.length) box.textContent = t('reglas_vacio');
}
$('t-enviar').onclick = () => {
  const x = $('t-texto').value.trim(), to = modo === 'info' ? infoA?.raw : sel;
  if (!x || !to) return;
  mandar({ t: 'buzon', agente: to, texto: x }); $('t-texto').value = '';
};

function pintarHist(lista) {
  const h = $('c-hist'); h.textContent = '';
  if (!lista.length) { h.textContent = t('sin_hist'); return; }
  for (const s of lista) {
    const d = el('div', 'ses'), sp = el('span', '', s.titulo);
    sp.append(el('small', '', `${new Date(s.fecha).toLocaleString(L)}${s.propia ? t('de_este') : ''}${s.enTerminal ? t('abierta_term') : ''}`));
    const b = boton(t('abrir'), 'b-sec', () => { mandar({ t: 'lanzar', agente: sel, sesion: s.id, ...opciones() }); h.hidden = true; });
    b.disabled = s.enTerminal; d.append(sp, b); h.appendChild(d);
  }
}

// ---------- Equipo: crear (desde un escritorio vacío), editar y quitar ----------
let formModo = null, abrirAlLlegar = null, sesionElegida = null;
function opcionesZona() { $('af-zona').textContent = ''; for (const [i, z] of CFG.oficina.zonas.entries()) $('af-zona').append(Object.assign(el('option', '', z.nombre), { value: String(i) })); }
opcionesZona();
// Contexto que recibe el agente al llamarlo: el de su zona y el suyo (plegable en su panel).
function pintarContexto(a) {
  const z = a?.puesto ? CFG.oficina.zonas[a.puesto.zona] : null, box = $('c-ctx-c');
  $('c-ctx').hidden = !a || a.director || (!z?.contexto && !a.contexto);
  if ($('c-ctx').hidden) return;
  $('c-ctx-t').textContent = t('ctx_de_zona', { z: z?.nombre ?? '—' });
  box.textContent = '';
  if (z?.contexto) box.append(z.contexto);
  if (a.contexto) box.append(el('strong', '', t('ctx_propio')), a.contexto);
}
// ---------- Zonas: crear en el lugar libre, editar desde su etiqueta, quitar si está vacía ----------
let zonaModo = null, zonaIdx = -1, zonaColor = null;
function abrirZona(m, i) {
  zonaModo = m; zonaIdx = i; const z = m === 'editar' ? CFG.oficina.zonas[i] : null, pal = CFG.paleta || [];
  zonaColor = z?.color ?? pal[i % pal.length];
  $('zf-titulo').textContent = z ? t('z_editar', { n: z.nombre }) : t('z_crear');
  $('zf-nombre').value = z?.nombre ?? ''; $('zf-patron').value = z?.patron ?? ''; $('zf-ctx').value = z?.contexto ?? '';
  const cs = $('zf-colores'); cs.textContent = '';
  for (const c of pal) { const b = boton('', '', () => { zonaColor = c; for (const x of cs.children) x.setAttribute('aria-pressed', String(x === b)); }); b.style.background = c; b.title = c; b.setAttribute('aria-pressed', String(c === zonaColor)); cs.appendChild(b); }
  $('zf-quitar').hidden = !z; $('zf-error').textContent = ''; $('zona-dlg').showModal(); $('zf-nombre').focus();
}
async function zonaPost(cuerpo) {
  const r = await fetch('/zonas', { method: 'POST', headers: { 'X-Token': TOKEN, 'Content-Type': 'application/json' }, body: JSON.stringify(cuerpo) }).catch(() => null);
  return !r ? t('sin_conexion_corto') : r.ok ? null : await r.text();
}
$('zf-cancelar').onclick = () => $('zona-dlg').close();
$('zona-form').onsubmit = async e => {
  e.preventDefault();
  const err = await zonaPost({ accion: zonaModo, indice: zonaIdx, nombre: $('zf-nombre').value.trim(), color: zonaColor, patron: $('zf-patron').value.trim(), contexto: $('zf-ctx').value.trim() });
  if (err) { $('zf-error').textContent = err; return; }
  $('zona-dlg').close(); avisar(t('zona_guardada'));
};
$('zf-quitar').onclick = async () => {
  const z = CFG.oficina.zonas[zonaIdx];
  if (!z || !confirm(t('confirmar_quitar_zona', { n: z.nombre }))) return;
  const err = await zonaPost({ accion: 'quitar', indice: zonaIdx });
  if (err) { $('zf-error').textContent = err; return; }
  $('zona-dlg').close(); avisar(t('zona_quitada'));
};
function abrirForm(m, d) {
  formModo = m; const a = m === 'editar' ? agente(d.nombre) : null;
  $('af-titulo').textContent = m === 'adoptar' ? t('f_adoptar') : m === 'crear' ? t('f_crear') : t('f_editar', { n: a.nombre });
  $('af-nombre').value = a?.nombre ?? ''; $('af-nombre').disabled = !!a;
  $('af-carpeta').value = a?.carpeta ?? (m === 'adoptar' ? sesionElegida.cwd : ''); $('af-carpeta').disabled = !!a || m === 'adoptar'; $('af-carpeta').placeholder = '~/…';
  $('af-desc').value = a?.descripcion ?? ''; $('af-ctx').value = a?.contexto ?? ''; $('af-modelo').value = a?.modeloDefecto ?? 'sonnet'; $('af-color').value = a?.color ?? '#7aa2f7';
  $('af-motor').value = a?.motor || (m === 'adoptar' ? sesionElegida.motor || 'claude' : 'claude'); $('af-motor').disabled = !!a || m === 'adoptar'; actualizarMotorForm();
  $('af-modelo-codex').value = a?.motor === 'codex' ? a.modeloDefecto : m === 'adoptar' && sesionElegida.motor === 'codex' ? sesionElegida.modelo || '' : '';
  const pu = a?.puesto ?? d; $('af-zona').value = String(pu?.zona ?? 0); $('af-puesto').value = String(pu?.i ?? 0);
  $('af-error').textContent = ''; $('agente-dlg').showModal(); (a ? $('af-desc') : $('af-nombre')).focus();
}
$('af-cancelar').onclick = () => $('agente-dlg').close();
async function equipo(cuerpo) {
  const r = await fetch('/agentes', { method: 'POST', headers: { 'X-Token': TOKEN, 'Content-Type': 'application/json' }, body: JSON.stringify(cuerpo) });
  if (!r.ok) return await r.text();
  const datos = await r.json(); if (datos.deshacer) avisoDeshacer(datos.deshacer, cuerpo.accion === 'quitar' ? t('agente_quitado', { n: cuerpo.nombre }) : t('sesion_soltada'));
  return null;
}
$('agente-form').onsubmit = async e => {
  e.preventDefault();
  const nombre = $('af-nombre').value.trim(), puesto = { zona: Number($('af-zona').value), i: Number($('af-puesto').value) };
  const motor = $('af-motor').value;
  const comun = { nombre, motor, modelo: motor === 'codex' ? $('af-modelo-codex').value.trim() || 'default' : $('af-modelo').value, descripcion: $('af-desc').value.trim(), contexto: $('af-ctx').value.trim(), color: $('af-color').value, puesto };
  const err = await equipo(formModo === 'adoptar' ? { accion: 'adoptar', sesion: sesionElegida.sesion, ...comun } : formModo === 'crear' ? { accion: 'crear', carpeta: $('af-carpeta').value.trim(), ...comun } : { accion: 'editar', ...comun }).catch(() => t('sin_conexion_corto'));
  if (err) { $('af-error').textContent = err; return; }
  $('agente-dlg').close();
  avisar(formModo === 'crear' ? t('agente_creado', { n: nombre }) : t('agente_editado'));
  if (formModo === 'crear' || formModo === 'adoptar') abrirAlLlegar = nombre;
};
$('b-editar').onclick = () => abrirForm('editar', { nombre: sel });
$('b-quitar').onclick = () => abrirQuitar(sel);
$('b-quitar-puesto').onclick = () => abrirQuitar(sel);
$('b-cambiar').onclick = () => abrirAdopcion(null, sel);
$('af-motor').onchange = actualizarMotorForm;
function actualizarMotorForm() {
  const cx = $('af-motor').value === 'codex'; $('af-modelo').hidden = cx; $('af-modelo-codex').hidden = !cx;
}
let puestoAdoptar = null, agenteCambiar = null, filtroAdoptar = null, paginaAdoptar = 0, quitarNombre = null;
function abrirMenuPuesto(p) { puestoAdoptar = p; $('puesto-dlg').showModal(); }
$('pm-crear').onclick = () => { $('puesto-dlg').close(); abrirForm('crear', puestoAdoptar); };
$('pm-adoptar').onclick = () => { $('puesto-dlg').close(); abrirAdopcion(puestoAdoptar); };
$('pm-cerrar').onclick = () => $('puesto-dlg').close();
function abrirAdopcion(p, n = null, filtro = null) {
  puestoAdoptar = p; agenteCambiar = n; filtroAdoptar = filtro; paginaAdoptar = 0;
  $('ad-lista').textContent = t('cargando'); $('adoptar-dlg').showModal(); pedirAdoptables();
}
function pedirAdoptables() { mandar({ t: 'adoptables', ...(agenteCambiar ? { agente: agenteCambiar } : {}), desde: paginaAdoptar }); }
$('ad-cerrar').onclick = () => $('adoptar-dlg').close();
$('ad-mas').onclick = () => { paginaAdoptar += 30; pedirAdoptables(); };
function pintarAdoptables(d) {
  if (!$('adoptar-dlg').open || (d.agente || null) !== agenteCambiar) return;
  const box = $('ad-lista'); box.textContent = ''; let total = 0;
  for (const [clave, lista] of [['adoptar_vivas', d.vivas], ['adoptar_pasadas', d.pasadas]]) {
    const xs = (lista || []).filter(s => !filtroAdoptar || s.sesion === filtroAdoptar);
    if (!xs.length) continue; box.append(el('h4', '', t(clave)));
    for (const s of xs) { total++; const row = el('div', 'ses'); row.append(el('span', '', `${s.motor === 'codex' ? 'CODEX · ' : ''}${s.nombre || s.titulo || s.sesion} · ${s.cwd}`));
      const b = boton(t('elegir'), 'b-sec', async () => {
        if (agenteCambiar) { const err = await equipo({ accion: 'editar', nombre: agenteCambiar, sesion: s.sesion }).catch(() => t('sin_conexion_corto')); if (err) return avisar(err); $('adoptar-dlg').close(); avisar(t('agente_editado')); }
        else { sesionElegida = s; $('adoptar-dlg').close(); abrirForm('adoptar', puestoAdoptar); }
      }); b.disabled = !s.valida; if (!s.valida) b.title = t('no_valida'); row.append(b); box.append(row);
    }
  }
  if (!total) box.textContent = t('adoptar_vacio');
  $('ad-mas').hidden = !!filtroAdoptar || (d.pasadas || []).length < 30;
}
function abrirQuitar(n) {
  const a = agente(n); if (!a || a.director) return;
  quitarNombre = n; $('qd-texto').textContent = t('confirmar_quitar_fija', { n });
  $('qd-soltar').disabled = !a.sesionFija; $('quitar-dlg').showModal();
}
$('qd-cancelar').onclick = () => $('quitar-dlg').close();
async function quitarPuesto(soltar) {
  const n = quitarNombre; if (!n) return;
  const err = await equipo(soltar ? { accion: 'editar', nombre: n, sesion: null } : { accion: 'quitar', nombre: n }).catch(() => t('sin_conexion_corto'));
  if (err) return avisar(t('no_guardado', { e: err }));
  $('quitar-dlg').close(); if (!soltar) cerrarPanel();
}
$('qd-equipo').onclick = () => quitarPuesto(false);
$('qd-soltar').onclick = () => quitarPuesto(true);
function avisoDeshacer(id, texto) {
  const box = $('toast-deshacer'); $('td-texto').textContent = texto; box.hidden = false;
  clearTimeout(avisoDeshacer.timer); avisoDeshacer.timer = setTimeout(() => { box.hidden = true; }, 10000);
  $('td-boton').onclick = async () => { const err = await equipo({ accion: 'deshacer', id }).catch(() => t('sin_conexion_corto')); if (err) return avisar(err); box.hidden = true; };
}

// ---------- Resultados: archivos que el agente creó o editó ----------
function archivos(n) {
  const vistos = new Map();
  for (const ev of logs.get(n) || []) if (ev.k === 'archivo' && typeof ev.url === 'string' && ev.url.startsWith('/archivo?')) vistos.set(ev.url, ev);
  return [...vistos.values()].reverse();
}
function pintarResultados() {
  const box = $('c-res'); box.textContent = '';
  const xs = archivos(sel);
  if (!xs.length) { box.textContent = t('sin_resultados'); return; }
  for (const f of xs) {
    const b = boton('', 'arch', () => abrirVista(f));
    b.append(el('strong', '', f.nombre), el('small', '', ` ${f.herramienta || ''} · ${tam(f.tam || 0)}`));
    box.appendChild(b);
  }
}
async function abrirVista(f) {
  const c = $('v-cuerpo'); c.textContent = '';
  $('v-nombre').textContent = f.nombre;
  $('v-abrir').href = f.vista || f.url; $('v-bajar').href = f.url + '&d=1';
  const e = (f.ext || '').toLowerCase();
  if (f.vista) { // HTML: iframe con sandbox sin allow-same-origin; el servidor además manda CSP sandbox.
    const i = el('iframe'); i.setAttribute('sandbox', 'allow-scripts'); i.src = f.vista; i.title = f.nombre; c.appendChild(i);
  } else if (EXT_IMG.has(e) || e === 'svg') { const i = el('img'); i.src = f.url; i.alt = f.nombre; c.appendChild(i); }
  else if (e === 'pdf') { const i = el('iframe'); i.src = f.url; i.title = f.nombre; c.appendChild(i); }
  else {
    try {
      const r = await fetch(f.url), txt = await r.text(), corto = txt.length > 200_000;
      if (corto) c.append(el('div', 'm sis', t('vista_grande')));
      const s = corto ? txt.slice(0, 200_000) : txt;
      if (e === 'md') { const d = el('div', 'md'); d.innerHTML = render(s); c.appendChild(d); }
      else { const pre = el('pre', 'code'); s.split('\n').forEach((ln, i) => pre.append(el('span', 'ln', String(i + 1)), ln + '\n')); c.appendChild(pre); }
    } catch { c.textContent = t('sin_conexion_corto'); }
  }
  $('vista').showModal();
}
$('v-x').onclick = () => $('vista').close();

// ---------- Mensajes del agente ----------
let vivoEl = null;
function pintarLog(n) {
  if (modo !== 'agente' || n !== sel) return;
  const box = $('c-msgs'); box.textContent = ''; herrEls.clear(); vivoEl = null;
  for (const ev of logs.get(n) || []) pintarEv(ev, false);
  pintarPerms(); pintarCab(); box.scrollTop = box.scrollHeight;
}
function pintarEv(ev, enVivo) {
  const box = $('c-msgs'), abajo = box.scrollHeight - box.scrollTop - box.clientHeight < 80, a = agente(sel);
  let n = null;
  switch (ev.k) {
    case 'delta':
      if (!vivoEl) { vivoEl = el('div', 'm ag vivo'); vivoEl.style.setProperty('--c', a?.color); box.appendChild(vivoEl); }
      vivoEl.textContent += ev.s; break;
    case 'texto':
      n = vivoEl || el('div', 'm ag'); vivoEl = null;
      n.classList.remove('vivo'); n.style.setProperty('--c', a?.color); n.innerHTML = render(ev.s); break;
    case 'usuario':
      n = el('div', 'm yo', ev.s);
      if (enVivo && ev.locales?.length) for (const u of ev.locales) { const i = el('img'); i.src = u; i.alt = ''; n.appendChild(i); }
      else if (ev.imgs) n.append(el('div', '', t('imagenes_n', { n: ev.imgs })));
      if (ev.adjuntos?.length) n.append(el('div', 'adjs', '📎 ' + ev.adjuntos.join(', ')));
      break;
    case 'herramienta': {
      n = el('details', 'herr'); const s = el('summary', '', ev.nombre + ' '); s.append(el('small', '', ev.resumen || ''));
      n.append(s, el('pre', '', ev.entrada)); herrEls.set(ev.id, n); break;
    }
    case 'resultado-herr': {
      const d = herrEls.get(ev.id), p = el('pre', 'res' + (ev.error ? ' err' : ''), ev.s || '—');
      if (d) { d.appendChild(p); if (ev.error) d.querySelector('summary').append(el('small', '', ' · error')); } break;
    }
    case 'archivo': {
      n = boton('', 'm arch', () => abrirVista(ev));
      n.append(el('strong', '', '📄 ' + ev.nombre), el('small', '', ` ${ev.herramienta || ''} · ${tam(ev.tam || 0)}`));
      if (modo === 'agente') $('b-res').textContent = t('resultados', { n: archivos(sel).length });
      break;
    }
    case 'artifact': {
      if (!/^https:\/\/claude\.ai\/[A-Za-z0-9/_-]+$/.test(ev.url)) break;
      n = el('div', 'm art'); n.append(el('strong', '', '✨ ' + t('artifact')), el('div', '', ev.url));
      const ab = el('a', 'b-sec', t('artifact_abrir')); ab.href = ev.url; ab.target = '_blank'; ab.rel = 'noopener noreferrer'; n.append(ab); break;
    }
    case 'sistema': n = el('div', 'm sis' + (ev.error ? ' err' : ''), ev.clave ? t(ev.clave) : ev.s); break;
    case 'permiso-fin':
      n = el('div', 'm sis', `${t(ev.como) || ev.como}: ${ev.herramienta}${ev.resumen ? ' · ' + ev.resumen : ''}`); break;
    case 'fin': {
      const seg = ((ev.ms || 0) / 1000).toFixed(1);
      n = el('div', 'm fin', `${ev.detenido ? t('detenido') : ev.error ? t('con_error', { e: ev.error }) : t('listo')} · ${seg} s · US$${(ev.costo || 0).toFixed(4)} · ${(ev.entrada || 0).toLocaleString(L)} → ${(ev.salida || 0).toLocaleString(L)} tokens`);
      $('c-coste').textContent = t('costo_sesion', { c: (ev.total || 0).toFixed(4) });
      vivoEl = null; break;
    }
  }
  if (n) { if (ev.viejo) n.classList.add('viejo'); box.appendChild(n); }
  if (abajo || enVivo) box.scrollTop = box.scrollHeight;
}

// Tarjeta de permiso. AskUserQuestion se responde con opciones y texto libre.
function tarjetaPermiso(p, agenteN) {
  const c = el('div', 'perm'); c.id = 'perm-' + p.id;
  const ask = p.herramienta === 'AskUserQuestion' && p.preguntas?.length;
  c.append(el('h3', '', ask ? t('te_pregunta', { n: nombreDe(agente(agenteN)) }) : t('pide_permiso', { h: p.herramienta })));
  if (!ask) {
    if (p.titulo) c.append(el('div', '', p.titulo));
    if (p.resumen) c.append(el('code', '', p.resumen));
    if (p.motivo) c.append(el('small', '', t('motivo') + p.motivo));
    const det = el('details'); det.append(el('summary', '', t('ver_todo')), el('pre', '', p.entrada)); c.append(det);
  }
  const formas = [];
  if (ask) for (const q of p.preguntas) {
    const box = el('div', 'ask'), elegidas = new Set(), otra = el('input');
    box.append(el('p', '', (q.titulo ? `[${q.titulo}] ` : '') + q.pregunta + (q.multiple ? t('varias') : '')));
    const ops = el('div', 'ops');
    for (const o of q.opciones) {
      const b = boton(o.etiqueta, '', () => {
        if (!q.multiple) { elegidas.clear(); for (const x of ops.children) x.setAttribute('aria-pressed', 'false'); }
        elegidas.has(o.etiqueta) ? elegidas.delete(o.etiqueta) : elegidas.add(o.etiqueta);
        b.setAttribute('aria-pressed', String(elegidas.has(o.etiqueta)));
      });
      b.setAttribute('aria-pressed', 'false'); if (o.detalle) b.append(el('small', '', o.detalle)); ops.appendChild(b);
    }
    otra.placeholder = t('otra_resp'); otra.maxLength = 2000;
    box.append(ops, otra); c.append(box);
    formas.push(() => [q.pregunta, otra.value.trim() || [...elegidas].join(', ')]);
  }
  const msg = el('textarea'); msg.rows = 2; msg.maxLength = 2000; msg.placeholder = t(ask ? 'msg_no_resp' : 'msg_rechazo');
  const fila = el('div', 'fila'), cuenta = el('small');
  const enviar = o => { for (const b of fila.querySelectorAll('button')) b.disabled = true; mandar({ t: 'permiso', agente: agenteN, id: p.id, ...o }); };
  if (ask) fila.append(boton(t('responder'), '', () => {
    const r = Object.fromEntries(formas.map(f => f()).filter(([, v]) => v));
    if (Object.keys(r).length < formas.length) return avisar(t('elige_resp'));
    enviar({ permitir: true, respuestas: r });
  }));
  else {
    fila.append(boton(t('permitir_vez'), '', () => enviar({ permitir: true })));
    if (p.reglas?.length) for (const destino of ['sesion', 'proyecto']) fila.append(boton(t('siempre_' + destino), 'b-sec', () => {
      if (confirm(t('siempre_conf', { r: p.reglas.join('\n'), d: t('destino_' + destino) }))) enviar({ permitir: true, siempre: destino });
    }));
  }
  const no = boton(t(ask ? 'no_responder' : 'rechazar'), 'b-alerta', () => enviar({ permitir: false, mensaje: msg.value.trim() }));
  msg.oninput = () => (no.textContent = msg.value.trim() ? t('rechazar_msg') : t(ask ? 'no_responder' : 'rechazar'));
  const tic = () => { const s = Math.max(0, Math.round((p.vence - Date.now()) / 1000)); cuenta.textContent = t('se_rechaza', { t: `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}` }); };
  tic(); c.tic = tic;
  fila.append(no, cuenta); c.append(msg, fila);
  return c;
}
function pintarPerms() {
  const box = $('c-perms'); box.textContent = '';
  if (modo === 'agente') for (const p of pendientes.get(sel)?.values() || []) box.appendChild(tarjetaPermiso(p, sel));
  if (modo === 'general' || (modo === 'agente' && sel === '_director')) for (const q of oficina.preguntas.pendientes) box.appendChild(tarjetaPregunta(q));
}
setInterval(() => { for (const c of $('c-perms').children) c.tic?.(); }, 1000);

// ---------- Preguntas del director: post-it interactivo y tarjetas en su hilo ----------
async function responderPregunta(id, respuesta, cont) {
  if (!respuesta) return avisar(t('escribe_resp'));
  const todos = cont.querySelectorAll('button,input');
  for (const b of todos) b.disabled = true;
  try {
    const r = await fetch('/preguntas', { method: 'POST', headers: { 'X-Token': TOKEN, 'Content-Type': 'application/json' }, body: JSON.stringify({ id, respuesta }) });
    if (!r.ok) { avisar(t('no_resp', { e: await r.text() })); for (const b of todos) b.disabled = false; return; }
    avisar(t('resp_enviada', { d: DIRN }));
  } catch { avisar(t('sin_conexion_corto')); }
}
function tarjetaPregunta(q) {
  const c = el('div', 'preg'); c.id = 'preg-' + q.id;
  c.append(el('p', '', q.texto));
  if (q.opciones?.length) { const ops = el('div', 'ops'); for (const o of q.opciones) ops.append(boton(o, '', () => responderPregunta(q.id, o, c))); c.append(ops); }
  const libre = el('div', 'libre'), inp = el('input');
  inp.placeholder = t(q.opciones?.length ? 'otra_resp_corta' : 'tu_resp'); inp.maxLength = 1000;
  inp.onkeydown = e => { if (e.key === 'Enter') responderPregunta(q.id, inp.value.trim(), c); };
  libre.append(inp, boton(t('responder'), '', () => responderPregunta(q.id, inp.value.trim(), c)));
  c.append(libre, el('small', '', t('de_quien', { n: q.de }) + (q.ts ? ' · ' + new Date(q.ts).toLocaleTimeString(L, { hour12: false }).slice(0, 5) : '')));
  return c;
}
function pintarPostit() {
  const { pendientes: ps, respondidas: rs } = oficina.preguntas;
  if ($('pend').contains(document.activeElement) && document.activeElement.tagName === 'INPUT') return; // no repintar mientras se escribe
  $('pend').hidden = !ps.length && !rs.length; $('pend').classList.toggle('hay', ps.length > 0); $('pend-t').textContent = t('pendientes_de', { n: ps.length });
  const l = $('pend-l'); l.textContent = '';
  for (const q of ps) l.appendChild(tarjetaPregunta(q));
  if (!ps.length) l.append(el('div', '', t('nada_pendiente')));
  const ul = $('pend-h').querySelector('ul'); ul.textContent = '';
  for (const q of [...rs].reverse()) ul.append(el('li', '', `${q.texto} → ${q.respuesta || ''}`));
  $('pend-h').hidden = !rs.length;
}

// ---------- Hilo con el director (buzón) ----------
function pintarHilo(forzar) {
  if (modo !== 'general') return;
  const box = $('c-msgs'), abajo = forzar || box.scrollHeight - box.scrollTop - box.clientHeight < 80;
  box.textContent = '';
  if (!oficina.hilo.length) box.append(el('div', 'm sis', t('hilo_vacio', { n: DIRN })));
  for (const m of oficina.hilo) {
    let n;
    if (m.de === 'general') { n = el('div', 'm ag gen'); n.innerHTML = render(m.texto); }
    else {
      n = el('div', 'm yo', m.texto);
      for (const u of m.imagenes || []) if (typeof u === 'string' && u.startsWith('/archivo?')) { const i = el('img'); i.src = u; i.alt = ''; n.appendChild(i); }
      if (m.adjuntos?.length) n.append(el('div', 'adjs', '📎 ' + m.adjuntos.join(', ')));
      const est = m.estado ? t('bz_' + m.estado) : '';
      n.append(el('span', 'est', `${est.startsWith('bz_') ? m.estado : est}${m.nota ? ' · ' + m.nota : ''}`));
    }
    box.appendChild(n);
  }
  pintarPerms();
  if (abajo) box.scrollTop = box.scrollHeight;
}

// ---------- Composer: texto, plantillas, adjuntos ----------
for (const [nom, txt] of t('plantillas')) $('c-plant').appendChild(Object.assign(boton(nom, '', () => { $('c-texto').value = txt; $('c-texto').focus(); }), { title: txt }));
async function adjuntar(files) {
  const chat = modo === 'general' ? '_director' : sel;
  if (!chat || modo === 'info') return;
  for (const f of files) {
    const e = ext(f.name), max = EXT_IMG.has(e) ? 10 : 25;
    if (!EXT_OK.has(e)) { avisar(t('tipo_no', { n: f.name })); continue; }
    if (f.size > max * 1048576) { avisar(t('muy_grande', { n: f.name, mb: max })); continue; }
    try {
      const r = await fetch('/subir', { method: 'POST', headers: { 'X-Token': TOKEN, 'X-Chat': chat, 'X-Nombre': encodeURIComponent(f.name), 'Content-Type': 'application/octet-stream' }, body: f });
      if (!r.ok) { avisar(t('no_subir', { e: await r.text() })); continue; }
      const res = await r.json(), adj = { id: res.id, url: res.clase === 'imagen' ? URL.createObjectURL(f) : null };
      adjuntos.push(adj);
      const d = el('div'), x = boton('×', '', () => { adjuntos = adjuntos.filter(a => a !== adj); d.remove(); });
      x.setAttribute('aria-label', t('quitar'));
      if (adj.url) { const i = el('img'); i.src = adj.url; i.alt = f.name; d.append(i); } else d.append(el('span', 'chipf', `📎 ${res.nombre} · ${tam(res.tam)}`));
      d.append(x); $('c-prev').appendChild(d);
    } catch { avisar(t('sin_conexion_subir')); }
  }
}
$('c-file').onchange = e => { adjuntar([...e.target.files]); e.target.value = ''; };
$('c-texto').addEventListener('paste', e => { const f = [...e.clipboardData.files]; if (f.length) { e.preventDefault(); adjuntar(f); } });
$('chat').addEventListener('dragover', e => { e.preventDefault(); $('chat').classList.add('arrastre'); });
$('chat').addEventListener('dragleave', () => $('chat').classList.remove('arrastre'));
$('chat').addEventListener('drop', e => { e.preventDefault(); $('chat').classList.remove('arrastre'); adjuntar([...e.dataTransfer.files]); });
$('c-texto').addEventListener('keydown', e => { if (e.key === 'Enter' && !e.shiftKey && !e.isComposing) { e.preventDefault(); $('c-form').requestSubmit(); } });
$('c-form').onsubmit = e => {
  e.preventDefault();
  const texto = $('c-texto').value.trim(); if (!texto && !adjuntos.length) return;
  const ids = adjuntos.map(a => a.id);
  if (modo === 'general') mandar({ t: 'general', texto, adjuntos: ids });
  else { ultimosLocales = adjuntos.map(a => a.url).filter(Boolean); mandar({ t: 'enviar', agente: sel, texto, adjuntos: ids, ...opciones() }); }
  $('c-texto').value = ''; adjuntos = []; $('c-prev').textContent = '';
};

// ---------- Bandeja global, título, sonido y avisos ----------
function pintarBandeja() {
  const ps = oficina.preguntas.pendientes, n = pendientesTodos.length + ps.length;
  $('bn').textContent = n; $('b-bandeja').classList.toggle('hay', n > 0);
  document.title = (n ? `(${n}) ` : '') + TITULO;
  const l = $('band-l'); l.textContent = '';
  for (const p of pendientesTodos) {
    const nom = nombreDe(agente(p.agente));
    const b = boton(p.herramienta === 'AskUserQuestion' ? t('band_pregunta_ag', { a: nom }) : t('band_permiso', { a: nom, h: p.herramienta }), '', () => { $('bandeja').hidden = true; abrirAgente(p.agente); });
    if (p.resumen) b.append(el('small', '', p.resumen)); l.appendChild(b);
  }
  for (const q of ps) l.appendChild(boton(`❓ ${q.de}: ${q.texto}`, '', () => { $('bandeja').hidden = true; abrirDirector(); setTimeout(() => $('preg-' + q.id)?.scrollIntoView({ block: 'center' }), 50); }));
  if (!n) l.append(el('div', '', t('nada_pendiente')));
}
$('b-bandeja').onclick = () => { const b = $('bandeja'); b.hidden = !b.hidden; $('b-bandeja').setAttribute('aria-expanded', String(!b.hidden)); };
let audio;
function pitido() {
  try {
    audio ??= new (window.AudioContext || window.webkitAudioContext)();
    const o = audio.createOscillator(), g = audio.createGain();
    o.frequency.value = 660; g.gain.value = .05; o.connect(g); g.connect(audio.destination);
    o.start(); g.gain.exponentialRampToValueAtTime(.0001, audio.currentTime + .25); o.stop(audio.currentTime + .3);
  } catch { /* sin sonido */ }
}
function pedirAvisos() { if ('Notification' in window && Notification.permission === 'default') Notification.requestPermission(); }
function notificar(titulo, cuerpo) {
  if (!('Notification' in window) || Notification.permission !== 'granted' || !document.hidden) return;
  try { new Notification(titulo, { body: cuerpo, tag: titulo }); } catch { /* sin avisos */ }
}

// ---------- Ctrl+K: buscar y abrir ----------
function candidatos(q) {
  const s = q.toLowerCase(), vistos = new Set(), out = [];
  const add = (nombre, color, sub, abrir) => { if (!vistos.has(nombre) && nombre.toLowerCase().includes(s)) { vistos.add(nombre); out.push({ nombre, color, sub, abrir }); } };
  if (DIRN) add(DIRN, DIRC, t('bus_dir'), () => (viva(agente('_director')) ? abrirAgente('_director') : abrirDirector()));
  for (const a of roster) if (!a.director) add(a.nombre, a.color, ESTADO(a.estado), () => abrirAgente(a.nombre));
  for (const a of listaAgentes()) if (!a.roster && !a.dir) add(a.nombre, a.color, a.tipo === 'temp' ? ESTADO('temporal') : a.carpeta, () => abrirInfo(a));
  return out;
}
let busSel = 0;
function pintarBusqueda() {
  const l = $('bus-l'); l.textContent = '';
  candidatos($('bus-q').value).forEach((c, i) => {
    const li = el('li'), p = iconoAbeja(c.color, c.nombre === DIRN ? DIRC : null, 18);
    li.setAttribute('aria-selected', String(i === busSel)); li.append(p, el('span', '', c.nombre), el('small', '', c.sub || ''));
    li.onclick = () => { $('buscador').close(); c.abrir(); }; l.appendChild(li);
  });
}
function abrirBuscador() { $('bus-q').value = ''; busSel = 0; pintarBusqueda(); $('buscador').showModal(); $('bus-q').focus(); }
$('b-buscar').onclick = abrirBuscador;
$('bus-q').oninput = () => { busSel = 0; pintarBusqueda(); };
$('bus-q').onkeydown = e => {
  const c = candidatos($('bus-q').value);
  if (e.key === 'ArrowDown' || e.key === 'ArrowUp') { e.preventDefault(); busSel = (busSel + (e.key === 'ArrowDown' ? 1 : c.length - 1)) % Math.max(1, c.length); pintarBusqueda(); }
  else if (e.key === 'Enter' && c[busSel]) { e.preventDefault(); $('buscador').close(); c[busSel].abrir(); }
};
addEventListener('keydown', e => {
  if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'k') { e.preventDefault(); abrirBuscador(); }
  else if (e.key === 'Escape') {
    if ($('buscador').open || $('vista').open || $('agente-dlg').open || $('zona-dlg').open) return; // los dialog se cierran solos
    if (!$('bandeja').hidden) { $('bandeja').hidden = true; return; }
    if (modo) cerrarPanel();
  }
});

// ---------- Conexión ----------
let pqVistas = null;
function conectar() {
  ws = new WebSocket(`ws://${location.host}/ws?t=${encodeURIComponent(TOKEN)}`);
  ws.onopen = () => { $('hora2').textContent = t('conectado'); if (modo === 'agente') mandar({ t: 'abrir', agente: sel }); };
  ws.onclose = () => { $('hora2').textContent = t('sin_conexion'); setTimeout(conectar, 3000); };
  ws.onmessage = m => {
    const d = JSON.parse(m.data);
    if (d.t === 'estado') {
      const nuevos = d.pendientes.filter(p => !pendientesTodos.some(x => x.id === p.id));
      roster = d.agentes; pendientesTodos = d.pendientes;
      if (abrirAlLlegar && agente(abrirAlLlegar)) { const n = abrirAlLlegar; abrirAlLlegar = null; setTimeout(() => abrirAgente(n)); }
      if (modo === 'agente' && sel !== '_director' && !agente(sel)) cerrarPanel();
      repintarOficina(); pintarCab(); pintarBandeja();
      if (nuevos.length) pitido();
    } else if (d.t === 'config') {
      CFG.oficina = d.oficina; actualizarZonas(d.oficina); opcionesZona(); repintarOficina(); pintarCab();
    } else if (d.t === 'oficina') {
      oficina = d;
      const ids = new Set(d.preguntas.pendientes.map(q => q.id));
      if (pqVistas && [...ids].some(i => !pqVistas.has(i))) { pitido(); notificar(t('pregunta_dir', { n: DIRN }), d.preguntas.pendientes.at(-1)?.texto || ''); }
      pqVistas = ids;
      repintarOficina(); pintarPostit(); pintarBandeja();
      if (modo === 'general') pintarHilo(false);
    } else if (d.t === 'log') {
      logs.set(d.agente, d.eventos);
      pendientes.set(d.agente, new Map(d.permisos.map(p => [p.id, p])));
      pintarLog(d.agente);
    } else if (d.t === 'ev') {
      const ev = d.ev, n = d.agente;
      if (ev.k === 'permiso') {
        if (!pendientes.has(n)) pendientes.set(n, new Map());
        pendientes.get(n).set(ev.id, ev); if (modo === 'agente' && n === sel) pintarPerms();
        notificar(t('pide_n', { n: nombreDe(agente(n)) }), `${ev.herramienta}: ${ev.resumen || ''}`);
        return;
      }
      if (ev.k === 'permiso-fin') { pendientes.get(n)?.delete(ev.id); if (modo === 'agente' && n === sel) pintarPerms(); }
      if (ev.k === 'fin') notificar(t('termino_n', { n: nombreDe(agente(n)) }), t('resp_lista'));
      if (ev.k !== 'delta') { if (!logs.has(n)) logs.set(n, []); logs.get(n).push(ev); }
      if (ev.k === 'usuario' && n === sel) { ev.locales = ultimosLocales; ultimosLocales = []; }
      if (modo === 'agente' && n === sel) pintarEv(ev, true);
    }
    else if (d.t === 'adoptables') pintarAdoptables(d);
    else if (d.t === 'historial' && d.agente === sel) pintarHist(d.sesiones);
    else if (d.t === 'aviso' || d.t === 'error') avisar(d.s);
  };
}
conectar();
