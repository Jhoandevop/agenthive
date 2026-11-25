// Pruebas de seguridad, adjuntos, resultados, director, config, tapado y demo, con un query() falso (no llama a Claude).
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync, readFileSync, readdirSync, mkdirSync, existsSync, symlinkSync, copyFileSync, realpathSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir, homedir } from 'node:os';
import { randomUUID } from 'node:crypto';
import { get } from 'node:http';
import WebSocket from 'ws';
import { crear } from '../src/servidor.ts';
import { validar, cargarConfig, patronARegex, patronSeguro } from '../src/config.ts';
import { tapar } from '../src/estado.ts';
import { firmar } from '../src/seguridad.ts';
import { asignarPuestos, guardarAtomico, validarCarpeta } from '../src/equipo.ts';
// @ts-ignore: módulo JS del navegador
import { calcLayout } from '../public/plano.js';
import type { FnQuery } from '../src/chat.ts';
// @ts-ignore: módulos JS del navegador
import { render } from '../public/md.js';
// @ts-ignore
import { textos } from '../public/i18n.js';

const P = 18895, O = `http://127.0.0.1:${P}`;
const base = mkdtempSync(join(tmpdir(), 'oficina-test-'));
const dirSesiones = join(base, 'sesiones'), subidas = join(base, 'subidas'), coord = join(base, 'coord'), paraDir = join(base, 'para-dir');
const buzon = join(coord, 'buzon.jsonl'), preguntasJ = join(coord, 'preguntas.jsonl');
const carpetaPrueba = join(base, 'prueba'), carpetaDir = join(base, 'director'), fuera = join(base, 'fuera');
for (const d of [dirSesiones, coord, carpetaPrueba, carpetaDir, fuera]) mkdirSync(d);
writeFileSync(join(fuera, 'secreto.txt'), 'no');
const sesionTerminal = (nombre: string) => writeFileSync(join(dirSesiones, `${process.pid}.json`), JSON.stringify({ pid: process.pid, kind: 'interactive', name: nombre, cwd: base, status: 'busy', sessionId: randomUUID() }));
sesionTerminal('ocupado'); // "ocupado" aparece vivo en una terminal (pid de este proceso, que existe)
writeFileSync(preguntasJ, [
  { id: 'p1', ts: 1, de: 'General', texto: '¿Despliego hoy?', estado: 'pendiente', opciones: ['Sí', 'No'] },
  { id: 'p2', ts: 2, de: 'General', texto: '¿Ya respondida?', estado: 'pendiente' },
  { id: 'p2', estado: 'respondida', respuesta: 'sí' },
].map(x => JSON.stringify(x)).join('\n') + '\n{rota\n');
writeFileSync(join(coord, 'general.jsonl'), JSON.stringify({ id: 'g1', ts: 5, texto: 'Hola **equipo** <script>x</script>', responde_a: 'abc', extra: 'no viaja' }) + '\n');
const opcionesVistas: any[] = [];
const SID_DIR_VIEJA = randomUUID(), SID_DIR_NUEVA = randomUUID();

// query() falso: "permiso" pide Bash; "pregúntame" usa AskUserQuestion; "escribe <ruta>" usa Write; "artifact" devuelve un enlace.
const falso: FnQuery = ({ prompt, options }) => {
  opcionesVistas.push(options);
  const it = (async function* () {
    yield { type: 'system', subtype: 'init', session_id: randomUUID(), model: 'falso', permissionMode: options.permissionMode, apiKeySource: 'none' } as any;
    for await (const m of prompt) {
      const c: any = m.message.content, texto: string = c.filter((b: any) => b.type === 'text').map((b: any) => b.text).join('\n');
      let r = 'ok';
      const herr = async function* (name: string, input: any, resultado: string, id = randomUUID()) {
        yield { type: 'assistant', parent_tool_use_id: null, message: { content: [{ type: 'tool_use', id, name, input }] } } as any;
        yield { type: 'user', parent_tool_use_id: null, message: { content: [{ type: 'tool_result', tool_use_id: id, content: resultado }] } } as any;
      };
      if (texto.includes('permiso')) {
        const d: any = await options.canUseTool!('Bash', { command: 'ls' }, { signal: new AbortController().signal } as any);
        r = d.behavior === 'allow' ? 'decision:allow' : `decision:deny:${d.message}`;
      } else if (texto.includes('pregúntame')) {
        const d: any = await options.canUseTool!('AskUserQuestion', { questions: [{ question: '¿Color?', header: 'Color', multiSelect: false, options: [{ label: 'Azul', description: 'frío' }, { label: 'Rojo', description: '' }] }] }, { signal: new AbortController().signal } as any);
        r = 'answers:' + JSON.stringify(d.updatedInput?.answers);
      } else if (texto.startsWith('escribe ')) {
        const ruta = texto.slice(8).split('\n')[0];
        writeFileSync(ruta, ruta.endsWith('.html') ? '<h1>hola</h1><script>1</script>' : '# hola');
        yield* herr('Write', { file_path: ruta, content: 'x' }, 'File created');
      } else if (texto.includes('artifact')) {
        yield* herr('mcp__claude_ai__publicar', { title: 'x' }, 'Publicado en https://claude.ai/artifact/abc123def456 listo');
      }
      const imgs = c.filter((b: any) => b.type === 'image').length, docs = c.filter((b: any) => b.type === 'document').length;
      yield { type: 'assistant', parent_tool_use_id: null, message: { content: [{ type: 'text', text: `${r} imgs:${imgs} docs:${docs}${texto.includes('Adjunto:') ? ' | ' + texto : ''}` }] } } as any;
      yield { type: 'result', subtype: 'success', is_error: false, total_cost_usd: 0.01, usage: { input_tokens: 1, output_tokens: 1 }, duration_ms: 5 } as any;
    }
  })();
  return Object.assign(it, { interrupt: async () => undefined, setPermissionMode: async () => undefined }) as any;
};

