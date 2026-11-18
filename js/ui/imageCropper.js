// Recorte e zoom de imagem antes do upload (avatar e logo de cliente). Sem lib.
// cropImage(file, { shape }) abre o modal "Ajustar foto" e resolve com um File
// 512×512 (PNG se a origem tem transparência, senão JPEG 0,9) ou null se a
// pessoa cancelar. SVG não passa por aqui: quem chama sobe direto.
import { icon, refreshIcons } from './icons.js';
import { openDialog } from './dialog.js';
import { isMobile } from '../utils.js';

const OUT = 512;
const MAX_ZOOM = 4;
const MAX_SOURCE_BYTES = 25 * 1024 * 1024;

/** Decodifica já com a orientação EXIF aplicada (foto de celular "deitada"). */
async function decode(file) {
  if (typeof createImageBitmap === 'function') {
    try { return await createImageBitmap(file, { imageOrientation: 'from-image' }); } catch { /* cai no <img> */ }
  }
  const url = URL.createObjectURL(file);
  try {
    const img = new Image();
    img.decoding = 'async';
    img.src = url;
    await img.decode();
    return img;
  } finally {
    setTimeout(() => URL.revokeObjectURL(url), 0);
  }
}

const sizeOf = (src) => ({ w: src.width || src.naturalWidth, h: src.height || src.naturalHeight });

/** A imagem tem algum pixel transparente? (amostra reduzida) */
function hasAlpha(src, type) {
  if (!/png|webp|gif/i.test(type)) return false;
  const { w, h } = sizeOf(src);
  const s = Math.min(1, 256 / Math.max(w, h));
  const c = document.createElement('canvas');
  c.width = Math.max(1, Math.round(w * s)); c.height = Math.max(1, Math.round(h * s));
  const ctx = c.getContext('2d');
  ctx.drawImage(src, 0, 0, c.width, c.height);
  const d = ctx.getImageData(0, 0, c.width, c.height).data;
  for (let i = 3; i < d.length; i += 4) if (d[i] < 250) return true;
  return false;
}

/**
 * Abre o recorte. shape: 'circle' (avatar) | 'rounded' (logo).
 * Resolve com File (image/png ou image/jpeg) ou null.
 */
