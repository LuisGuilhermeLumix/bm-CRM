// Seção Anotações (#/anotacoes): grid de cards com busca e favoritos, modal de
// criar/editar (texto puro, autosave ao editar) e realtime em fin_notes.
// As notas antigas vieram com HTML: ao abrir uma delas pela primeira vez, o
// texto é convertido para texto puro e gravado limpo.
import { icon, refreshIcons } from '../icons.js';
import { esc, debounce, autoResize } from '../../utils.js';
import { stable } from '../../state.js';
import { emptyHtml } from '../common.js';
import { openDialog, confirmDialog } from '../dialog.js';
import { toastError, toastSuccess } from '../toast.js';
import { fold } from '../../fin/format.js';
import { isMissingInDb } from '../../fin/db.js';
import { fetchNotes, createNote, updateNote, deleteNote, subscribeNotes, isLegacyHtml, noteText } from '../../fin/notes.js';

const AUTOSAVE_MS = 700;
let ctx = null;

const dateLabel = (iso) => (iso ? new Date(iso).toLocaleDateString('pt-BR', { day: '2-digit', month: '2-digit', year: '2-digit' }) : '');

export function mount(container) {
  const c = ctx = { container, notes: [], q: '', loading: true, error: null, offs: [] };
  container.innerHTML = `
    <div class="page__inner">
      <div class="toolbar">
        <label class="filter-search">
          ${icon('search')}
          <input class="input" id="ntSearch" placeholder="Buscar no título ou no texto…" autocomplete="off" aria-label="Buscar anotações" />
        </label>
        <div class="toolbar__spacer"></div>
        <button type="button" class="btn btn--primary" id="ntNew">${icon('plus')}<span>Nova anotação</span></button>
      </div>
      <div class="page__body" id="ntBody"></div>
    </div>`;
  refreshIcons();

  const $ = (sel) => container.querySelector(sel);
  $('#ntSearch').addEventListener('input', debounce(() => { c.q = $('#ntSearch').value; render(c); }, 120));
  $('#ntNew').addEventListener('click', () => openForm(c, null));
  $('#ntBody').addEventListener('click', (e) => {
    if (e.target.closest('[data-retry]')) { load(c); return; }
    if (e.target.closest('[data-new]')) { openForm(c, null); return; }
    const card = e.target.closest('[data-note]');
    if (!card) return;
    const note = c.notes.find((n) => n.id === card.dataset.note);
    if (!note) return;
    if (e.target.closest('[data-fav]')) { toggleFavorite(c, note); return; }
    openForm(c, note);
  });
  $('#ntBody').addEventListener('keydown', (e) => {
    if ((e.key !== 'Enter' && e.key !== ' ') || e.target.closest('button')) return;
    const card = e.target.closest('[data-note]');
    if (card) { e.preventDefault(); openForm(c, c.notes.find((n) => n.id === card.dataset.note)); }
  });

  c.offs.push(subscribeNotes((p) => onRealtime(c, p)));
  load(c);
}

export function unmount() {
  if (!ctx) return;
  const c = ctx;
  ctx = null;
  c.offs.forEach((off) => off());
}

async function load(c) {
  c.loading = true;
  c.error = null;
  render(c);
  try {
    const notes = await fetchNotes();
    if (ctx !== c) return;
    c.notes = notes;
  } catch (e) {
    if (ctx !== c) return;
    c.error = isMissingInDb(e) ? 'As tabelas do Financeiro ainda não existem neste banco (migration 010_fin_schema.sql).' : (e.message || 'Não foi possível carregar as anotações.');
  }
  c.loading = false;
  render(c);
}

function upsertLocal(c, row) {
  const i = c.notes.findIndex((n) => n.id === row.id);
  if (i === -1) { c.notes.push(row); return true; }
  if (stable(c.notes[i]) === stable(row)) return false; // eco do nosso próprio save
  c.notes[i] = row;
  return true;
}

function removeLocal(c, id) {
  const i = c.notes.findIndex((n) => n.id === id);
  if (i === -1) return false;
  c.notes.splice(i, 1);
  return true;
}

function onRealtime(c, payload) {
  if (ctx !== c || c.loading) return;
  const changed = payload.eventType === 'DELETE' ? removeLocal(c, payload.old?.id) : upsertLocal(c, payload.new);
  if (changed) render(c);
}

