// Gráficos em SVG inline, sem biblioteca: colunas lado a lado, linha e barras
// horizontais. Cores só por classe (.tone-*), que apontam para os tokens
// --chart-* de tokens.css — assim trocam com o tema.
//
// Regras seguidas em todos: marcas finas (coluna/barra ≤ 24px, linha 2px),
// ponta arredondada só do lado do dado, grade em fio sólido, texto sempre nas
// cores de texto (nunca na cor da série), legenda quando há 2+ séries, tooltip
// no hover e no foco do teclado, e uma tabela com os mesmos números.
import { esc, debounce, el } from '../utils.js';

const compact = new Intl.NumberFormat('pt-BR', { notation: 'compact', maximumFractionDigits: 1 });
const full = new Intl.NumberFormat('pt-BR', { maximumFractionDigits: 0 });

/** Escala com números redondos: { min, max, ticks }. */
function niceScale(lo, hi, count = 4) {
  if (hi <= lo) hi = lo + 1;
  const raw = (hi - lo) / count;
  const mag = 10 ** Math.floor(Math.log10(raw));
  const n = raw / mag;
  const step = (n <= 1 ? 1 : n <= 2 ? 2 : n <= 2.5 ? 2.5 : n <= 5 ? 5 : 10) * mag;
  const min = Math.floor(lo / step) * step;
  const max = Math.ceil(hi / step) * step;
  const ticks = [];
  for (let v = min; v <= max + step / 2; v += step) ticks.push(Math.round(v * 100) / 100);
  return { min, max, ticks };
}

/** Um estilo só por eixo: compacto ("10 mil") quando o eixo chega a 10.000, senão por extenso. */
const tickFormatter = (scale) => (Math.max(Math.abs(scale.min), Math.abs(scale.max)) >= 10000
  ? (v) => compact.format(v) : (v) => full.format(v));

/** Coluna com o topo arredondado e a base reta, crescendo da linha de base. */
function columnPath(x, yTop, w, h) {
  const r = Math.min(4, h, w / 2);
  return `M${x},${yTop + h}V${yTop + r}Q${x},${yTop} ${x + r},${yTop}H${x + w - r}Q${x + w},${yTop} ${x + w},${yTop + r}V${yTop + h}Z`;
}
/** Barra horizontal com a ponta direita arredondada e a base (esquerda) reta. */
function barPath(x, y, w, h) {
  const r = Math.min(4, w, h / 2);
  return `M${x},${y}H${x + w - r}Q${x + w},${y} ${x + w},${y + r}V${y + h - r}Q${x + w},${y + h} ${x + w - r},${y + h}H${x}Z`;
}

/**
 * Moldura comum: legenda (2+ séries), área do gráfico com tooltip e a tabela.
 * draw(width) devolve { svg, onHit(i) -> { x, y, title, rows: [{ tone, value, label }] } }.
 * Devolve a função que desmonta (para de observar o tamanho).
 */
