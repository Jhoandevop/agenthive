// Fuentes estructuradas reales del SDK instalado. Ningún lector de credenciales.
// SDKRateLimitInfo.utilization usa fracción; SDKControlGetUsageResponse usa porcentaje.
export type CupoClaude = {
  usado?: number; renueva?: number; semana?: number; renueva_semana?: number;
  fuente: 'evento' | 'usage' | 'error';
  limiteAlcanzado?: 'five_hour' | 'seven_day'; renuevaTexto?: string;
};
const objeto = (x: unknown): Record<string, unknown> => x && typeof x === 'object' && !Array.isArray(x) ? x as Record<string, unknown> : {};
const porcentaje = (n: unknown) => typeof n === 'number' && Number.isFinite(n) && n >= 0 && n <= 100 ? n : undefined;
const segundos = (n: unknown) => typeof n === 'number' && Number.isFinite(n) && n > 0 ? Math.floor(n > 1e12 ? n / 1000 : n) : undefined;
// No interpretamos horas sin fecha/zona, ni fechas ambiguas en idioma local.
const fechaISO = (s: unknown) => typeof s === 'string' && /^\d{4}-\d\d-\d\dT\d\d:\d\d(?::\d\d(?:\.\d+)?)?(?:Z|[+-]\d\d:\d\d)$/.test(s)
  ? segundos(Date.parse(s)) : undefined;

export function cupoDeEvento(info: unknown): CupoClaude | null {
  const i = objeto(info), semanal = i.rateLimitType === 'seven_day';
  if (!semanal && i.rateLimitType !== 'five_hour') return null;
  // No confundir límites específicos de modelo ni overage con la semana general.
  const u = typeof i.utilization === 'number' && i.utilization >= 0 && i.utilization <= 1 ? porcentaje(i.utilization * 100) : undefined;
  const r = segundos(i.resetsAt);
  if (u === undefined && r === undefined) return null;
  return { fuente: 'evento', ...(u === undefined ? {} : { [semanal ? 'semana' : 'usado']: u }), ...(r === undefined ? {} : { [semanal ? 'renueva_semana' : 'renueva']: r }) };
}

export function cupoDeUsage(response: unknown): CupoClaude | null {
  const u = objeto(response);
  if (u.rate_limits_available !== true) return null;
  const r = objeto(u.rate_limits), cinco = objeto(r.five_hour), semana = objeto(r.seven_day);
  const usado = porcentaje(cinco.utilization), semanal = porcentaje(semana.utilization);
  const renueva = fechaISO(cinco.resets_at), renuevaSemana = fechaISO(semana.resets_at);
  if ([usado, semanal, renueva, renuevaSemana].every(x => x === undefined)) return null;
  return { fuente: 'usage', ...(usado === undefined ? {} : { usado }), ...(semanal === undefined ? {} : { semana: semanal }),
    ...(renueva === undefined ? {} : { renueva }), ...(renuevaSemana === undefined ? {} : { renueva_semana: renuevaSemana }) };
}

export function cupoDeError(texto: unknown): CupoClaude | null {
  if (typeof texto !== 'string') return null;
  const m = /you(?:'|’)ve hit your (5[- ]hour|7[- ]day|weekly) limit\s*[·—-]?\s*resets\s+([^\n\r]{1,160})/i.exec(texto);
  if (!m) return null;
  const renuevaTexto = m[2].trim(), renueva = fechaISO(renuevaTexto);
  const semanal = !m[1].startsWith('5');
  return { fuente: 'error', limiteAlcanzado: semanal ? 'seven_day' : 'five_hour', renuevaTexto,
    ...(renueva === undefined ? {} : { [semanal ? 'renueva_semana' : 'renueva']: renueva }) };
}