// La config vive en un archivo (como en uso real): el servidor escribe ahí los puestos y los cambios del equipo.
const cfgPath = join(base, 'oficina.config.json');
const crudoInicial = {
  titulo: 'Oficina de prueba', idioma: 'es',
  agentes: [
    { nombre: 'prueba', carpeta: carpetaPrueba, color: '#4fd1c5', modelo: 'haiku' },
    { nombre: 'ocupado', carpeta: base, color: '#4fd1c5', modelo: 'haiku' },
  ],
  director: { nombre: 'General', patronSesion: 'lead-*', carpeta: carpetaDir },
  coordinacion: { dir: coord },
};
writeFileSync(cfgPath, JSON.stringify(crudoInicial));
// "Casa" falsa para validar carpetas de agentes nuevos.
const casa = join(base, 'casa');
for (const d of ['proyectos/app', 'proyectos/otra', '.ssh', '.config/algo', 'proyectos/.oculta']) mkdirSync(join(casa, d), { recursive: true });
writeFileSync(join(casa, 'archivo.txt'), 'x');
symlinkSync(fuera, join(casa, 'proyectos', 'enlace-fuera'));
symlinkSync(join(casa, '.ssh'), join(casa, 'proyectos', 'enlace-ssh'));
const listar = async (dir: string) => dir === carpetaDir
  ? [{ sessionId: SID_DIR_VIEJA, customTitle: 'lead-77', summary: 'a', lastModified: 2 }, { sessionId: SID_DIR_NUEVA, customTitle: 'otra cosa', summary: 'b', lastModified: 3 }]
  : [];
const app = crear({ rutaConfig: cfgPath, home: casa, puerto: P, query: falso, esperaPermisoMs: 1500, dirSesiones, dirSubidas: subidas, dirParaDirector: paraDir, listar, generador: () => ({ agentes: [], feed: [], generado: 1 }) });
const backupArranque = JSON.parse(readFileSync(cfgPath + '.bak', 'utf8'));
before(() => app.escuchar());
after(() => app.cerrar());
const lineas = (f: string) => readFileSync(f, 'utf8').trim().split('\n').flatMap(l => { try { return [JSON.parse(l)]; } catch { return []; } });

const PNG = Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), Buffer.alloc(32)]);
const PDF = Buffer.from('%PDF-1.4\n%falso\n');
const subir = (body: Buffer, nombre = 'a.png', h: Record<string, string> = {}, chat = 'prueba') =>
  fetch(`${O}/subir`, { method: 'POST', body: new Uint8Array(body), headers: { Origin: O, 'X-Token': app.token, 'X-Chat': chat, 'X-Nombre': encodeURIComponent(nombre), ...h } });

// Cliente WS que junta mensajes y permite esperar uno que cumpla una condición.
function cliente(origin = O, token = app.token): Promise<{ ws: WebSocket; espera: (f: (d: any) => boolean) => Promise<any>; limpiar: () => void }> {
  return new Promise((ok, mal) => {
    const ws = new WebSocket(`ws://127.0.0.1:${P}/ws?t=${encodeURIComponent(token)}`, { headers: { Origin: origin } });
    const recibidos: any[] = [], esperas: [(d: any) => boolean, (d: any) => void][] = [];
    ws.on('message', m => {
      const d = JSON.parse(String(m)), e = esperas.find(e => e[0](d));
      if (e) { esperas.splice(esperas.indexOf(e), 1); e[1](d); } else recibidos.push(d);
    });
    ws.on('open', () => ok({ ws, limpiar: () => { recibidos.length = 0; }, espera: f => new Promise((r, x) => { const y = recibidos.find(f); if (y) { recibidos.splice(recibidos.indexOf(y), 1); return r(y); } esperas.push([f, r]); setTimeout(() => x(new Error('timeout esperando mensaje')), 6000); }) }));
    ws.on('error', mal);
    ws.on('unexpected-response', (_q, res) => mal(new Error(`HTTP ${res.statusCode}`)));
  });
}
const crudo = (ruta: string, host = `127.0.0.1:${P}`) => new Promise<{ code: number; h: Record<string, any>; body: string }>(r =>
  get({ host: '127.0.0.1', port: P, path: ruta, headers: { Host: host } }, res => { let b = ''; res.on('data', x => (b += x)); res.on('end', () => r({ code: res.statusCode!, h: res.headers, body: b })); }));

test('la página exige Host local, trae token y config pública, y no tiene CORS', async () => {
  const r = await fetch(`${O}/`), html = await r.text();
  assert.equal(r.status, 200);
  assert.ok(html.includes(app.token));
  assert.ok(html.includes('<title>Oficina de prueba</title>'));
  assert.ok(!html.includes(carpetaPrueba), 'la página no lleva rutas de agentes');
  assert.equal(r.headers.get('access-control-allow-origin'), null);
  assert.match(r.headers.get('content-security-policy') ?? '', /script-src 'self'/);
  assert.equal((await crudo('/', `malo.com:${P}`)).code, 403); // DNS rebinding
  assert.equal((await fetch(`${O}/../oficina.config.json`)).status, 404);
});

test('subir: token, Origin, chat, lista blanca, bytes mágicos y tamaños', async () => {
  assert.equal((await subir(PNG, 'a.png', { 'X-Token': 'malo' })).status, 403);
  assert.equal((await fetch(`${O}/subir`, { method: 'POST', body: new Uint8Array(PNG), headers: { 'X-Token': app.token, 'X-Chat': 'prueba' } })).status, 403); // sin Origin
  assert.equal((await subir(PNG, 'a.png', { Origin: 'http://evil.com' })).status, 403);
  assert.equal((await subir(PNG, 'a.png', {}, 'intruso')).status, 400);
  assert.equal((await subir(Buffer.from('MZ\x90\x00'), 'virus.exe')).status, 415);
  assert.equal((await subir(Buffer.from('GIF89a' + 'x'.repeat(40)), 'foto.png')).status, 415); // extensión no coincide
  assert.equal((await subir(Buffer.from('hola'), 'doc.pdf')).status, 415);
  assert.equal((await subir(Buffer.from('no es zip'), 'hoja.xlsx')).status, 415);
  assert.equal((await subir(Buffer.from('a\0b'), 'notas.txt')).status, 415); // texto con NUL
  assert.equal((await subir(Buffer.from([0xff, 0xfe, 0xfd]), 'datos.csv')).status, 415); // no es UTF-8
  assert.equal((await subir(Buffer.alloc(25 * 1024 * 1024 + 1, 0x41), 'grande.txt')).status, 413);
  assert.equal((await subir(Buffer.concat([PNG, Buffer.alloc(10 * 1024 * 1024)]), 'grande.png')).status, 413); // imágenes: 10 MB
  for (const [b, n, clase] of [[PNG, 'Foto Ñandú.png', 'imagen'], [PDF, 'informe.pdf', 'pdf'], [Buffer.from('PK\x03\x04resto'), 'hoja.docx', 'binario'], [Buffer.from('a,b\n1,2\n'), 'datos.csv', 'texto']] as const) {
    const r = await subir(b as Buffer, n);
    assert.equal(r.status, 200, n);
    const j = await r.json();
    assert.equal(j.clase, clase);
    assert.match(j.id, /^[0-9a-f]{16}_[A-Za-z0-9._-]+$/);
  }
  assert.ok(readdirSync(join(subidas, 'prueba')).some(f => f.endsWith('_Foto_Nandu.png')));
});

