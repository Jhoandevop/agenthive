import { patronARegex, type Agente } from './config.ts';

// La propiedad de una sesión se decide una sola vez y con Dirección primero.
export function propietario(x: { nombre?: string; sesionId?: string; pid?: number; tipo?: string }, roster: Agente[], web: { nombre: string; sessionId?: string; pid?: number }[], patron?: string) {
  const director = patron && patronARegex(patron).test(x.nombre ?? '');
  const propia = web.find(s => (x.sesionId && s.sessionId === x.sesionId) || (x.pid && s.pid === x.pid));
  if (director || propia?.nombre === '_director') return '_director';
  if (propia) return propia.nombre;
  return roster.find(a => (a.motor ?? 'claude') === (x.tipo ?? 'claude') && ((a.sesion && a.sesion === x.sesionId) || a.nombre === x.nombre))?.nombre;
}

export function unirSesiones(e: any, roster: Agente[], web: { nombre: string; sessionId?: string; pid?: number }[], patron?: string) {
  if (!e || !Array.isArray(e.agentes)) return e;
  return { ...e, agentes: e.agentes.flatMap((x: any) => {
    if (!['claude', 'codex'].includes(x?.tipo) || x.bucle) return [x];
    const n = propietario(x, roster, web, x.tipo === 'claude' ? patron : undefined);
    if (n) return [{ ...x, nombre: n === '_director' ? x.nombre : n, directora: n === '_director' }];
    return x.propio ? [] : [x];
  }) };
}
