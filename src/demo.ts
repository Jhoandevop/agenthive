// Modo demo (--demo): agentes, eventos y respuestas falsos. No lee ~/.claude ni llama a Claude.
// Sirve para probar la interfaz y sacar capturas sin mostrar proyectos reales.
import { mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { randomUUID } from 'node:crypto';
import { validar, type Config } from './config.ts';
import type { FnQuery } from './chat.ts';

export const DIR_DEMO = join(tmpdir(), 'agenthive-demo'); // fuera del repo: las capturas no muestran rutas personales
export const configDemo = (raiz: string): Config => validar(crudoDemo(), raiz);

export function crudoDemo(): any {
  const d = DIR_DEMO;
  return {
    titulo: 'AgentHive', idioma: 'auto', puerto: 8890,
    agentes: [
      { nombre: 'backend', carpeta: join(d, 'agentes', 'backend'), color: '#7aa2f7', modelo: 'sonnet', descripcion: 'APIs and database.', zona: 0 },
      { nombre: 'frontend', carpeta: join(d, 'agentes', 'frontend'), color: '#f7768e', modelo: 'sonnet', descripcion: 'Pages and styles.', zona: 0 },
      { nombre: 'docs', carpeta: join(d, 'agentes', 'docs'), color: '#9ece6a', modelo: 'haiku', descripcion: 'Guides and docs.', zona: 1 },
      { nombre: 'qa', carpeta: join(d, 'agentes', 'qa'), color: '#e0af68', modelo: 'haiku', descripcion: 'Tests.', zona: 1 },
    ],
    director: { nombre: 'Lead', patronSesion: 'lead-*', carpeta: join(d, 'agentes', 'lead'), modelo: 'sonnet' },
    coordinacion: { dir: join(d, 'coordinacion') },
    oficina: {
      zonas: [{ nombre: 'PRODUCT' }, { nombre: 'DOCS QA' }, { nombre: 'DESIGN', patron: 'design' }],
      carteles: [{ texto: 'SHIP IT', fondo: '#0c6b4a', color: '#ffffff' }, { texto: 'IDEAS', fondo: '#3a2f6c', color: '#ffd98a' }, { texto: 'TEAM', fondo: '#26304a', color: '#ffffff' }],
      tv: 'NEWS',
    },
  };
}

export function sembrarDemo(c: Config) {
  for (const a of [...c.agentes.map(a => a.carpeta), c.director!.carpeta!]) {
    mkdirSync(a, { recursive: true });
    writeFileSync(join(a, 'README.md'), '# Demo project\n\nThis folder belongs to a demo agent.\n');
  }
  const dir = c.coordinacion.dir;
  rmSync(dir, { recursive: true, force: true });
  mkdirSync(dir, { recursive: true });
  const ts = Date.now();
  writeFileSync(join(dir, 'preguntas.jsonl'), JSON.stringify({ id: 'demo-q1', ts, de: 'Lead', texto: 'Ship the new onboarding on Friday?', estado: 'pendiente', opciones: ['Yes', 'Wait a week'] }) + '\n');
  writeFileSync(join(dir, 'general.jsonl'), JSON.stringify({ id: 'demo-g1', ts: ts - 60_000, texto: 'Morning! The **release checklist** is ready. Two tests are still flaky.' }) + '\n');
  writeFileSync(join(dir, 'buzon.jsonl'), JSON.stringify({ id: 'demo0001', ts: ts - 120_000, to: 'Lead', texto: 'Can you review the release plan?', estado: 'entregado' }) + '\n');
}

// Estado falso: dos sesiones fuera del equipo fijo, un temporal, una reunión cada dos minutos y la batería.
export function estadoDemo() {
  const h = () => new Date().toTimeString().slice(0, 5);
  const feed = [{ h: h(), tipo: 'llego', n: 'designer' }, { h: h(), tipo: 'trabajando', n: 'researcher' }, { h: h(), tipo: 'termino', n: 'designer' }];
  return () => {
    const ahora = Date.now(), min = Math.floor(ahora / 60_000);
    return {
      agentes: [
        { id: 'demo-1', tipo: 'claude', nombre: 'designer', estado: min % 2 ? 'busy' : 'idle', detalle: 'design-system', pedido: 'Draft three ideas for the empty state', updatedAt: ahora, desde: ahora - 90_000, directora: false },
        { id: 'demo-2', tipo: 'claude', nombre: 'researcher', estado: 'busy', detalle: 'market', pedido: 'Compare five pricing pages', updatedAt: ahora, desde: ahora - 300_000, directora: false },
      ],
      temporales: [{ id: 'demo-t1', padre: 'researcher', tarea: 'Check accessibility', tipo: 'general-purpose', modelo: 'haiku', estado: 'trabajando', hace: 40 }],
      reuniones: min % 2 ? [] : [{ de: 'researcher', para: 'designer', tema: 'Pricing review', ts: Math.floor(ahora / 1000) - 10 }],
      cupo: { codex: { usado: 42, renueva: Math.floor(ahora / 1000) + 3 * 3600, semana: 31, renueva_semana: Math.floor(ahora / 1000) + 3 * 86400, visto: Math.floor(ahora / 1000) }, claude: null },
      feed, generado: ahora,
    };
  };
}

const espera = (ms: number) => new Promise(r => setTimeout(r, ms));

// query() falso: responde por partes, pide permiso para escribir un archivo de verdad (para ver «Resultados»)
// y, si se le pide una pregunta, usa AskUserQuestion.
export const queryDemo: FnQuery = ({ prompt, options }) => {
  const sid = randomUUID();
  let costo = 0, n = 0;
  const it = (async function* () {
    for await (const m of prompt) {
      yield { type: 'system', subtype: 'init', session_id: sid, model: 'demo', permissionMode: options.permissionMode, apiKeySource: 'none' } as any;
      const c: any = m.message.content, texto: string = c.find((b: any) => b.type === 'text')?.text ?? '';
      const t0 = Date.now();
      const decir = async function* (s: string) {
        for (const w of s.split(/(?<= )/)) { yield { type: 'stream_event', parent_tool_use_id: null, event: { type: 'content_block_delta', delta: { type: 'text_delta', text: w } } } as any; await espera(35); }
        yield { type: 'assistant', parent_tool_use_id: null, message: { content: [{ type: 'text', text: s }] } } as any;
      };
      if (/\b(ask|pregunt)/i.test(texto)) {
        const q = { questions: [{ question: 'Which color for the button?', header: 'Color', multiSelect: false, options: [{ label: 'Blue', description: 'Calm' }, { label: 'Green', description: 'Positive' }] }] };
        yield { type: 'assistant', parent_tool_use_id: null, message: { content: [{ type: 'tool_use', id: 'ask' + ++n, name: 'AskUserQuestion', input: q }] } } as any;
        const d: any = await options.canUseTool!('AskUserQuestion', q, { signal: new AbortController().signal } as any);
        yield { type: 'user', parent_tool_use_id: null, message: { content: [{ type: 'tool_result', tool_use_id: 'ask' + n, content: JSON.stringify(d.updatedInput?.answers ?? {}), is_error: d.behavior !== 'allow' }] } } as any;
        yield* decir(d.behavior === 'allow' ? `Great, going with **${Object.values(d.updatedInput?.answers ?? {})[0]}**.` : 'Okay, I will not ask again.');
      } else {
        yield* decir('Sure. I will write a short draft and save it in my folder.');
        const html = /html|page|página/i.test(texto), archivo = join(options.cwd!, html ? 'demo.html' : 'report.md');
        const contenido = html
          ? '<!doctype html><title>Demo</title><style>body{font:16px system-ui;margin:2rem;background:#fef6e4}</style><h1>Hello from the demo agent</h1><p id=t></p><script>let i=0;setInterval(()=>t.textContent="Ticks: "+(++i),500)</script>'
          : '# Weekly report\n\n- Onboarding: **ready for review**\n- Tests: 2 flaky\n\n```js\nconsole.log("demo");\n```\n';
        const input = { file_path: archivo, content: contenido }, id = 'w' + ++n;
        yield { type: 'assistant', parent_tool_use_id: null, message: { content: [{ type: 'tool_use', id, name: 'Write', input }] } } as any;
        const d: any = await options.canUseTool!('Write', input, { signal: new AbortController().signal, title: `Write ${archivo}` } as any);
        if (d.behavior === 'allow') writeFileSync(archivo, contenido);
        yield { type: 'user', parent_tool_use_id: null, message: { content: [{ type: 'tool_result', tool_use_id: id, content: d.behavior === 'allow' ? `File created: ${archivo}` : d.message, is_error: d.behavior !== 'allow' }] } } as any;
        yield* decir(d.behavior === 'allow' ? `Done: \`${archivo.split(/[\\/]/).pop()}\` is in **Outputs**.` : 'No problem, I did not write anything.');
      }
      costo += 0.0042;
      yield { type: 'result', subtype: 'success', is_error: false, total_cost_usd: costo, usage: { input_tokens: 1200, output_tokens: 180 }, duration_ms: Date.now() - t0 } as any;
    }
  })();
  return Object.assign(it, { interrupt: async () => undefined, setPermissionMode: async () => undefined }) as any;
};
