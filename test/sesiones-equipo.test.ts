import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, existsSync, symlinkSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { randomUUID } from 'node:crypto';
import WebSocket from 'ws';
import { request } from 'node:http';
import { propietario, unirSesiones } from '../src/sesiones.ts';
import { descendienteDe } from '../src/agentes.ts';
import { crear } from '../src/servidor.ts';
import { validar } from '../src/config.ts';
import { rutaReglas } from '../src/reglas.ts';
import type { FnQuery } from '../src/chat.ts';

const agente = { nombre: 'uno', carpeta: '/project', color: '#112233', modelo: 'sonnet', descripcion: '', sesion: 'fija' };
test('dedupe: Dirección prevalece por patrón, id o pid; roster por id, nombre y especie; hijos desconocidos ocultos', () => {
  const web = [{ nombre: '_director', sessionId: 'web-dir', pid: 42 }, { nombre: 'uno', sessionId: 'web-uno' }];
  for (const x of [{ nombre: 'lead-2' }, { sesionId: 'web-dir' }, { pid: 42 }]) assert.equal(propietario(x, [agente], web, 'lead-*'), '_director');
  assert.equal(propietario({ nombre: 'lead-2', sesionId: 'fija' }, [agente], web, 'lead-*'), '_director');
  for (const x of [{ sesionId: 'fija' }, { sesionId: 'web-uno' }, { nombre: 'uno' }]) assert.equal(propietario(x, [agente], web), 'uno');
  assert.equal(propietario({ tipo: 'codex', nombre: 'uno' }, [agente], []), undefined);
  const e = unirSesiones({ agentes: [{ tipo: 'claude', propio: true }, { tipo: 'claude', sesionId: 'web-uno', propio: true }, { tipo: 'claude', nombre: 'lead-1' }] }, [agente], web, 'lead-*');
  assert.equal(e.agentes.length, 2); assert.equal(e.agentes[0].nombre, 'uno'); assert.equal(e.agentes[1].directora, true);
  assert.ok(descendienteDe(9, 2, pid => ({ 9: 8, 8: 2 }[pid] ?? -1)));
  assert.equal(descendienteDe(9, 2, () => 9), false);
});
test('config admite roster vacío y rechaza modos peligrosos o motor desconocido', () => {
  assert.deepEqual(validar({ agentes: [] }).agentes, []);
  for (const modoPermisos of ['bypassPermissions', 'dontAsk', 'inventado']) assert.throws(() => validar({ agentes: [{ ...agente, modoPermisos }] }), /modo/);
  assert.throws(() => validar({ agentes: [{ ...agente, motor: 'otro' }] }), /motor/);
});
test('las reglas locales no pueden apuntar fuera del proyecto mediante symlink', () => {
  const base = mkdtempSync(join(tmpdir(), 'reglas-')), proy = join(base, 'proy'), externo = join(base, 'externo');
  mkdirSync(proy); mkdirSync(externo); symlinkSync(externo, join(proy, '.claude'));
  assert.throws(() => rutaReglas(proy), /dentro del proyecto/);
});