test('el WebSocket rechaza Origin ajeno y token malo', async () => {
  await assert.rejects(cliente('http://evil.com'), /403/);
  await assert.rejects(cliente(O, 'token-malo'), /403/);
  const { ws, espera } = await cliente();
  assert.equal((await espera(d => d.t === 'estado')).agentes.length, 3); // 2 del roster + director
  ws.close();
});

test('solo se lanzan agentes del roster, en su carpeta y no si están en su terminal', async () => {
  const { ws, espera } = await cliente();
  ws.send(JSON.stringify({ t: 'lanzar', agente: 'intruso' }));
  assert.match((await espera(d => d.t === 'error')).s, /roster/);
  ws.send(JSON.stringify({ t: 'lanzar', agente: 'prueba', sesion: randomUUID() }));
  assert.match((await espera(d => d.t === 'error')).s, /carpeta/);
  ws.send(JSON.stringify({ t: 'lanzar', agente: 'ocupado', sesion: 'nueva' }));
  assert.match((await espera(d => d.t === 'error')).s, /terminal/);
  ws.send(JSON.stringify({ t: 'lanzar', agente: 'prueba', sesion: 'nueva', modelo: 'haiku', esfuerzo: 'turbo' }));
  await espera(d => d.t === 'estado' && d.agentes.find((a: any) => a.nombre === 'prueba').estado === 'esperando');
  const o = opcionesVistas.at(-1);
  assert.equal(o.cwd, carpetaPrueba);
  assert.equal(o.permissionMode, 'default');
  assert.equal(o.effort, undefined);
  assert.equal(o.allowDangerouslySkipPermissions, undefined);
  assert.equal(o.systemPrompt, undefined); // sin contexto no se toca el prompt
  ws.close();
});

test('tarjeta de permiso: permitir, rechazar con mensaje y vencer = rechazo', async () => {
  const { ws, espera } = await cliente();
  const enviar = (texto: string, adjuntos: string[] = []) => ws.send(JSON.stringify({ t: 'enviar', agente: 'prueba', texto, adjuntos }));
  const texto = () => espera(d => d.t === 'ev' && d.ev.k === 'texto').then(d => d.ev.s);
  const tarjeta = () => espera(d => d.t === 'ev' && d.ev.k === 'permiso').then(d => d.ev);
  enviar('necesito permiso');
  let p = await tarjeta();
  assert.equal(p.resumen, 'ls');
  ws.send(JSON.stringify({ t: 'permiso', agente: 'ocupado', id: p.id, permitir: true }));
  assert.match((await espera(d => d.t === 'error')).s, /pendiente/);
  ws.send(JSON.stringify({ t: 'permiso', agente: 'prueba', id: p.id, permitir: true }));
  assert.equal(await texto(), 'decision:allow imgs:0 docs:0');
  enviar('otro permiso');
  p = await tarjeta();
  ws.send(JSON.stringify({ t: 'permiso', agente: 'prueba', id: p.id, permitir: false, mensaje: 'usa Glob' }));
  assert.equal(await texto(), 'decision:deny:usa Glob imgs:0 docs:0');
  enviar('permiso sin respuesta');
  p = await tarjeta();
  assert.equal((await espera(d => d.t === 'ev' && d.ev.k === 'permiso-fin' && d.ev.id === p.id)).ev.como, 'vencido');
  assert.match(await texto(), /^decision:deny:.*no respondió/);
  ws.close();
});

test('adjuntos al agente: imagen y PDF como bloques, el resto como ruta; ids ajenos o con ../ se rechazan', async () => {
  const { ws, espera } = await cliente();
  const id = async (b: Buffer, n: string, chat = 'prueba') => (await (await subir(b, n, {}, chat)).json()).id as string;
  const [img, pdf, csv, ajeno] = [await id(PNG, 'f.png'), await id(PDF, 'i.pdf'), await id(Buffer.from('a,b\n'), 'd.csv'), await id(PNG, 'x.png', 'ocupado')];
  ws.send(JSON.stringify({ t: 'enviar', agente: 'prueba', texto: 'mira', adjuntos: [img, pdf, csv] }));
  const s = (await espera(d => d.t === 'ev' && d.ev.k === 'texto')).ev.s as string;
  assert.match(s, /^ok imgs:1 docs:1 \| mira\nAdjunto: .*prueba\/[0-9a-f]{16}_d\.csv \(text\/plain, 4 B\)$/);
  for (const malo of [ajeno, '../../etc/passwd', '0123456789abcdef_../x']) {
    ws.send(JSON.stringify({ t: 'enviar', agente: 'prueba', texto: 'x', adjuntos: [malo] }));
    assert.match((await espera(d => d.t === 'error')).s, /Adjunto inválido/);
  }
  ws.close();
});