function mountChart(host, { legend = [], table, label, draw }) {
  host.innerHTML = `
    <div class="chart">
      ${legend.length > 1 ? `<div class="chart__legend">${legend.map((s) => `<span class="chart__key"><span class="chart__swatch tone-${s.tone} ${s.line ? 'chart__swatch--line' : ''}"></span>${esc(s.label)}</span>`).join('')}</div>` : ''}
      <div class="chart__plot"><div class="chart__svg"></div><div class="chart-tip" role="status" hidden></div></div>
      <details class="chart__table"><summary>Ver como tabela</summary><div class="table-wrap"><table class="table"></table></div></details>
    </div>`;
  const plot = host.querySelector('.chart__plot');
  const svgHost = host.querySelector('.chart__svg');
  const tip = host.querySelector('.chart-tip');

  // tabela: os mesmos números do gráfico, sem depender de hover (textContent: nomes vêm do banco)
  const tbl = host.querySelector('.chart__table table');
  const row = (cells, tag) => { const tr = document.createElement('tr'); cells.forEach((c, i) => { const td = document.createElement(tag); td.textContent = c; if (i > 0) td.className = 'num'; tr.appendChild(td); }); return tr; };
  const thead = document.createElement('thead'); thead.appendChild(row(table.head, 'th'));
  const tbody = document.createElement('tbody'); table.rows.forEach((r) => tbody.appendChild(row(r, 'td')));
  tbl.append(thead, tbody);

  let current = null;
  const hideTip = () => { tip.hidden = true; svgHost.querySelectorAll('.is-hot').forEach((n) => n.classList.remove('is-hot')); };
  const showTip = (i) => {
    const info = current.onHit(i);
    tip.replaceChildren();
    const h = document.createElement('div'); h.className = 'chart-tip__title'; h.textContent = info.title; tip.appendChild(h);
    info.rows.forEach((r) => {
      const line = document.createElement('div'); line.className = 'chart-tip__row';
      if (r.tone) { const key = document.createElement('span'); key.className = `chart-tip__key tone-${r.tone}`; line.appendChild(key); }
      const v = document.createElement('b'); v.textContent = r.value; line.appendChild(v); // o valor lidera
      const l = document.createElement('span'); l.textContent = r.label; line.appendChild(l);
      tip.appendChild(line);
    });
    tip.hidden = false;
    const w = plot.clientWidth, tw = tip.offsetWidth, th = tip.offsetHeight;
    tip.style.left = `${Math.max(0, Math.min(w - tw, info.x - tw / 2))}px`;
    // acima da marca; sem espaço em cima, vai para baixo dela (nunca por cima do que está sendo lido)
    const above = info.y - th - 10;
    tip.style.top = `${above >= 0 ? above : (info.below ?? info.y) + 10}px`;
    svgHost.querySelectorAll('.is-hot').forEach((n) => n.classList.remove('is-hot'));
    svgHost.querySelectorAll(`[data-i="${i}"]`).forEach((n) => n.classList.add('is-hot'));
  };

  const render = () => {
    const width = Math.max(260, Math.floor(plot.clientWidth));
    current = draw(width);
    svgHost.innerHTML = current.svg.replace('<svg ', `<svg role="img" aria-label="${esc(label)}" `);
    hideTip();
    svgHost.querySelectorAll('.chart-hit').forEach((hit) => {
      const i = Number(hit.dataset.i);
      hit.addEventListener('pointerenter', () => showTip(i));
      hit.addEventListener('pointermove', () => showTip(i));
      hit.addEventListener('pointerleave', hideTip);
      hit.addEventListener('focus', () => showTip(i));
      hit.addEventListener('blur', hideTip);
    });
  };
  const ro = new ResizeObserver(debounce(render, 80));
  ro.observe(plot);
  render();
  return () => ro.disconnect();
}

/** Grade horizontal + rótulos do eixo Y. */
function yAxisSvg(scale, y, x0, x1) {
  const fmtTick = tickFormatter(scale);
  return scale.ticks.map((t) => `
    <line class="${t === 0 ? 'chart-axis' : 'chart-rule'}" x1="${x0}" x2="${x1}" y1="${y(t)}" y2="${y(t)}"/>
    <text class="chart-tick" x="${x0 - 8}" y="${y(t)}" text-anchor="end" dominant-baseline="middle">${esc(fmtTick(t))}</text>`).join('');
}

/**
 * Colunas lado a lado.
 * { labels: [curto], titles: [por extenso], series: [{ label, tone, values }], format(v) }
 */