async function toggleFavorite(c, note) {
  const before = note.favorite;
  note.favorite = !before; // otimista
  render(c);
  try {
    upsertLocal(c, await updateNote(note.id, { favorite: !before }));
  } catch (e) {
    note.favorite = before;
    toastError(e);
  }
  if (ctx === c) render(c);
}

// ----------------------------------------------------------------------------
// Render
// ----------------------------------------------------------------------------
/** Favoritas primeiro; dentro de cada grupo, a mexida mais recente primeiro. */
function sorted(c) {
  const q = fold(c.q.trim());
  return c.notes
    .filter((n) => !q || fold(n.title).includes(q) || fold(noteText(n)).includes(q))
    .sort((a, b) => (Number(b.favorite) - Number(a.favorite)) || (a.updated_at < b.updated_at ? 1 : a.updated_at > b.updated_at ? -1 : 0));
}

function render(c) {
  const body = c.container.querySelector('#ntBody');
  if (!body) return;
  const state = (html) => { body.innerHTML = `<div class="page-state">${html}</div>`; refreshIcons(); };
  if (c.loading && !c.notes.length) return state(`${icon('loader-circle', 'spin')} Carregando anotações…`);
  if (c.error) {
    return state(emptyHtml({
      icon: 'triangle-alert', title: 'Não deu para carregar', text: c.error,
      action: `<button type="button" class="btn" data-retry>${icon('refresh-cw')} Tentar de novo</button>`,
    }));
  }
  if (!c.notes.length) {
    return state(emptyHtml({
      icon: 'notebook-pen', title: 'Nenhuma anotação ainda', text: 'Guarde aqui lembretes, combinados e passo a passo da operação.',
      action: `<button type="button" class="btn btn--primary" data-new>${icon('plus')} Nova anotação</button>`,
    }));
  }
  const notes = sorted(c);
  if (!notes.length) return state(emptyHtml({ icon: 'search', title: 'Nenhuma anotação corresponde à busca' }));

  body.innerHTML = `
    <div class="note-grid">
      ${notes.map((n) => {
        const text = noteText(n);
        return `
        <article class="note ${n.favorite ? 'is-favorite' : ''}" data-note="${n.id}" tabindex="0" aria-label="Abrir anotação ${esc(n.title)}">
          <header class="note__head">
            <h3 class="note__title">${esc(n.title)}</h3>
            <button type="button" class="note__fav" data-fav aria-pressed="${n.favorite}" title="${n.favorite ? 'Tirar dos favoritos' : 'Marcar como favorita'}" aria-label="${n.favorite ? 'Tirar dos favoritos' : 'Marcar como favorita'}">${icon('star')}</button>
          </header>
          ${text ? `<p class="note__text">${esc(text.slice(0, 600))}</p>` : '<p class="note__text subtle">Sem texto.</p>'}
          <footer class="note__foot">Atualizada em ${esc(dateLabel(n.updated_at))}</footer>
        </article>`;
      }).join('')}
    </div>`;
  refreshIcons();
}