test('resultados: archivos escritos en su carpeta, enlaces firmados, HTML en sandbox y nada fuera de su carpeta', async () => {
  const { ws, espera } = await cliente();
  ws.send(JSON.stringify({ t: 'enviar', agente: 'prueba', texto: `escribe ${join(carpetaPrueba, 'pagina.html')}` }));
  const a = (await espera(d => d.t === 'ev' && d.ev.k === 'archivo')).ev;
  assert.equal(a.nombre, 'pagina.html'); assert.ok(a.vista?.startsWith('/vista?'));
  const v = await crudo(a.vista);
  assert.equal(v.code, 200);
  assert.match(v.h['content-type'], /text\/html/);
  assert.match(v.h['content-security-policy'], /^sandbox allow-scripts;/);
  assert.ok(!/allow-same-origin/.test(v.h['content-security-policy']));
  const f = await crudo(a.url);
  assert.match(f.h['content-type'], /text\/plain/); // /archivo nunca sirve HTML como HTML
  assert.match(f.h['content-security-policy'], /^sandbox;/);
  assert.match((await crudo(a.url + '&d=1')).h['content-disposition'], /^attachment/);
  assert.equal((await crudo(a.url.replace(/k=[^&]+/, 'k=falsa'))).code, 403);
  // firma válida pero fuera de su carpeta, o por un enlace simbólico que sale de ella: no se sirve
  const q = (r: string) => `/archivo?a=prueba&r=${encodeURIComponent(r)}&k=${firmar(app.token, 'prueba', r)}`;
  assert.equal((await crudo(q(join(fuera, 'secreto.txt')))).code, 404);
  symlinkSync(join(fuera, 'secreto.txt'), join(carpetaPrueba, 'enlace.txt'));
  assert.equal((await crudo(q(join(carpetaPrueba, 'enlace.txt')))).code, 404);
  assert.equal((await crudo(q(join(carpetaPrueba, '..', 'fuera', 'secreto.txt')))).code, 404);
  // un Write fuera de su carpeta no aparece en Resultados
  ws.send(JSON.stringify({ t: 'enviar', agente: 'prueba', texto: `escribe ${join(fuera, 'otro.md')}` }));
  await espera(d => d.t === 'ev' && d.ev.k === 'fin');
  assert.ok(!app.enlace('prueba', join(fuera, 'otro.md')));
  ws.close();
});

test('artifact: un enlace de claude.ai en un resultado sale como tarjeta', async () => {
  const { ws, espera } = await cliente();
  ws.send(JSON.stringify({ t: 'enviar', agente: 'prueba', texto: 'publica un artifact' }));
  const e = (await espera(d => d.t === 'ev' && d.ev.k === 'artifact')).ev;
  assert.equal(e.url, 'https://claude.ai/artifact/abc123def456');
  assert.equal(e.titulo, 'mcp__claude_ai__publicar');
  ws.close();
});

const responder = (body: unknown, h: Record<string, string> = {}) =>
  fetch(`${O}/preguntas`, { method: 'POST', body: JSON.stringify(body), headers: { Origin: O, 'X-Token': app.token, 'Content-Type': 'application/json', ...h } });

test('responder preguntas: token, Origin, id desconocido, vacía y ya respondida', async () => {
  assert.equal((await responder({ id: 'p1', respuesta: 'Sí' }, { 'X-Token': 'malo' })).status, 403);
  assert.equal((await responder({ id: 'p1', respuesta: 'Sí' }, { Origin: 'http://evil.com' })).status, 403);
  assert.equal((await responder({ id: 'nada', respuesta: 'Sí' })).status, 404);
  assert.equal((await responder({ id: 'p1', respuesta: '  ' })).status, 400);
  assert.equal((await responder({ id: 'p2', respuesta: 'otra vez' })).status, 409);
  assert.equal((await responder({ id: 'p1', respuesta: 'Sí' })).status, 200);
  assert.equal((await responder({ id: 'p1', respuesta: 'No' })).status, 409);
  const q = lineas(preguntasJ).filter((x: any) => x.id === 'p1').at(-1);
  assert.deepEqual([q.estado, q.respuesta, typeof q.ts], ['respondida', 'Sí', 'number']);
  const b = lineas(buzon).at(-1);
  assert.equal(b.to, 'General'); assert.equal(b.pregunta_id, 'p1'); assert.equal(b.estado, 'pendiente');
  assert.equal(b.texto, 'Respuesta a «¿Despliego hoy?»: Sí'); assert.match(b.id, /^[0-9a-f]{8}$/);
});

test('la oficina llega por WS: estado del generador, preguntas e hilo con el director', async () => {
  const { ws, espera } = await cliente();
  const o = await espera(d => d.t === 'oficina');
  assert.deepEqual(o.estado, { agentes: [], feed: [], generado: 1 });
  assert.ok(!o.preguntas.pendientes.some((q: any) => q.id === 'p2'));
  const g = o.hilo.find((m: any) => m.de === 'general');
  assert.deepEqual(g, { de: 'general', id: 'g1', ts: 5, texto: 'Hola **equipo** <script>x</script>', responde_a: 'abc' }); // md.js lo escapa al pintar
  ws.close();
});

test('mensaje al director: buzón con imagenes y adjuntos (rutas absolutas) y miniaturas firmadas en el hilo', async () => {
  const { ws, espera } = await cliente();
  const img = (await (await subir(PNG, 'f.png', {}, '_director')).json()).id, pdf = (await (await subir(PDF, 'p.pdf', {}, '_director')).json()).id;
  ws.send(JSON.stringify({ t: 'general', texto: 'mira esto', adjuntos: [img, pdf] }));
  await espera(d => d.t === 'aviso');
  const b = lineas(buzon).at(-1);
  assert.deepEqual(Object.keys(b).sort(), ['adjuntos', 'estado', 'id', 'imagenes', 'texto', 'to', 'ts']);
  assert.deepEqual([b.to, b.texto, b.estado], ['General', 'mira esto', 'pendiente']);
  assert.deepEqual(b.imagenes, [join(paraDir, img)]); assert.deepEqual(b.adjuntos, [join(paraDir, pdf)]);
  assert.ok(readFileSync(b.imagenes[0]).equals(PNG));
  const o = await espera(d => d.t === 'oficina' && d.hilo.some((m: any) => m.texto === 'mira esto'));
  const m = o.hilo.find((x: any) => x.texto === 'mira esto');
  assert.match(m.imagenes[0], /^\/archivo\?a=_&/); assert.deepEqual(m.adjuntos, [pdf]);
  assert.equal((await crudo(m.imagenes[0])).code, 200);
  ws.send(JSON.stringify({ t: 'general', texto: 'x', adjuntos: ['../secreto.png'] }));
  assert.match((await espera(d => d.t === 'error')).s, /Adjunto inválido/);
  ws.send(JSON.stringify({ t: 'general', texto: '' }));
  assert.match((await espera(d => d.t === 'error')).s, /4000/);
  ws.close();
});

