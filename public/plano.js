// Cálculo del plano (sin DOM, para poder probarlo).
// nz = zonas (hasta 6, en 2 filas de 3); maxI[p] = índice de escritorio más alto ocupado en la zona p; nT = temporales.
// - Cada zona tiene sus filas de 2 escritorios y exactamente UNA fila libre al final (una zona vacía: 1 fila).
// - Todas las zonas de una misma fila de islas comparten el alto de la alfombra (el de la zona más llena);
//   lo que sobra en las otras se decora (plantas, archivadores, carrito de café).
// - Contratistas: columna derecha que arranca bajo la recepción (C0); al menos 2 filas, crecen con los temporales.
// - hueco: si quedan menos de 6 zonas, el siguiente lugar se reserva para «➕ Crear zona».
// Devuelve las filas por zona (fz), por fila de islas (filas), dónde empieza cada fila (y0), contratistas y DY
// (cuánto crece la planta abierta respecto del plano original; puede ser negativo si hay poca gente).
export const C0 = 91;
export function calcLayout(nz, maxI, nT, hueco = false) {
  const fz = Array.from({ length: nz }, (_, p) => ((maxI[p] ?? -1) >= 0 ? Math.floor(maxI[p] / 2) + 2 : 1));
  const h = hueco && nz < 6 ? nz : -1;
  const fila = f => { let m = f === 1 && h === 3 ? 1 : 0; for (let p = f * 3; p < Math.min(nz, f * 3 + 3); p++) m = Math.max(m, fz[p]); return m; };
  const filas = [Math.max(1, fila(0)), nz > 3 || h === 3 ? fila(1) : 0], y0 = [77, 77 + filas[0] * 48 + 2 + 8];
  const zAbajo = filas[1] ? y0[1] + filas[1] * 48 + 2 : 77 + filas[0] * 48 + 2, filasC = Math.max(2, Math.ceil(nT / 2));
  const abajo = Math.max(zAbajo, C0 + filasC * 48 + 2);
  return { nz, fz, filas, y0, filasC, DY: abajo - 175, hueco: h };
}
