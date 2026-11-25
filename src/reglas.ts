import { existsSync, realpathSync, readFileSync, statSync } from 'node:fs';
import { join, relative, isAbsolute } from 'node:path';

// Impide que .claude o settings.local.json enlacen a configuración fuera del proyecto.
export function rutaReglas(carpeta: string) {
  const raiz = realpathSync(carpeta), dir = join(raiz, '.claude'), f = join(dir, 'settings.local.json');
  for (const p of [dir, f]) if (existsSync(p)) {
    const rel = relative(raiz, realpathSync(p));
    if (!rel || rel === '..' || rel.startsWith('../') || isAbsolute(rel)) throw new Error('La configuración local debe estar dentro del proyecto');
  }
  return f;
}
export function reglasProyecto(carpeta: string): string[] {
  const f = rutaReglas(carpeta);
  if (!existsSync(f)) return [];
  if (statSync(f).size > 1024 * 1024) throw new Error('Configuración local demasiado grande');
  const j = JSON.parse(readFileSync(f, 'utf8'));
  return Array.isArray(j?.permissions?.allow) ? j.permissions.allow.filter((x: unknown) => typeof x === 'string') : [];
}
