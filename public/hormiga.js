// Hormiga obrera original: tres segmentos, seis patas y cinturón de herramientas.
const px = (c, col, x, y, w = 1, h = 1) => { c.fillStyle = col; c.fillRect(x | 0, y | 0, w, h); };
export function hormiga(c, x, y, col, t, pose, seed = 0, dx = 0, o = {}, quieta = false) {
  const paso = !quieta && ['walk', 'type'].includes(pose) ? Math.floor(t / 140 + seed) % 2 : 0;
  px(c, '#0003', x + 1, y + 9, 13, 1);
  for (const k of [0, 3, 6]) { px(c, '#38202b', x + 1 + paso, y + 3 + k, 3, 1); px(c, '#38202b', x + 10 - paso, y + 3 + k, 3, 1); }
  px(c, '#79464a', x + 4, y + 5, 6, 4); px(c, col, x + 5, y + 4, 4, 2);
  px(c, '#a26c58', x + 3, y, 8, 4); px(c, '#c78d6c', x + 4, y, 6, 1);
  px(c, '#38202b', x + 3, y - 2, 1, 2); px(c, '#38202b', x + 2, y - 3, 2, 1);
  px(c, '#38202b', x + 10, y - 2, 1, 2); px(c, '#38202b', x + 10, y - 3, 2, 1);
  px(c, '#211c2b', x + 5, y + 1, 1, pose === 'sleep' ? 1 : 2); px(c, '#211c2b', x + 9, y + 1, 1, pose === 'sleep' ? 1 : 2);
  px(c, '#e0b65f', x + 3, y + 6, 8, 1); px(c, '#eee2c9', x + 9, y + 5, 2, 4); px(c, '#647888', x + 11, y + 6, 1, 3);
  px(c, '#fff', x + 5, y + 7, 3, 2); px(c, col, x + 6, y + 7, 1, 1);
}
export function iconoHormiga(col, tam = 22) {
  const cv = document.createElement('canvas'); cv.width = cv.height = 16; cv.className = 'icono-abeja'; cv.style.width = cv.style.height = tam + 'px';
  hormiga(cv.getContext('2d'), 1, 5, col, 0, 'idle', 0, 0, {}, true); return cv;
}
