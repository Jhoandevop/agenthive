// Fixtures de protocolo y /proc simulado: nunca lanza codex exec anidado ni lee credenciales.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, symlinkSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { EventEmitter } from 'node:events';
import { PassThrough } from 'node:stream';
import type { ChildProcessWithoutNullStreams } from 'node:child_process';
import { argumentosCodex, detectarCodex, listarRolloutsCodex, procesosCodex, SesionCodex, type SpawnCodex } from '../src/codex.ts';
import type { Ev } from '../src/chat.ts';

const SID = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const agente = { nombre: 'hormiga', carpeta: '/tmp/proyecto', modelo: 'gpt-6.1-sol', descripcion: '', color: '#112233' };

test('Codex: argumentos fijos, sandbox limitado y resume exacto sin shell', () => {
  for (const sandbox of ['workspace-write', 'read-only']) {
    const args = argumentosCodex({ modelo: 'gpt-6.1-sol', sandbox, resume: SID, esfuerzo: 'medium' });
    assert.deepEqual(args.slice(0, 4), ['--sandbox', sandbox, '--ask-for-approval', 'never']);
    assert.ok(args.includes('--json'));
    assert.deepEqual(args.slice(-3), ['resume', SID, '-']);
    assert.ok(!args.some(x => /danger|bypass|trust/.test(x)));
  }
  for (const sandbox of ['danger-full-access', 'off', '', '--dangerously-bypass-approvals-and-sandbox']) {
    assert.throws(() => argumentosCodex({ modelo: '', sandbox }), /Sandbox/);
  }
  assert.throws(() => argumentosCodex({ modelo: '', resume: '../../auth.json' }), /Sesión/);
});

function proceso(proc: string, pid: number, ppid: number, cwd: string, args: string[]) {
  const d = join(proc, String(pid)); mkdirSync(d);
  writeFileSync(join(d, 'cmdline'), args.join('\0') + '\0');
  const campos = ['S', String(ppid), ...Array(17).fill('0'), '200'];
  writeFileSync(join(d, 'stat'), `${pid} (codex test) ${campos.join(' ')}`);
  symlinkSync(cwd, join(d, 'cwd'));
}
test('Codex: /proc detecta nativo, exec y wrapper, une padre/hijo y no falsos positivos', () => {
  const proc = mkdtempSync(join(tmpdir(), 'codex-proc-'));
  writeFileSync(join(proc, 'stat'), 'cpu 0\nbtime 1000\n');
  proceso(proc, 10, 1, '/tmp/a', ['/usr/bin/node', '/usr/bin/codex.js']);
  proceso(proc, 11, 10, '/tmp/a', ['/opt/bin/codex', 'exec', '--json']);
  proceso(proc, 12, 1, '/tmp/b', ['codex', 'resume', SID]);
  proceso(proc, 13, 1, '/tmp/c', ['bash', '-c', 'codex exec']);
  proceso(proc, 14, 1, '/tmp/c', ['/opt/bin/other-codex-monitor']);
  const ps = procesosCodex(proc, 2_000_000);
  assert.deepEqual(ps.map(p => p.pid), [11, 12]);
  assert.equal(ps[0].cwd, '/tmp/a');
  assert.equal(ps[0].inicio, 1_002_000);
  assert.equal(ps[0].ppid, 10);
});

test('Codex: rollouts recientes, modelo y tarea tapada; ignora auth, symlinks y JSON roto', () => {
  const home = mkdtempSync(join(tmpdir(), 'codex-home-')), dir = join(home, '.codex', 'sessions', '2026', '11', '25');
  mkdirSync(dir, { recursive: true });
  // No son JSON: leer credenciales o seguir el enlace no aporta metadatos de sesión válidos.
  writeFileSync(join(home, '.codex', 'auth.json'), 'NO SE LEE');
  writeFileSync(join(dir, 'auth.json'), 'NO SE LEE');
  const now = Date.now();
  const lineas = [
    { type: 'session_meta', timestamp: new Date(now - 5000).toISOString(), payload: { id: SID, cwd: '/tmp/a' } },
    { type: 'turn_context', payload: { model: 'gpt-6.1-sol' } },
    { type: 'event_msg', payload: { type: 'user_message', message: 'Revisar correo maria@example.com y contraseña: secreto' } },
    { type: 'event_msg', payload: { type: 'task_complete' } },
  ];
  writeFileSync(join(dir, 'rollout-test.jsonl'), lineas.map(x => JSON.stringify(x)).join('\n') + '\n{rota\n');
  symlinkSync(join(dir, 'rollout-test.jsonl'), join(dir, 'rollout-enlace.jsonl'));
  const rollouts = listarRolloutsCodex(home);
  assert.equal(rollouts.length, 1);
  assert.equal(rollouts[0].modelo, 'gpt-6.1-sol');
  assert.equal(rollouts[0].pedido, 'Revisar correo [correo] y contraseña [oculto]');
  assert.equal(rollouts[0].vuelta, 1);
  const proc = join(home, 'proc'); mkdirSync(proc);
  proceso(proc, 22, 1, '/tmp/a', ['codex', 'exec', 'resume', SID]);
  const filas = detectarCodex({ home, procRoot: proc, now });
  assert.equal(filas.length, 1, 'la sesión con proceso no sale también como reciente');
  assert.equal(filas[0].sesionId, SID);
  assert.equal(filas[0].tipo, 'codex');
  assert.match(filas[0].pedido, /\[correo\]/);
  assert.equal(detectarCodex({ home, procRoot: join(home, 'no-proc'), now })[0].estado, 'idle');
});