export function columnsChart(host, { labels, titles, series, format, label }) {
  return mountChart(host, {
    label,
    legend: series,
    table: { head: ['Mês', ...series.map((s) => s.label)], rows: labels.map((_, i) => [titles[i], ...series.map((s) => format(s.values[i]))]) },
    draw(W) {
      const H = 240, m = { l: 52, r: 6, t: 12, b: 26 };
      const iw = W - m.l - m.r, ih = H - m.t - m.b;
      const scale = niceScale(0, Math.max(1, ...series.flatMap((s) => s.values)));
      const y = (v) => m.t + ih - ((v - scale.min) / (scale.max - scale.min)) * ih;
      const band = iw / labels.length;
      const bw = Math.max(4, Math.min(24, (band * 0.72 - 2 * (series.length - 1)) / series.length));
      const groupW = bw * series.length + 2 * (series.length - 1); // 2px de respiro entre colunas vizinhas
      const cx = (i) => m.l + band * i + band / 2;
      const svg = `<svg width="${W}" height="${H}" viewBox="0 0 ${W} ${H}">
        ${yAxisSvg(scale, y, m.l, W - m.r)}
        ${labels.map((_, i) => `<rect class="chart-hit" data-i="${i}" tabindex="0" x="${m.l + band * i}" y="${m.t}" width="${band}" height="${ih}"
            aria-label="${esc(`${titles[i]}: ${series.map((s) => `${s.label} ${format(s.values[i])}`).join('; ')}`)}"/>`).join('')}
        ${labels.map((_, i) => series.map((s, k) => {
          const v = s.values[i];
          if (!(v > 0)) return '';
          const h = Math.max(1, y(0) - y(v));
          return `<path class="chart-mark tone-${s.tone}" d="${columnPath(cx(i) - groupW / 2 + k * (bw + 2), y(0) - h, bw, h)}"/>`;
        }).join('')).join('')}
        ${labels.map((t, i) => `<text class="chart-tick" x="${cx(i)}" y="${H - 8}" text-anchor="middle">${esc(t)}</text>`).join('')}
      </svg>`;
      return {
        svg,
        onHit: (i) => ({
          x: cx(i), y: Math.min(...series.map((s) => y(Math.max(0, s.values[i])))),
          title: titles[i],
          rows: series.map((s) => ({ tone: s.tone, value: format(s.values[i]), label: s.label })),
        }),
      };
    },
  });
}

/**
 * Linha de uma série só (o título do painel diz o que é; sem caixa de legenda).
 * { labels, titles, values, tone, name, format(v) }
 */
export function lineChart(host, { labels, titles, values, tone, name, format, label }) {
  return mountChart(host, {
    label,
    table: { head: ['Mês', name], rows: labels.map((_, i) => [titles[i], format(values[i])]) },
    draw(W) {
      const H = 240, m = { l: 52, r: 6, t: 26, b: 26 };
      const iw = W - m.l - m.r, ih = H - m.t - m.b;
      const scale = niceScale(Math.min(0, ...values), Math.max(0, ...values, 1));
      const y = (v) => m.t + ih - ((v - scale.min) / (scale.max - scale.min)) * ih;
      const band = iw / labels.length;
      const cx = (i) => m.l + band * i + band / 2;
      const last = values.length - 1;
      const svg = `<svg width="${W}" height="${H}" viewBox="0 0 ${W} ${H}">
        ${yAxisSvg(scale, y, m.l, W - m.r)}
        ${labels.map((_, i) => `<rect class="chart-hit" data-i="${i}" tabindex="0" x="${m.l + band * i}" y="${m.t}" width="${band}" height="${ih}"
            aria-label="${esc(`${titles[i]}: ${name} ${format(values[i])}`)}"/>`).join('')}
        ${labels.map((_, i) => `<line class="chart-cross" data-i="${i}" x1="${cx(i)}" x2="${cx(i)}" y1="${m.t}" y2="${m.t + ih}"/>`).join('')}
        <polyline class="chart-line tone-${tone}" points="${values.map((v, i) => `${cx(i)},${y(v)}`).join(' ')}"/>
        ${values.map((v, i) => `<circle class="chart-dot tone-${tone}" data-i="${i}" cx="${cx(i)}" cy="${y(v)}" r="4"/>`).join('')}
        <text class="chart-value" x="${cx(last)}" y="${y(values[last]) - 12}" text-anchor="${last > 0 ? 'end' : 'middle'}" dx="${last > 0 ? 8 : 0}">${esc(format(values[last]))}</text>
        ${labels.map((t, i) => `<text class="chart-tick" x="${cx(i)}" y="${H - 8}" text-anchor="middle">${esc(t)}</text>`).join('')}
      </svg>`;
      return {
        svg,
        onHit: (i) => ({ x: cx(i), y: y(values[i]), title: titles[i], rows: [{ tone, value: format(values[i]), label: name }] }),
      };
    },
  });
}