// ----------------------------------------------------------------------------
// Modal criar / editar
// ----------------------------------------------------------------------------
function openForm(c, note) {
  const isNew = !note;
  const n = note ? { ...note } : { title: '', body: '', favorite: false };
  // nota antiga com HTML: mostra já convertida e grava limpa logo abaixo
  const needsCleaning = !isNew && isLegacyHtml(n);
  const text = noteText(n);

  const dlg = openDialog({
    title: isNew ? 'Nova anotação' : 'Editar anotação',
    size: 'lg',
    body: `
      <div class="form-field">
        <label for="nfTitle">Título</label>
        <input class="input" id="nfTitle" value="${esc(n.title)}" placeholder="Do que se trata" autocomplete="off" />
      </div>
      <div class="form-field">
        <label for="nfBody">Texto</label>
        <textarea class="textarea note-editor" id="nfBody" rows="6" placeholder="Escreva aqui…">${esc(text)}</textarea>
      </div>
      <div class="note-form__foot">
        <label class="toggle"><input type="checkbox" id="nfFav" ${n.favorite ? 'checked' : ''} /><span class="toggle__track"></span><span>Favorita</span></label>
        ${isNew ? '' : '<span class="card-modal__save" id="nfStatus" aria-live="polite"></span>'}
      </div>`,
    actions: isNew ? [
      { label: 'Cancelar', cls: 'btn--ghost', value: null },
      { label: 'Criar', cls: 'btn--primary', onClick: () => { create(); return false; } },
    ] : [
      { label: `${icon('trash-2')} Excluir`, cls: 'btn--danger-ghost dialog__left', onClick: () => { remove(); return false; } },
      { label: 'Fechar', cls: 'btn--primary', value: 'close' },
    ],
  });

  const root = dlg.root;
  const $ = (id) => root.querySelector('#' + id);
  const title = $('nfTitle');
  const bodyEl = $('nfBody');
  const fav = $('nfFav');
  bodyEl.addEventListener('input', () => autoResize(bodyEl));
  setTimeout(() => autoResize(bodyEl), 0);

  // ---------- criar ----------
  let creating = false;
  async function create() {
    if (creating) return;
    const t = title.value.trim();
    if (!t) { title.focus(); return; }
    creating = true;
    root.querySelectorAll('.dialog__actions .btn').forEach((b) => { b.disabled = true; });
    try {
      const row = await createNote({ title: t, body: bodyEl.value, favorite: fav.checked });
      dlg.close('created');
      toastSuccess('Anotação criada.');
      if (ctx === c && upsertLocal(c, row)) render(c);
    } catch (e) {
      creating = false;
      root.querySelectorAll('.dialog__actions .btn').forEach((b) => { b.disabled = false; });
      toastError(e);
    }
  }
  if (isNew) {
    title.addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); bodyEl.focus(); } });
    return;
  }

  // ---------- editar: autosave ----------
  const status = $('nfStatus');
  const setStatus = (kind, label) => {
    status.className = `card-modal__save ${kind === 'saved' ? 'is-saved' : kind === 'error' ? 'is-error' : ''}`;
    status.innerHTML = kind === 'saving' ? `${icon('loader-circle', 'ico--sm spin')} Salvando…` : kind === 'saved' ? `${icon('check', 'ico--sm')} Salvo` : esc(label || '');
    refreshIcons();
  };
  let saved = { title: n.title, body: n.body, favorite: n.favorite };
  let saving = null;
  let deleted = false;

  async function save() {
    if (deleted) return;
    if (saving) { await saving; }
    const t = title.value.trim();
    if (!t) { setStatus('error', 'O título não pode ficar vazio'); return; }
    const patch = {};
    if (t !== saved.title) patch.title = t;
    if (bodyEl.value !== saved.body) {
      patch.body = bodyEl.value;
      if (n.body_format === 'html') patch.body_format = 'text'; // deixou de ser HTML antigo: não converte mais
    }
    if (fav.checked !== saved.favorite) patch.favorite = fav.checked;
    if (!Object.keys(patch).length) return;
    setStatus('saving');
    saving = updateNote(n.id, patch)
      .then((row) => {
        saved = { title: row.title, body: row.body, favorite: row.favorite };
        if ('body_format' in row) n.body_format = row.body_format;
        setStatus('saved');
        if (ctx === c && upsertLocal(c, row)) render(c);
      })
      .catch((e) => { setStatus('error', 'Não salvou'); toastError(e); })
      .finally(() => { saving = null; });
    await saving;
  }
  const autosave = debounce(save, AUTOSAVE_MS);
  title.addEventListener('input', autosave);
  bodyEl.addEventListener('input', autosave);
  fav.addEventListener('change', () => { autosave.cancel(); save(); });
  title.addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); bodyEl.focus(); } });
  // fechar (botão, Esc ou clique fora) grava o que estiver pendente
  dlg.result.then(() => { autosave.cancel(); save(); });

  if (needsCleaning) save(); // o textarea já tem o texto puro, diferente do HTML gravado: salva limpo

  async function remove() {
    const ok = await confirmDialog({
      title: 'Excluir anotação',
      message: `Excluir "<b>${esc(saved.title)}</b>" definitivamente?`,
      confirmText: 'Excluir',
    });
    if (!ok) return;
    autosave.cancel();
    deleted = true;
    try {
      await deleteNote(n.id);
      dlg.close('deleted');
      toastSuccess('Anotação excluída.');
      if (ctx === c && removeLocal(c, n.id)) render(c);
    } catch (e) {
      deleted = false;
      toastError(e);
    }
  }
}