function mockSpawn() {
  const llamados: { cmd: string; args: string[]; op: any; child: ChildProcessWithoutNullStreams; prompt: () => string }[] = [];
  const spawn: SpawnCodex = (cmd, args, op) => {
    const child: any = new EventEmitter();
    child.pid = 123; child.killed = false;
    child.stdin = new PassThrough(); child.stdout = new PassThrough(); child.stderr = new PassThrough();
    let prompt = ''; child.stdin.on('data', (x: Buffer) => { prompt += x.toString(); });
    child.kill = (signal: string) => { child.killed = true; queueMicrotask(() => child.emit('close', null, signal)); return true; };
    llamados.push({ cmd, args, op, child, prompt: () => prompt });
    return child;
  };
  return { spawn, llamados };
}

test('Codex: chat traduce fixture JSON fragmentado, guarda thread y retoma el próximo turno', async () => {
  const mock = mockSpawn(), eventos: Ev[] = [];
  const s = new SesionCodex(agente, { spawn: mock.spawn, emitir: (_n, ev) => eventos.push(ev), cambio() {} });
  await s.lanzar({ modelo: agente.modelo, modo: 'default', contexto: 'Reglas del proyecto' });
  assert.equal(s.viva, true);
  assert.equal(s.estado, 'esperando');
  assert.match(String(eventos[0].s), /sin aprobaciones interactivas/);
  s.enviar('Ejecuta pruebas', []);
  const c = mock.llamados[0];
  assert.equal(c.op.cwd, agente.carpeta);
  assert.equal(c.cmd, 'codex');
  assert.equal(c.prompt(), 'Reglas del proyecto\n\nEjecuta pruebas');
  const fixture = readFileSync(join(import.meta.dirname, 'fixtures', 'codex-exec.jsonl'), 'utf8');
  c.child.stdout.emit('data', fixture.slice(0, 50));
  c.child.stdout.emit('data', fixture.slice(50));
  c.child.emit('close', 0);
  assert.equal(s.sessionId, SID);
  assert.equal(s.estado, 'esperando');
  assert.ok(eventos.some(e => e.k === 'texto' && e.s === 'Pruebas completas.'));
  assert.ok(eventos.some(e => e.k === 'herramienta' && e.nombre === 'Bash'));
  assert.ok(eventos.some(e => e.k === 'resultado-herr' && e.s === 'tests passed'));
  assert.ok(eventos.some(e => e.k === 'archivo' && e.ruta === 'report.md'));
  const fin = eventos.find(e => e.k === 'fin')!;
  assert.equal(fin.entrada, 100); assert.equal(fin.salida, 20); assert.equal(fin.costoDesconocido, true);
  s.enviar('Otra vuelta', []);
  assert.deepEqual(mock.llamados[1].args.slice(-3), ['resume', SID, '-']);
  assert.equal(mock.llamados[1].prompt(), 'Otra vuelta');
  await s.detener();
  assert.equal(s.estado, 'esperando');
  await s.cerrar(); assert.equal(s.viva, false);
});

test('Codex: plan usa read-only, no acepta bypass ni auto y reporta errores del proceso', async () => {
  const mock = mockSpawn(), eventos: Ev[] = [];
  const s = new SesionCodex(agente, { spawn: mock.spawn, emitir: (_n, e) => eventos.push(e), cambio() {} });
  for (const modo of ['bypassPermissions', 'auto', 'acceptEdits', 'dontAsk']) {
    await assert.rejects(s.lanzar({ modelo: '', modo: modo as any }), /solo default/);
  }
  await s.lanzar({ modelo: '', modo: 'plan' }); s.enviar('revisa', []);
  assert.equal(mock.llamados[0].args[1], 'read-only');
  await assert.rejects(s.cambiarModo('default'), /detén el turno/);
  mock.llamados[0].child.stderr.emit('data', 'Error: permiso denegado');
  mock.llamados[0].child.emit('close', 1);
  assert.ok(eventos.some(e => e.k === 'fin' && /permiso denegado/.test(String(e.error))));
  await s.cerrar();
});