test('llamar y despedir: el agente pasa de libre a esperando y vuelve a libre', async () => {
  const { ws, espera, limpiar } = await cliente();
  const estadoDe = (d: any) => d.t === 'estado' && d.agentes.find((a: any) => a.nombre === 'prueba').estado;
  ws.send(JSON.stringify({ t: 'cerrar', agente: 'prueba' }));
  await espera(d => estadoDe(d) === 'libre');
  limpiar();
  ws.send(JSON.stringify({ t: 'lanzar', agente: 'prueba', sesion: 'ultima' }));
  await espera(d => estadoDe(d) === 'esperando');
  limpiar();
  ws.send(JSON.stringify({ t: 'cerrar', agente: 'prueba' }));
  await espera(d => estadoDe(d) === 'libre');
  ws.close();
});

test('director desde la web: retoma su sesión con nombre de director, es único y no se lanza si está en una terminal', async () => {
  const { ws, espera, limpiar } = await cliente();
  const dir = (d: any) => d.t === 'estado' && d.agentes.find((a: any) => a.nombre === '_director');
  ws.send(JSON.stringify({ t: 'lanzar', agente: '_director', sesion: 'ultima' }));
  const e = await espera(d => dir(d)?.estado === 'esperando');
  assert.equal(dir(e).mostrar, 'General');
  const o = opcionesVistas.at(-1);
  assert.equal(o.cwd, carpetaDir); assert.equal(o.resume, SID_DIR_VIEJA); assert.equal(o.permissionMode, 'default');
  // Se abre otra sesión de director en una terminal: sigue «en la web» (no se pisa).
  sesionTerminal('lead-b9');
  await new Promise(r => setTimeout(r, 3500));
  limpiar(); ws.send(JSON.stringify({ t: 'abrir', agente: 'prueba' }));
  ws.send(JSON.stringify({ t: 'plan', agente: '_director', plan: false }));
  assert.equal(dir(await espera(d => !!dir(d))).estado, 'esperando');
  ws.send(JSON.stringify({ t: 'cerrar', agente: '_director' }));
  await espera(d => dir(d)?.estado === 'terminal');
  ws.send(JSON.stringify({ t: 'lanzar', agente: '_director', sesion: 'ultima' }));
  assert.match((await espera(d => d.t === 'error')).s, /terminal/);
  sesionTerminal('ocupado');
  ws.close();
});

test('AskUserQuestion: tarjeta con opciones y respuesta como answers', async () => {
  const { ws, espera } = await cliente();
  ws.send(JSON.stringify({ t: 'enviar', agente: 'prueba', texto: 'pregúntame algo' }));
  const p = (await espera(d => d.t === 'ev' && d.ev.k === 'permiso')).ev;
  assert.deepEqual(p.preguntas, [{ pregunta: '¿Color?', titulo: 'Color', multiple: false, opciones: [{ etiqueta: 'Azul', detalle: 'frío' }, { etiqueta: 'Rojo', detalle: '' }] }]);
  const g = await espera(d => d.t === 'estado' && d.pendientes.length === 1);
  assert.equal(g.pendientes[0].agente, 'prueba');
  ws.send(JSON.stringify({ t: 'permiso', agente: 'prueba', id: p.id, permitir: true, respuestas: { '¿Color?': 'Azul' } }));
  assert.equal((await espera(d => d.t === 'ev' && d.ev.k === 'texto')).ev.s, 'answers:{"¿Color?":"Azul"} imgs:0 docs:0');
  ws.close();
});

test('buzón: formato y largo', async () => {
  const { ws, espera } = await cliente();
  ws.send(JSON.stringify({ t: 'buzon', agente: 'ocupado', texto: 'hola desde la web' }));
  await espera(d => d.t === 'aviso');
  const l = lineas(buzon).at(-1);
  assert.match(l.id, /^[0-9a-f]{8}$/);
  assert.deepEqual([l.to, l.texto, l.estado, typeof l.ts], ['ocupado', 'hola desde la web', 'pendiente', 'number']);
  ws.send(JSON.stringify({ t: 'buzon', agente: 'ocupado', texto: 'x'.repeat(1001) }));
  assert.match((await espera(d => d.t === 'error')).s, /1000/);
  ws.close();
});

test('config: sin oficina.config.json usa el ejemplo; la inválida da error claro', () => {
  const raiz = mkdtempSync(join(tmpdir(), 'oficina-cfg-'));
  copyFileSync(join(import.meta.dirname, '..', 'oficina.config.example.json'), join(raiz, 'oficina.config.example.json'));
  const { config: c, origen } = cargarConfig(raiz);
  assert.ok(origen.endsWith('oficina.config.example.json'));
  assert.equal(c.titulo, 'AgentHive'); assert.equal(c.director, undefined);
  assert.equal(c.agentes[0].carpeta, join(homedir(), 'proyectos', 'mi-app')); // "~/" se expande
  assert.equal(c.coordinacion.dir, join(raiz, 'tmp', 'coordinacion'));
  assert.equal(c.oficina.zonas.length, 3);
  writeFileSync(join(raiz, 'oficina.config.json'), '{ "agentes": null }');
  assert.throws(() => cargarConfig(raiz), /oficina\.config\.json: "agentes"/);
  assert.throws(() => validar({ agentes: [{ nombre: 'Malo Nombre', carpeta: '/x' }] }), /nombre inválido/);
  assert.throws(() => validar({ agentes: [{ nombre: 'a', carpeta: '/x' }], director: { nombre: 'G' } }), /patronSesion/);
  assert.throws(() => validar({ agentes: [{ nombre: 'a', carpeta: '/x' }], oficina: { zonas: [{ nombre: 'Z', patron: '(' }] } }), /patrón/);
  assert.ok(patronARegex('lead-*').test('lead-b7') && !patronARegex('lead-*').test('xlead-b7'));
});

