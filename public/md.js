// Markdown mínimo y seguro: primero se escapa TODO, después se agregan unas pocas etiquetas fijas.
// No hay HTML del agente que pase crudo. Enlaces solo http(s).
export const esc = s => String(s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);

function enLinea(t) {
  return t
    .replace(/`([^`\n]+)`/g, '<code>$1</code>')
    .replace(/\*\*([^*\n]+)\*\*/g, '<strong>$1</strong>')
    .replace(/(^|[\s(])\*([^*\n]+)\*(?=[\s).,;:!?]|$)/g, '$1<em>$2</em>')
    .replace(/\[([^\]\n]+)\]\((https?:\/\/[^\s)]+)\)/g, '<a href="$2" target="_blank" rel="noopener noreferrer">$1</a>');
}

export function render(src) {
  const bloques = [];
  // Los bloques de código se sacan antes para que nada de adentro se interprete.
  let t = esc(src).replace(/```[^\n]*\n([\s\S]*?)(?:```|$)/g, (_, c) => `\u0000${bloques.push(c.replace(/\n$/, '')) - 1}\u0000`);
  const out = [];
  let lista = null;
  const cerrar = () => { if (lista) { out.push(`<${lista.tag}>${lista.items.map(i => `<li>${i}</li>`).join('')}</${lista.tag}>`); lista = null; } };
  for (const linea of t.split('\n')) {
    let m;
    if ((m = linea.match(/^\u0000(\d+)\u0000$/))) { cerrar(); out.push(`<pre><code>${bloques[m[1]]}</code></pre>`); }
    else if ((m = linea.match(/^(#{1,6})\s+(.*)$/))) { cerrar(); out.push(`<h4>${enLinea(m[2])}</h4>`); }
    else if ((m = linea.match(/^\s*[-*]\s+(.*)$/)) || (m = linea.match(/^\s*\d+[.)]\s+(.*)$/))) {
      const tag = /^\s*\d/.test(linea) ? 'ol' : 'ul';
      if (lista?.tag !== tag) { cerrar(); lista = { tag, items: [] }; }
      lista.items.push(enLinea(m[1]));
    }
    else if (!linea.trim()) { cerrar(); out.push(''); }
    else { cerrar(); out.push(`<p>${enLinea(linea)}</p>`); }
  }
  cerrar();
  return out.join('\n').replace(/\u0000(\d+)\u0000/g, (_, i) => `<code>${bloques[i]}</code>`);
}
