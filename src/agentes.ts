// Sesiones de Claude Code vivas en una terminal (las que la web nunca toma).
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { execFileSync } from 'node:child_process';
import { homedir } from 'node:os';

export type EnTerminal = { pid: number; nombre: string; cwd: string; estado: string; sessionId: string; inicio: number };

// Padre de un proceso: /proc en Linux, `ps` en macOS; en Windows no se sabe (-1).
export function padreDe(pid: number) {
  try {
    if (process.platform === 'linux') return Number(readFileSync(`/proc/${pid}/stat`, 'utf8').split(') ')[1].split(' ')[1]);
    if (process.platform !== 'win32') return Number(execFileSync('ps', ['-o', 'ppid=', '-p', String(pid)], { encoding: 'utf8' }).trim());
  } catch { /* proceso ya no existe */ }
  return -1;
}
export function descendienteDe(pid: number, ancestro = process.pid, padre = padreDe) {
  const vistos = new Set<number>();
  for (let i = 0; pid > 1 && i < 64 && !vistos.has(pid); i++) {
    vistos.add(pid); pid = padre(pid);
    if (pid === ancestro) return true;
  }
  return false;
}
const vivo = (pid: number) => { try { process.kill(pid, 0); return true; } catch (e) { return (e as NodeJS.ErrnoException).code === 'EPERM'; } };

// Solo lee los ~/.claude/sessions/<pid>.json (metadatos pequeños). Nunca los .key ni credenciales.
export function sesionesEnTerminal(dir = join(homedir(), '.claude', 'sessions')): EnTerminal[] {
  let archivos: string[] = [];
  try { archivos = readdirSync(dir).filter(f => /^\d+\.json$/.test(f)); } catch { return []; }
  const vivas: EnTerminal[] = [];
  for (const f of archivos) {
    try {
      const p = join(dir, f);
      if (statSync(p).size > 64 * 1024) continue;
      const d = JSON.parse(readFileSync(p, 'utf8'));
      const pid = Number(d.pid);
      if (d.kind !== 'interactive' || !Number.isInteger(pid) || !vivo(pid) || descendienteDe(pid)) continue; // los hijos propios (SDK) no son terminales
      vivas.push({ pid, nombre: String(d.name ?? ''), cwd: String(d.cwd ?? ''), estado: String(d.status ?? 'idle'), sessionId: String(d.sessionId ?? ''), inicio: Number(d.startedAt) || 0 });
    } catch { /* archivo a medio escribir: se ignora en esta vuelta */ }
  }
  return vivas;
}
