// El equipo fijo: puestos persistentes, validación de carpetas al crear agentes y escritura atómica de la config.
import { realpathSync, statSync, writeFileSync, renameSync, copyFileSync, existsSync } from 'node:fs';
import { basename, isAbsolute, relative, resolve, sep } from 'node:path';
import type { Agente, Config, Puesto } from './config.ts';

const clave = (p: Puesto) => `${p.zona}:${p.i}`;

// Zona por defecto de un agente sin puesto: su "zona" si la trae; si no, la primera cuyo patrón coincida con
// nombre + carpeta; si no, la primera zona sin patrón. Es la misma regla que usaba la oficina para adivinar.
export function zonaAdivinada(a: Agente, zonas: Config['oficina']['zonas']) {
  if (a.zona !== undefined && a.zona < zonas.length) return a.zona;
  const n = (a.nombre + ' ' + basename(a.carpeta)).toLowerCase();
  for (let i = 0; i < zonas.length; i++) if (zonas[i].patron && new RegExp(zonas[i].patron!, 'i').test(n)) return i;
  const d = zonas.findIndex(z => !z.patron);
  return d < 0 ? Math.min(1, zonas.length - 1) : d;
}

// Da puesto a quien no lo tiene (o lo tiene repetido) sin mover a nadie que ya tenga uno válido.
// Modifica `crudo.agentes` (lo que se guarda) y `config.agentes` (lo que se usa). Devuelve si hubo cambios.
export function asignarPuestos(crudo: any, config: Config) {
  const usados = new Set<string>(), faltan: number[] = [];
  config.agentes.forEach((a, k) => { if (a.puesto && !usados.has(clave(a.puesto))) usados.add(clave(a.puesto)); else faltan.push(k); });
  for (const k of faltan) {
    const a = config.agentes[k], zona = zonaAdivinada(a, config.oficina.zonas);
    let i = 0;
    while (usados.has(`${zona}:${i}`)) i++;
    a.puesto = { zona, i };
    crudo.agentes[k].puesto = { zona, i };
    usados.add(`${zona}:${i}`);
  }
  return faltan.length > 0;
}

export const puestoLibre = (config: Config, p: Puesto, salvo?: string) =>
  !config.agentes.some(a => a.nombre !== salvo && a.puesto && a.puesto.zona === p.zona && a.puesto.i === p.i);

// Carpeta para un agente nuevo: debe existir, ser carpeta, estar DENTRO de home (no home misma) y no tener
// ningún tramo oculto (.ssh, .claude, .config, .codex, .gnupg, .local/share/keyrings…). Se resuelven los enlaces
// simbólicos antes de mirar. Devuelve la ruta real o la clave del error.
export function validarCarpeta(entrada: unknown, home: string): { ruta: string } | { error: string } {
  if (typeof entrada !== 'string' || !entrada.trim() || entrada.length > 500) return { error: 'err_carpeta_abs' };
  const p = entrada.trim().replace(/^~(?=$|[\\/])/, home);
  if (!isAbsolute(p)) return { error: 'err_carpeta_abs' };
  let real: string, casa: string;
  try { real = realpathSync(resolve(p)); casa = realpathSync(home); } catch { return { error: 'err_carpeta_no' }; }
  if (!statSync(real).isDirectory()) return { error: 'err_carpeta_nodir' };
  const rel = relative(casa, real);
  if (!rel || rel.startsWith('..') || isAbsolute(rel)) return { error: 'err_carpeta_fuera' };
  if (rel.split(sep).some(t => t.startsWith('.'))) return { error: 'err_carpeta_oculta' };
  return { ruta: real };
}

// Escribe en un temporal junto al destino y lo renombra (atómico en el mismo disco). Antes guarda una copia .bak.
export function guardarAtomico(ruta: string, datos: unknown) {
  const tmp = `${ruta}.tmp-${process.pid}`;
  writeFileSync(tmp, JSON.stringify(datos, null, 2) + '\n', { mode: 0o600 });
  if (existsSync(ruta)) { copyFileSync(ruta, tmp + '.bak'); renameSync(tmp + '.bak', ruta + '.bak'); }
  renameSync(tmp, ruta);
}