test('adoptar, cambiar, soltar, quitar y deshacer conservan sesión, archivos y seguridad HTTP', async () => {
  const base = mkdtempSync(join(tmpdir(), 'adoptar-')), home = join(base, 'home'), carpeta = join(home, 'proyecto');
  mkdirSync(carpeta, { recursive: true });
  const config = join(base, 'oficina.config.copia.json'), sesiones = join(base, 'sesiones'); mkdirSync(sesiones);
  const id = randomUUID(), vivo = randomUUID(), id2 = randomUUID();
  writeFileSync(join(sesiones, `${process.pid}.json`), JSON.stringify({ pid: process.pid, kind: 'interactive', sessionId: vivo, name: 'terminal-suelta', cwd: carpeta, status: 'busy' }));
  const sentinel = join(carpeta, 'transcripcion.jsonl'); writeFileSync(sentinel, 'no borrar');
  writeFileSync(config, JSON.stringify({ agentes: [], coordinacion: { dir: join(base, 'coord') }, director: { nombre: 'General', patronSesion: 'lead-*' } }));
  const opciones: any[] = [];
  const query: FnQuery = ({ prompt, options }) => {
    opciones.push(options);
    const it = (async function* () { for await (const _ of prompt) yield { type: 'result', subtype: 'success', is_error: false } as any; })();
    return Object.assign(it, { interrupt: async () => {}, setPermissionMode: async () => {} }) as any;
  };
  const lista = [{ sessionId: id, customTitle: 'pasada', summary: '', cwd: carpeta, lastModified: 3 }, { sessionId: id2, customTitle: 'lead-2', summary: '', cwd: carpeta, lastModified: 2 }];
  const app = crear({ rutaConfig: config, home, puerto: 18907, query, listar: async () => lista, listarTodas: async () => lista, dirSesiones: sesiones, dirSubidas: join(base, 'subidas'), dirParaDirector: join(base, 'para'), generador: () => ({ agentes: [] }), cupoClaude: false });
  await app.escuchar();
  const origin = 'http://127.0.0.1:18907';
  const post = (body: any, headers = {}) => fetch(origin + '/agentes', { method: 'POST', body: JSON.stringify(body), headers: { Origin: origin, 'X-Token': app.token, ...headers } });
  const cfg = () => JSON.parse(readFileSync(config, 'utf8'));
  const messages: any[] = [];
  const ws = new WebSocket(`ws://127.0.0.1:18907/ws?t=${app.token}`, { headers: { Origin: origin } });
  ws.on('message', m => messages.push(JSON.parse(String(m))));
  await new Promise<void>((r, x) => { ws.once('open', r); ws.once('error', x); });
  const wait = async (f: (m: any) => boolean) => {
    for (let k = 0; k < 200; k++) { const n = messages.findIndex(f); if (n >= 0) return messages.splice(n, 1)[0]; await new Promise(r => setTimeout(r, 10)); }
    throw new Error('timeout WS');
  };
  const data = { accion: 'adoptar', nombre: 'adoptado', sesion: id, puesto: { zona: 0, i: 0 } };
  try {
    assert.equal((await post(data, { 'X-Token': 'incorrecto' })).status, 403);
    assert.equal((await post(data, { Origin: 'http://otro' })).status, 403);
    assert.equal(await new Promise<number>(resolve => { const req = request(origin + '/agentes', { method: 'POST', headers: { Host: 'otro:18907', Origin: origin, 'X-Token': app.token } }, res => { res.resume(); resolve(res.statusCode!); }); req.end(JSON.stringify(data)); }), 403);
    assert.equal((await post({ ...data, sesion: '../escape' })).status, 400);
    assert.equal((await post({ ...data, sesion: id2 })).status, 400);
    ws.send(JSON.stringify({ t: 'adoptables' }));
    const disponibles = await wait(m => m.t === 'adoptables');
    assert.equal(disponibles.vivas[0].sesion, vivo); assert.equal(disponibles.pasadas[0].sesion, id); assert.equal(disponibles.pasadas.length, 1);
    assert.equal((await post(data)).status, 200); assert.equal(cfg().agentes[0].sesion, id); assert.ok(existsSync(config + '.bak'));
    ws.send(JSON.stringify({ t: 'lanzar', agente: 'adoptado', sesion: 'ultima', modo: 'bypassPermissions' }));
    assert.match((await wait(m => m.t === 'error')).s, /modo/i); assert.equal(opciones.length, 0);
    ws.send(JSON.stringify({ t: 'lanzar', agente: 'adoptado', sesion: 'ultima' }));
    await wait(m => m.t === 'estado' && m.agentes.some((a: any) => a.estado === 'esperando'));
    assert.equal(opciones.at(-1).resume, id);
    ws.send(JSON.stringify({ t: 'modo', agente: 'adoptado', modo: 'acceptEdits' }));
    await wait(m => m.t === 'estado' && m.agentes.some((a: any) => a.modo === 'acceptEdits'));
    assert.equal(cfg().agentes[0].modoPermisos, 'acceptEdits');
    assert.equal((await post({ accion: 'editar', nombre: 'adoptado', sesion: id2 })).status, 400);
    const soltado = await (await post({ accion: 'editar', nombre: 'adoptado', sesion: null })).json();
    assert.equal(cfg().agentes[0].sesion, undefined); assert.ok(soltado.deshacer);
    assert.equal((await post({ accion: 'deshacer', id: soltado.deshacer })).status, 200); assert.equal(cfg().agentes[0].sesion, id);
    const quitado = await (await post({ accion: 'quitar', nombre: 'adoptado' })).json();
    assert.equal(cfg().agentes.length, 0); assert.equal(readFileSync(sentinel, 'utf8'), 'no borrar');
    assert.equal((await post({ accion: 'deshacer', id: quitado.deshacer })).status, 200); assert.equal(cfg().agentes[0].sesion, id);
    assert.equal((await post({ accion: 'deshacer', id: quitado.deshacer })).status, 404);
    assert.equal((await post({ accion: 'editar', nombre: 'adoptado', sesion: vivo })).status, 200);
    ws.send(JSON.stringify({ t: 'lanzar', agente: 'adoptado', sesion: 'ultima' }));
    assert.match((await wait(m => m.t === 'error')).s, /terminal/);
    assert.doesNotThrow(() => process.kill(process.pid, 0));
  } finally { ws.terminate(); await app.cerrar(); }
});