test('tapado: mismo resultado que extra.py (y tapa también "contraseña" y correos con tilde)', () => {
  // Salidas de referencia obtenidas con la función tapar() original en Python.
  assert.equal(tapar('mi correo es a.b@x.com y token: abc123 y tokenFalsoABCDEFGHIJKLMNOPQRSTUV12 y cel 300 123 4567', 300), 'mi correo es [correo] y token [oculto] y […] y cel [teléfono]');
  assert.equal(tapar('josé@x.com contraseña: hola123 ok', 300), '[correo] contraseña [oculto] ok');
  assert.equal(tapar('ver https://x.com/a?b=1 y clave=zz', 300), 'ver [enlace] y clave [oculto]');
  assert.equal(tapar('  muchos   espacios ' + 'a'.repeat(150)), 'muchos espacios […]');
  assert.equal(tapar('x'.repeat(5) + ' ' + 'palabra '.repeat(30), 20), 'xxxxx palabra palab…');
});

test('i18n: español e inglés tienen las mismas claves', () => {
  assert.deepEqual(Object.keys(textos.en).sort(), Object.keys(textos.es).sort());
});

test('el markdown se escapa antes de dar formato', () => {
  const h = render('<img src=x onerror=alert(1)> **ok** [a](javascript:alert(1)) [b](https://x.co/?a="1")\n```\n<script>x</script>\n```');
  assert.ok(!/<img|<script|href="javascript/i.test(h));
  assert.ok(h.includes('<strong>ok</strong>'));
  assert.ok(h.includes('&lt;script&gt;'));
  assert.ok(h.includes('href="https://x.co/?a=&quot;1&quot;"'));
});

test('modo demo: agentes y eventos falsos, sin ~/.claude, y un agente que escribe un archivo con permiso', async () => {
  const demo = crear({ demo: true, puerto: 18897, dirSubidas: join(base, 'demo-subidas'), dirParaDirector: join(base, 'demo-para') });
  await demo.escuchar();
  try {
    const OD = 'http://127.0.0.1:18897', html = await (await fetch(OD + '/')).text();
    assert.ok(html.includes('<title>AgentHive</title>'));
    const ws = new WebSocket(`ws://127.0.0.1:18897/ws?t=${encodeURIComponent(demo.token)}`, { headers: { Origin: OD } });
    const msgs: any[] = [];
    const llega = (f: (d: any) => boolean) => new Promise<any>((r, x) => { const v = () => { const y = msgs.find(f); if (y) return r(y); setTimeout(v, 30); }; v(); setTimeout(() => x(new Error('timeout demo')), 8000); });
    ws.on('message', m => msgs.push(JSON.parse(String(m))));
    const e = await llega(d => d.t === 'estado'), o = await llega(d => d.t === 'oficina');
    assert.deepEqual(e.agentes.map((a: any) => a.nombre), ['backend', 'frontend', 'docs', 'qa', '_director']);
    assert.ok(o.estado.agentes.some((a: any) => a.nombre === 'designer'));
    assert.equal(o.preguntas.pendientes[0].id, 'demo-q1');
    ws.send(JSON.stringify({ t: 'enviar', agente: 'backend', texto: 'write the report' }));
    const p = (await llega(d => d.t === 'ev' && d.ev.k === 'permiso')).ev;
    ws.send(JSON.stringify({ t: 'permiso', agente: 'backend', id: p.id, permitir: true }));
    const a = (await llega(d => d.t === 'ev' && d.ev.k === 'archivo')).ev;
    assert.equal(a.nombre, 'report.md');
    assert.ok(existsSync(join(demo.config.agentes[0].carpeta, 'report.md')));
    ws.close();
  } finally { await demo.cerrar(); }
});

const equipo = (body: unknown, h: Record<string, string> = {}) =>
  fetch(`${O}/agentes`, { method: 'POST', body: JSON.stringify(body), headers: { Origin: O, 'X-Token': app.token, 'Content-Type': 'application/json', ...h } });
const leerCfg = () => JSON.parse(readFileSync(cfgPath, 'utf8'));

test('puestos: el arranque fija el puesto adivinado en la config (con .bak) y sobrevive a otro arranque con otro orden', async () => {
  const c = leerCfg();
  assert.deepEqual(c.agentes.map((a: any) => [a.nombre, a.puesto]), [['prueba', { zona: 0, i: 0 }], ['ocupado', { zona: 0, i: 1 }]]);
  assert.deepEqual(backupArranque, crudoInicial);
  // "recarga": otra instancia con los agentes en orden inverso conserva cada puesto
  const otra = join(base, 'otra.config.json');
  writeFileSync(otra, JSON.stringify({ ...c, agentes: [...c.agentes].reverse() }));
  const b = crear({ rutaConfig: otra, puerto: 18899, dirSesiones, dirSubidas: join(base, 'sub2'), dirParaDirector: join(base, 'pd2'), listar, generador: () => ({}) });
  try {
    assert.deepEqual(b.config.agentes.map(a => [a.nombre, a.puesto]), [['ocupado', { zona: 0, i: 1 }], ['prueba', { zona: 0, i: 0 }]]);
  } finally { await b.cerrar(); }
});

test('puestos sin techo: asignarPuestos no tiene límite por isla y el plano crece por filas', () => {
  const crudo = { agentes: Array.from({ length: 10 }, (_, k) => ({ nombre: `a${k}`, carpeta: '/x', zona: 4 })), oficina: { zonas: [1, 2, 3, 4, 5, 6].map(n => ({ nombre: `Z${n}` })) } };
  const c = validar(crudo);
  assert.equal(c.oficina.zonas.length, 6);
  asignarPuestos(crudo, c);
  assert.deepEqual(c.agentes.map(a => a.puesto), Array.from({ length: 10 }, (_, i) => ({ zona: 4, i })));
  const base3 = calcLayout(3, {}, 0);
  assert.deepEqual([base3.fz, base3.filas, base3.filasC], [[1, 1, 1], [1, 0], 2]); // zonas vacías: una sola fila libre
  assert.deepEqual(calcLayout(3, { 0: 1, 1: 2 }, 0).fz, [2, 3, 1]); // exactamente una fila libre por zona
  const l = calcLayout(6, { 4: 9 }, 7); // 10 escritorios en la zona 4 + 7 temporales
  assert.equal(l.filas[1], 6); // 10 ocupados + 1 libre → 6 filas de 2
  assert.ok(l.y0[1] > l.y0[0] + l.filas[0] * 48);
  assert.ok(l.filasC * 2 >= 7 && l.DY > 0);
  assert.equal(calcLayout(3, { 0: 3 }, 0).filas[0], 3); // isla llena (4) → crece una fila
});

test('equipo: token, Origin y validación de nombre, carpeta y puesto', async () => {
  const ok = { accion: 'crear', nombre: 'nuevo', carpeta: '~/proyectos/app', modelo: 'haiku', descripcion: 'hola', color: '#112233', puesto: { zona: 1, i: 0 } };
  assert.equal((await equipo(ok, { 'X-Token': 'malo' })).status, 403);
  assert.equal((await equipo(ok, { Origin: 'http://evil.com' })).status, 403);
  const mal = async (cambio: object, code: number, re: RegExp) => { const r = await equipo({ ...ok, ...cambio }); assert.equal(r.status, code, JSON.stringify(cambio)); assert.match(await r.text(), re); };
  await mal({ nombre: 'Malo' }, 400, /Nombre inválido/);
  await mal({ nombre: 'a' }, 400, /Nombre inválido/);
  await mal({ nombre: 'x'.repeat(32) }, 400, /Nombre inválido/);
  await mal({ nombre: '_director' }, 400, /director/);
  await mal({ nombre: 'prueba' }, 409, /Ya hay/);
  await mal({ carpeta: casa }, 400, /dentro de tu carpeta personal/);
  await mal({ carpeta: '~' }, 400, /dentro de tu carpeta personal/);
  await mal({ carpeta: fuera }, 400, /dentro de tu carpeta personal/);
  await mal({ carpeta: '~/.ssh' }, 400, /ocultas/);
  await mal({ carpeta: '~/.config/algo' }, 400, /ocultas/);
  await mal({ carpeta: '~/proyectos/.oculta' }, 400, /ocultas/);
  await mal({ carpeta: '~/proyectos/app/../../.ssh' }, 400, /ocultas/);
  await mal({ carpeta: '~/proyectos/enlace-fuera' }, 400, /dentro de tu carpeta personal/); // el enlace sale de casa
  await mal({ carpeta: '~/proyectos/enlace-ssh' }, 400, /ocultas/);
  await mal({ carpeta: '~/proyectos/no-existe' }, 400, /no existe/);
  await mal({ carpeta: '~/archivo.txt' }, 400, /no es una carpeta/);
  await mal({ carpeta: 'proyectos/app' }, 400, /absoluta/);
  await mal({ puesto: { zona: 0, i: 0 } }, 409, /ocupado/);
  await mal({ puesto: { zona: 9, i: 0 } }, 400, /no existe/);
  await mal({ modelo: 'gpt' }, 400, /Modelo/);
  await mal({ descripcion: 'x'.repeat(201) }, 400, /200/);
  await mal({ color: 'red' }, 400, /Color/);
  assert.equal(leerCfg().agentes.length, 2, 'nada inválido se escribió');
});

test('equipo: crear (sin lanzar), editar y quitar escriben la config de forma atómica con .bak', async () => {
  const { ws, espera } = await cliente();
  const antes = readFileSync(cfgPath, 'utf8'), lanzados = opcionesVistas.length;
  const r = await equipo({ accion: 'crear', nombre: 'nuevo', carpeta: '~/proyectos/app', modelo: 'haiku', descripcion: ' hola ', color: '#112233', puesto: { zona: 1, i: 0 } });
  assert.equal(r.status, 200);
  const n = leerCfg().agentes.find((a: any) => a.nombre === 'nuevo');
  assert.deepEqual(n, { nombre: 'nuevo', carpeta: realpathSync(join(casa, 'proyectos', 'app')), color: '#112233', modelo: 'haiku', descripcion: 'hola', puesto: { zona: 1, i: 0 } });
  assert.equal(readFileSync(cfgPath + '.bak', 'utf8'), antes);
  assert.ok(!readdirSync(base).some(f => f.includes('.tmp-')), 'sin temporales sueltos');
  const e = await espera(d => d.t === 'estado' && d.agentes.some((a: any) => a.nombre === 'nuevo'));
  assert.deepEqual(e.agentes.find((a: any) => a.nombre === 'nuevo').estado, 'libre');
  assert.equal(opcionesVistas.length, lanzados, 'crear no lanza al agente');
  assert.equal((await equipo({ accion: 'editar', nombre: 'nuevo', puesto: { zona: 0, i: 0 } })).status, 409);
  assert.equal((await equipo({ accion: 'editar', nombre: 'nuevo', color: '#445566', modelo: 'opus', puesto: { zona: 2, i: 3 } })).status, 200);
  assert.deepEqual(leerCfg().agentes.find((a: any) => a.nombre === 'nuevo').puesto, { zona: 2, i: 3 });
  assert.equal((await equipo({ accion: 'editar', nombre: 'nadie' })).status, 404);
  assert.equal((await equipo({ accion: 'quitar', nombre: 'nuevo' })).status, 200);
  assert.ok(!leerCfg().agentes.some((a: any) => a.nombre === 'nuevo'));
  assert.ok(existsSync(join(casa, 'proyectos', 'app')), 'la carpeta no se toca');
  ws.close();
});

test('guardarAtomico y validarCarpeta sueltos', () => {
  const f = join(base, 'atom.json');
  guardarAtomico(f, { v: 1 }); guardarAtomico(f, { v: 2 });
  assert.deepEqual(JSON.parse(readFileSync(f, 'utf8')), { v: 2 });
  assert.deepEqual(JSON.parse(readFileSync(f + '.bak', 'utf8')), { v: 1 });
  assert.deepEqual(validarCarpeta('~/proyectos/otra', casa), { ruta: realpathSync(join(casa, 'proyectos', 'otra')) });
  assert.deepEqual(validarCarpeta(42, casa), { error: 'err_carpeta_abs' });
});

const zona = (body: unknown, h: Record<string, string> = {}) =>
  fetch(`${O}/zonas`, { method: 'POST', body: JSON.stringify(body), headers: { Origin: O, 'X-Token': app.token, 'Content-Type': 'application/json', ...h } });

test('patrones de zona: se rechazan los inválidos, largos y catastróficos', () => {
  for (const p of ['web', 'video|marca', '^back(end)?$']) assert.ok(patronSeguro(p), p);
  for (const p of ['(a+)+$', '(x|y*)*z', '([a-z]+)*!', '(.*)\\1', '[', 'a'.repeat(101)]) assert.ok(!patronSeguro(p), p);
  assert.throws(() => validar({ agentes: [{ nombre: 'a', carpeta: '/x' }], oficina: { zonas: [{ nombre: 'Z', patron: '(a+)+$' }] } }), /inseguro/);
  const l = calcLayout(3, {}, 0, true);
  assert.deepEqual([l.hueco, l.filas[1]], [3, 1]); // el lugar para «Crear zona» abre la 2.ª fila con 1 fila de alto
  assert.equal(calcLayout(6, {}, 0, true).hueco, -1);
});

test('zonas: token, Origin, validación, crear/editar/quitar atómico con .bak y quitar bloqueado si hay agentes', async () => {
  assert.equal((await zona({ accion: 'crear', nombre: 'X', color: '#4b5e9c' }, { 'X-Token': 'malo' })).status, 403);
  assert.equal((await zona({ accion: 'crear', nombre: 'X', color: '#4b5e9c' }, { Origin: 'http://evil.com' })).status, 403);
  const mal = async (b: object, code: number, re: RegExp) => { const r = await zona(b); assert.equal(r.status, code, JSON.stringify(b)); assert.match(await r.text(), re); };
  await mal({ accion: 'crear', nombre: 'x'.repeat(21), color: '#4b5e9c' }, 400, /20 caracteres/);
  await mal({ accion: 'crear', nombre: '  ', color: '#4b5e9c' }, 400, /20 caracteres/);
  await mal({ accion: 'crear', nombre: 'ROJA', color: '#ff0000' }, 400, /paleta/);
  await mal({ accion: 'crear', nombre: 'P', color: '#4b5e9c', patron: '(a+)+$' }, 400, /Patrón/);
  await mal({ accion: 'crear', nombre: 'P', color: '#4b5e9c', contexto: 'x'.repeat(2001) }, 400, /2000/);
  await mal({ accion: 'editar', indice: 9, nombre: 'P' }, 404, /no existe/);
  await mal({ accion: 'quitar', indice: 0 }, 409, /prueba, ocupado/);
  const antes = readFileSync(cfgPath, 'utf8');
  const { ws, espera } = await cliente();
  assert.equal((await zona({ accion: 'crear', nombre: 'WEB NUEVA', color: '#2f7a80', patron: 'web', contexto: 'Sitio en Astro.' })).status, 200);
  assert.equal(readFileSync(cfgPath + '.bak', 'utf8'), antes);
  const cfg = await espera(d => d.t === 'config');
  assert.deepEqual(cfg.oficina.zonas[3], { nombre: 'WEB NUEVA', color: '#2f7a80', patron: 'web', contexto: 'Sitio en Astro.' });
  assert.equal((await zona({ accion: 'crear', nombre: 'OTRA', color: '#3a6a9a' })).status, 200); // índice 4
  assert.equal((await equipo({ accion: 'editar', nombre: 'ocupado', puesto: { zona: 4, i: 0 } })).status, 200);
  assert.equal((await zona({ accion: 'quitar', indice: 3 })).status, 200); // la 4 pasa a ser la 3
  assert.deepEqual(leerCfg().agentes.find((a: any) => a.nombre === 'ocupado').puesto, { zona: 3, i: 0 });
  assert.equal((await zona({ accion: 'editar', indice: 3, nombre: 'OTRA ZONA', patron: '' })).status, 200);
  assert.deepEqual(leerCfg().oficina.zonas.map((z: any) => z.nombre), ['ZONA 1', 'ZONA 2', 'ZONA 3', 'OTRA ZONA']);
  assert.equal((await zona({ accion: 'crear', nombre: 'Z5', color: '#4b5e9c' })).status, 200);
  assert.equal((await zona({ accion: 'crear', nombre: 'Z6', color: '#4b5e9c' })).status, 200);
  await mal({ accion: 'crear', nombre: 'Z7', color: '#4b5e9c' }, 400, /hasta 6/);
  ws.close();
});

test('contexto: el SDK recibe el de la zona y después el del agente, añadido al prompt de Claude Code', async () => {
  assert.equal((await zona({ accion: 'editar', indice: 0, contexto: 'Proyecto web: Astro + Preact.' })).status, 200);
  assert.equal((await equipo({ accion: 'editar', nombre: 'prueba', contexto: 'Usa pnpm, nunca npm.' })).status, 200);
  assert.equal((await equipo({ accion: 'editar', nombre: 'prueba', contexto: 'x'.repeat(2001) })).status, 400);
  const { ws, espera, limpiar } = await cliente();
  ws.send(JSON.stringify({ t: 'cerrar', agente: 'prueba' }));
  await espera(d => d.t === 'estado' && d.agentes.find((a: any) => a.nombre === 'prueba').estado === 'libre');
  limpiar();
  ws.send(JSON.stringify({ t: 'lanzar', agente: 'prueba', sesion: 'nueva' }));
  const e = await espera(d => d.t === 'estado' && d.agentes.find((a: any) => a.nombre === 'prueba').estado === 'esperando');
  assert.equal(e.agentes.find((a: any) => a.nombre === 'prueba').contexto, 'Usa pnpm, nunca npm.');
  const sp = opcionesVistas.at(-1).systemPrompt;
  assert.equal(sp.type, 'preset'); assert.equal(sp.preset, 'claude_code');
  assert.match(sp.append, /^Contexto de la zona «ZONA 1»[^\n]*\nProyecto web: Astro \+ Preact\.\n\nContexto de este agente:\nUsa pnpm, nunca npm\.$/);
  assert.ok(!existsSync(join(carpetaPrueba, 'CLAUDE.md')), 'no se escribe en la carpeta del agente');
  ws.close();
});
