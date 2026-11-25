import { test } from 'node:test';
import assert from 'node:assert/strict';
import { cupoDeEvento, cupoDeUsage, cupoDeError } from '../src/cupo.ts';
import { Permisos, type Ev } from '../src/chat.ts';
import type { PermissionUpdate } from '@anthropic-ai/claude-agent-sdk';

test('cupo: eventos del SDK son fracciones; semana de modelo y overage no sustituyen semana general', () => {
  assert.deepEqual(cupoDeEvento({ rateLimitType: 'five_hour', utilization: .42, resetsAt: 1800000000 }), { fuente: 'evento', usado: 42, renueva: 1800000000 });
  assert.deepEqual(cupoDeEvento({ rateLimitType: 'seven_day', utilization: 1 }), { fuente: 'evento', semana: 100 });
  assert.deepEqual(cupoDeEvento({ rateLimitType: 'five_hour', utilization: 0 }), { fuente: 'evento', usado: 0 });
  for (const rateLimitType of ['seven_day_opus', 'seven_day_sonnet', 'overage', 'unknown']) assert.equal(cupoDeEvento({ rateLimitType, utilization: .6 }), null);
  for (const utilization of [null, NaN, Infinity, -1, 1.01, '0.5']) assert.equal(cupoDeEvento({ rateLimitType: 'five_hour', utilization }), null);
  assert.equal(cupoDeEvento(null), null);
});

test('cupo: /usage contiene porcentajes, datos ausentes no se convierten en cero', () => {
  const u = { rate_limits_available: true, rate_limits: { five_hour: { utilization: 1, resets_at: '2026-11-25T18:30:00Z' }, seven_day: { utilization: 44.5, resets_at: null } } };
  assert.deepEqual(cupoDeUsage(u), { fuente: 'usage', usado: 1, semana: 44.5, renueva: Date.parse('2026-11-25T18:30:00Z') / 1000 });
  assert.equal(cupoDeUsage({ ...u, rate_limits_available: false }), null);
  assert.equal(cupoDeUsage({ rate_limits_available: true, rate_limits: { five_hour: { utilization: null, resets_at: null } } }), null);
  assert.equal(cupoDeUsage({ rate_limits_available: true, rate_limits: { five_hour: { utilization: 101, resets_at: 'tomorrow' } } }), null);
});

test('cupo: texto de límite conserva hora literal sin inventar porcentaje ni zona', () => {
  assert.deepEqual(cupoDeError("You've hit your 5-hour limit · resets 3pm (America/Bogota)"), { fuente: 'error', limiteAlcanzado: 'five_hour', renuevaTexto: '3pm (America/Bogota)' });
  assert.deepEqual(cupoDeError("You've hit your weekly limit · resets 2026-11-30T10:00:00-05:00"), { fuente: 'error', limiteAlcanzado: 'seven_day', renuevaTexto: '2026-11-30T10:00:00-05:00', renueva_semana: Date.parse('2026-11-30T10:00:00-05:00') / 1000 });
  assert.equal(cupoDeError('Request failed: overloaded'), null);
});

async function pedir(herramienta: string, entrada: Record<string, unknown>, suggestions?: PermissionUpdate[]) {
  const tarjetas: Ev[] = [], p = new Permisos((_a, ev) => tarjetas.push(ev), 1000);
  const resultado = p.pedir('ana', herramienta, entrada, { signal: new AbortController().signal, suggestions });
  const tarjeta = tarjetas[0]!;
  return { p, resultado, tarjeta };
}

test('permisos: confirmación conserva regla exacta del SDK pero fija destino session/localSettings', async () => {
  for (const [siempre, destination] of [['sesion', 'session'], ['proyecto', 'localSettings']] as const) {
    const regla = { toolName: 'Bash', ruleContent: 'npm test:*' };
    const { p, resultado, tarjeta } = await pedir('Bash', { command: 'npm test' }, [{ type: 'addRules', rules: [regla], behavior: 'allow', destination: 'userSettings' }]);
    assert.deepEqual(tarjeta.reglas, ['Bash(npm test:*)']);
    assert.equal(p.decidir('otro', String(tarjeta.id), true, '', undefined, siempre), false);
    assert.deepEqual(p.decidir('ana', String(tarjeta.id), true, '', undefined, siempre), { reglas: ['Bash(npm test:*)'], siempre });
    assert.deepEqual(await resultado, { behavior: 'allow', updatedInput: { command: 'npm test' }, updatedPermissions: [{ type: 'addRules', rules: [regla], behavior: 'allow', destination }] });
  }
});

test('permisos: comandos compuestos, largos y rutas patrón no crean permisos amplios por inferencia', async () => {
  for (const command of ['ls; rm -rf output', 'ls && echo ok', 'echo $(pwd)', 'cat *.txt', 'echo hi\nls', 'echo ' + 'a'.repeat(200)]) {
    const { p, resultado, tarjeta } = await pedir('Bash', { command });
    assert.deepEqual(tarjeta.reglas, [], command);
    p.decidir('ana', String(tarjeta.id), true, '', undefined, 'proyecto');
    assert.deepEqual(await resultado, { behavior: 'allow', updatedInput: { command } });
  }
  const { p, resultado, tarjeta } = await pedir('Edit', { file_path: '/tmp/[all]*.md' });
  assert.deepEqual(tarjeta.reglas, []);
  p.cancelarDe('ana', 'terminado');
  assert.deepEqual(await resultado, { behavior: 'deny', message: 'terminado' });
});

test('permisos: preguntas y planes nunca agregan reglas; rechazo con answers sigue siendo rechazo', async () => {
  for (const herramienta of ['AskUserQuestion', 'ExitPlanMode']) {
    const { p, resultado, tarjeta } = await pedir(herramienta, {}, [{ type: 'addRules', rules: [{ toolName: herramienta }], behavior: 'allow', destination: 'userSettings' }]);
    assert.deepEqual(tarjeta.reglas, []);
    p.decidir('ana', String(tarjeta.id), false, 'no', { Color: 'Azul' }, 'proyecto');
    assert.deepEqual(await resultado, { behavior: 'deny', message: 'no' });
  }
});

test('permisos: señal ya cancelada no deja tarjetas ni espera timeout', async () => {
  const ac = new AbortController(); ac.abort();
  const p = new Permisos(() => assert.fail('no debe emitir tarjeta'), 1000);
  assert.equal((await p.pedir('ana', 'Bash', { command: 'ls' }, { signal: ac.signal })).behavior, 'deny');
  assert.deepEqual(p.todas(), []);
});