/**
 * Barras horizontais ranqueadas, uma cor só (a série é uma; o título diz qual).
 * { items: [{ label, value, count }], tone, name, format(v) } — já ordenados.
 * Mostra as 8 maiores e junta o resto em "Outras"; a tabela lista todas.
 */
export function barsChart(host, { items, tone, name, format, label, top = 8 }) {
  const total = items.reduce((s, x) => s + x.value, 0);
  const pct = (v) => (total > 0 ? `${(Math.round((v / total) * 1000) / 10).toLocaleString('pt-BR')}%` : '0%');
  const tail = items.slice(top);
  const shown = tail.length > 1
    ? [...items.slice(0, top), { label: `Outras (${tail.length})`, value: tail.reduce((s, x) => s + x.value, 0), count: tail.reduce((s, x) => s + (x.count || 0), 0) }]
    : items;
  return mountChart(host, {
    label,
    table: { head: [name, 'Valor', '% do total', 'Lançamentos'], rows: items.map((x) => [x.label, format(x.value), pct(x.value), String(x.count ?? '')]) },
    draw(W) {
      const rowH = 32, bh = 14, pad = 4;
      const lw = Math.round(Math.max(96, Math.min(200, W * 0.3)));   // coluna do nome
      const vw = 104;                                                  // espaço para o valor na ponta
      const track = Math.max(40, W - lw - vw - 12);
      const max = Math.max(1, ...shown.map((x) => x.value));
      const H = shown.length * rowH + pad * 2;
      const fit = (s) => { const n = Math.floor(lw / 6.6); return s.length > n ? `${s.slice(0, Math.max(1, n - 1))}…` : s; };
      const x0 = lw + 12;
      const svg = `<svg width="${W}" height="${H}" viewBox="0 0 ${W} ${H}">
        <line class="chart-axis" x1="${x0}" x2="${x0}" y1="${pad}" y2="${H - pad}"/>
        ${shown.map((x, i) => {
          const cy = pad + i * rowH + rowH / 2;
          const w = x.value > 0 ? Math.max(2, (x.value / max) * track) : 0;
          return `
          <rect class="chart-hit" data-i="${i}" tabindex="0" x="0" y="${cy - rowH / 2}" width="${W}" height="${rowH}"
            aria-label="${esc(`${x.label}: ${format(x.value)} (${pct(x.value)} do total)`)}"/>
          <text class="chart-label" x="${lw}" y="${cy}" text-anchor="end" dominant-baseline="middle"><title>${esc(x.label)}</title>${esc(fit(x.label))}</text>
          ${w ? `<path class="chart-mark tone-${tone}" data-i="${i}" d="${barPath(x0, cy - bh / 2, w, bh)}"/>` : ''}
          <text class="chart-value" x="${x0 + w + 8}" y="${cy}" dominant-baseline="middle">${esc(format(x.value))}</text>`;
        }).join('')}
      </svg>`;
      return {
        svg,
        onHit: (i) => ({
          x: x0 + Math.max(2, (shown[i].value / max) * track) / 2, y: pad + i * rowH + 4, below: pad + (i + 1) * rowH - 4,
          title: shown[i].label,
          rows: [
            { tone, value: format(shown[i].value), label: `${pct(shown[i].value)} do total` },
            ...(shown[i].count ? [{ value: String(shown[i].count), label: shown[i].count === 1 ? 'lançamento' : 'lançamentos' }] : []),
          ],
        }),
      };
    },
  });
}

/** Estado vazio no lugar de um gráfico. */
export function chartEmpty(host, text) {
  host.replaceChildren(el(`<div class="chart-empty">${esc(text)}</div>`));
  return () => {};
}
