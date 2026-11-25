// La abeja obrera: el único sprite de los agentes. Pixel art plano, pocos colores, silueta simple.
// Ocupa ~14×13 px alrededor de (x, y) — el mismo hueco que el sprite anterior — para no mover escritorios.
// Cambiarla por otra mascota = reemplazar este archivo.
//   pose: 'idle' | 'type' | 'walk' | 'stretch' | 'sip' | 'sleep'
//   o: { corona: color|null (director), temp: bool (casco + credencial), pack: bool (mochila), mira: -1|0|1 }
const CUERPO = '#F7E3B0', SOMBRA_C = '#E2C27E', OJO = '#2a2140', BOCA = '#8a4a2a', ALA = 'rgba(214,236,255,.8)', ALA2 = 'rgba(255,255,255,.55)';
const px = (c, col, a, b, w = 1, h = 1) => { c.fillStyle = col; c.fillRect(a | 0, b | 0, w | 0, h | 0); };

export function abeja(c, x, y, col, t, pose, seed = 0, dx = 0, o = {}, RM = false) {
  const oy = y - 2, anda = pose === 'walk', trabaja = pose === 'type', duerme = pose === 'sleep';
  const f = RM ? 0 : Math.floor(t / (trabaja || anda ? 90 : 140)) % 2; // aleteo de 2 cuadros
  px(c, '#0003', x + 2, oy + 10, 10, 1); // sombra
  // alas (detrás, translúcidas): solo aletean trabajando o caminando
  const aleteo = (trabaja || anda) && f ? 1 : 0;
  px(c, ALA, x, oy + 1 + aleteo, 2, 2); px(c, ALA2, x + 1, oy + aleteo, 1, 1);
  px(c, ALA, x + 12, oy + 1 + aleteo, 2, 2); px(c, ALA2, x + 12, oy + aleteo, 1, 1);
  // antenas cortas con punta redonda; caídas cuando duerme
  if (duerme) { px(c, OJO, x + 3, oy - 1); px(c, OJO, x + 2, oy); px(c, OJO, x + 10, oy - 1); px(c, OJO, x + 11, oy); }
  else {
    const alto = pose === 'stretch' ? 1 : 0;
    px(c, OJO, x + 4, oy - 2 - alto, 1, 2 + alto); px(c, col, x + 3, oy - 3 - alto, 2, 1);
    px(c, OJO, x + 9, oy - 2 - alto, 1, 2 + alto); px(c, col, x + 9, oy - 3 - alto, 2, 1);
  }
  // cuerpo: rectángulo redondeado con 2 franjas del color del agente
  const resp = pose === 'idle' && !RM && Math.sin(t / 900 + seed) > .6 ? 1 : 0; // respira
  px(c, CUERPO, x + 3, oy - resp, 8, 1); px(c, CUERPO, x + 2, oy + 1 - resp, 10, 6 + resp); px(c, CUERPO, x + 3, oy + 7, 8, 1);
  px(c, SOMBRA_C, x + 3, oy + 7, 8, 1);
  px(c, col, x + 2, oy + 4, 10, 1); px(c, col, x + 2, oy + 6, 10, 1);
  // cara: ojos de punto (parpadean, miran), boca mínima según el ánimo
  const mira = o.mira ?? (anda ? Math.sign(dx || 0) : trabaja ? 1 : 0);
  const parpadea = !RM && !duerme && ((t + seed * 97) % 3600) < 150;
  if (duerme) { px(c, OJO, x + 4, oy + 2, 2, 1); px(c, OJO, x + 8, oy + 2, 2, 1); }
  else { px(c, OJO, x + 4 + mira, oy + 1 + (parpadea ? 1 : 0), 1, parpadea ? 1 : 2); px(c, OJO, x + 9 + mira, oy + 1 + (parpadea ? 1 : 0), 1, parpadea ? 1 : 2); }
  if (pose === 'stretch') px(c, BOCA, x + 6, oy + 3, 2, 1);
  else if (trabaja) px(c, BOCA, x + 7, oy + 3, 1, 1);
  else if (!duerme) { px(c, BOCA, x + 6, oy + 3, 2, 1); }
  // dos patitas
  const up = anda && f;
  px(c, OJO, x + 5, oy + 8, 1, up ? 1 : 2); px(c, OJO, x + 8, oy + 8, 1, up ? 2 : 1);
  // variantes
  if (o.corona) { const k = o.corona; px(c, k, x + 5, oy - 2, 4, 1); px(c, k, x + 5, oy - 3, 1, 1); px(c, k, x + 8, oy - 3, 1, 1); px(c, '#fff8', x + 6, oy - 2, 2, 1); }
  if (o.temp) { // casco de obra y credencial TEMP
    px(c, '#ffd24d', x + 4, oy - 2, 6, 2); px(c, '#e0a020', x + 3, oy, 8, 1);
    px(c, '#fff', x + 5, oy + 4, 4, 3); px(c, '#f0a020', x + 6, oy + 5, 2, 1);
  }
  if (o.pack) { px(c, '#7a5a36', x + 12, oy + 2, 3, 5); px(c, '#9a7a4a', x + 12, oy + 2, 3, 1); }
  if (pose === 'sip') { px(c, '#f2ead8', x + 12, oy + 3, 2, 2); px(c, '#7a4a2a', x + 12, oy + 3, 2, 1); }
  if (duerme && !RM) for (let k = 0; k < 2; k++) { // «zzz»
    const u = (t / 1600 + k / 2) % 1, zx = x + 12 + k * 2, zy = oy - 3 - u * 6, a = `rgba(255,255,255,${.9 - u * .8})`;
    px(c, a, zx, zy, 3, 1); px(c, a, zx + 1, zy + 1); px(c, a, zx, zy + 2, 3, 1);
  }
}

// Ícono de abeja para la interfaz (cabecera del chat, buscador): un canvas de 16×16 escalado.
export function iconoAbeja(col, corona = null, tam = 22) {
  const cv = document.createElement('canvas');
  cv.width = 16; cv.height = 16; cv.className = 'icono-abeja';
  cv.style.width = cv.style.height = tam + 'px';
  abeja(cv.getContext('2d'), 1, 5, col, 0, 'idle', 0, 0, { corona }, true);
  return cv;
}