export async function cropImage(file, { shape = 'circle', title = 'Ajustar foto' } = {}) {
  if (file.size > MAX_SOURCE_BYTES) throw new Error('A imagem é grande demais (máx. 25 MB).');
  let src;
  try { src = await decode(file); } catch { throw new Error('Não deu para abrir esta imagem.'); }
  const { w: iw, h: ih } = sizeOf(src);
  const alpha = hasAlpha(src, file.type);
  const VIEW = isMobile() ? 240 : 320;
  const MASK = Math.round(VIEW * 0.86);       // lado da máscara dentro da área
  const base = MASK / Math.min(iw, ih);       // escala em que a imagem cobre a máscara (zoom 1×)

  const dlg = openDialog({
    title,
    size: 'md',
    body: `
      <div class="cropper">
        <div class="cropper__stage cropper__stage--${shape}" id="crStage" style="--view:${VIEW}px;--mask:${MASK}px" tabindex="0" aria-label="Arraste para posicionar; use + e − para zoom">
          <canvas id="crCanvas" width="${VIEW * 2}" height="${VIEW * 2}"></canvas>
          <div class="cropper__mask" aria-hidden="true"></div>
        </div>
        <div class="cropper__controls">
          ${icon('zoom-out', 'ico--sm')}
          <input type="range" id="crZoom" min="1" max="${MAX_ZOOM}" step="0.01" value="1" aria-label="Zoom" />
          ${icon('zoom-in', 'ico--sm')}
          <button type="button" class="btn btn--sm" id="crCenter">${icon('crosshair', 'ico--sm')} Centralizar</button>
        </div>
        <p class="hint">Arraste a imagem para posicionar. Roda do mouse ou pinça também dão zoom.</p>
      </div>`,
    actions: [
      { label: 'Cancelar', cls: 'btn--ghost', value: null },
      { label: 'Usar foto', cls: 'btn--primary', value: 'ok' },
    ],
  });
  const root = dlg.root;
  const canvas = root.querySelector('#crCanvas');
  const stage = root.querySelector('#crStage');
  const zoomEl = root.querySelector('#crZoom');
  const ctx = canvas.getContext('2d');
  const k = canvas.width / VIEW; // canvas em 2× para ficar nítido

  // estado: zoom e centro da imagem (em px da área), com a imagem sempre cobrindo a máscara
  let zoom = 1;
  let cx = VIEW / 2, cy = VIEW / 2;
  const scale = () => base * zoom;
  const clamp = () => {
    const hw = (iw * scale()) / 2, hh = (ih * scale()) / 2;
    const m0 = (VIEW - MASK) / 2, m1 = (VIEW + MASK) / 2;
    cx = Math.min(m0 + hw, Math.max(m1 - hw, cx));
    cy = Math.min(m0 + hh, Math.max(m1 - hh, cy));
  };
  const draw = () => {
    clamp();
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    const s = scale() * k;
    ctx.drawImage(src, cx * k - (iw * s) / 2, cy * k - (ih * s) / 2, iw * s, ih * s);
  };
  const setZoom = (z, ax = VIEW / 2, ay = VIEW / 2) => {
    const nz = Math.min(MAX_ZOOM, Math.max(1, z));
    // zoom ancorado no ponto (ax, ay): o pixel embaixo dele não sai do lugar
    cx = ax + (cx - ax) * (nz / zoom);
    cy = ay + (cy - ay) * (nz / zoom);
    zoom = nz;
    zoomEl.value = String(nz);
    draw();
  };
  const center = () => { zoom = 1; zoomEl.value = '1'; cx = VIEW / 2; cy = VIEW / 2; draw(); };
  draw();
  refreshIcons();

  zoomEl.addEventListener('input', () => setZoom(Number(zoomEl.value)));
  root.querySelector('#crCenter').addEventListener('click', center);

  // arrastar (mouse e toque) e pinça
  const pts = new Map();
  let pinch = null;
  const local = (e) => { const r = stage.getBoundingClientRect(); return { x: e.clientX - r.left, y: e.clientY - r.top }; };
  stage.addEventListener('pointerdown', (e) => {
    stage.setPointerCapture(e.pointerId);
    pts.set(e.pointerId, local(e));
    if (pts.size === 2) {
      const [a, b] = [...pts.values()];
      pinch = { d: Math.hypot(a.x - b.x, a.y - b.y), z: zoom };
    }
  });
  stage.addEventListener('pointermove', (e) => {
    if (!pts.has(e.pointerId)) return;
    const prev = pts.get(e.pointerId);
    const p = local(e);
    pts.set(e.pointerId, p);
    if (pts.size === 2 && pinch) {
      const [a, b] = [...pts.values()];
      setZoom(pinch.z * (Math.hypot(a.x - b.x, a.y - b.y) / pinch.d), (a.x + b.x) / 2, (a.y + b.y) / 2);
    } else if (pts.size === 1) {
      cx += p.x - prev.x; cy += p.y - prev.y; draw();
    }
  });
  const up = (e) => { pts.delete(e.pointerId); if (pts.size < 2) pinch = null; };
  stage.addEventListener('pointerup', up);
  stage.addEventListener('pointercancel', up);
  stage.addEventListener('wheel', (e) => {
    e.preventDefault();
    const p = local(e);
    setZoom(zoom * Math.exp(-e.deltaY * 0.0015), p.x, p.y);
  }, { passive: false });
  stage.addEventListener('keydown', (e) => {
    const step = 8;
    if (e.key === '+' || e.key === '=') setZoom(zoom * 1.1);
    else if (e.key === '-') setZoom(zoom / 1.1);
    else if (e.key === 'ArrowLeft') { cx -= step; draw(); }
    else if (e.key === 'ArrowRight') { cx += step; draw(); }
    else if (e.key === 'ArrowUp') { cy -= step; draw(); }
    else if (e.key === 'ArrowDown') { cy += step; draw(); }
    else return;
    e.preventDefault();
  });

  const r = await dlg.result;
  if (r !== 'ok') { src.close?.(); return null; }

  // recorte final em 512×512: a área da máscara, na escala atual
  const out = document.createElement('canvas');
  out.width = OUT; out.height = OUT;
  const octx = out.getContext('2d');
  const f = OUT / MASK;
  const s = scale() * f;
  const m0 = (VIEW - MASK) / 2;
  if (!alpha) { octx.fillStyle = '#ffffff'; octx.fillRect(0, 0, OUT, OUT); }
  octx.imageSmoothingQuality = 'high';
  octx.drawImage(src, (cx - m0) * f - (iw * s) / 2, (cy - m0) * f - (ih * s) / 2, iw * s, ih * s);
  src.close?.();
  const type = alpha ? 'image/png' : 'image/jpeg';
  const blob = await new Promise((res) => out.toBlob(res, type, 0.9));
  if (!blob) throw new Error('Não deu para gerar a imagem recortada.');
  const name = (file.name || 'imagem').replace(/\.[^.]+$/, '') + (alpha ? '.png' : '.jpg');
  return new File([blob], name, { type });
}
