// Seção Credenciais (#/credenciais): lista com busca, modal de criar/editar e
// o segredo guardado no Supabase Vault. O segredo só é buscado quando a pessoa
// clica em "Mostrar" ou "Copiar"; mostrado, some sozinho em 30 segundos.
import { icon, refreshIcons } from '../icons.js';
import { esc, debounce, autoResize, normalizeUrl, hostnameOf } from '../../utils.js';
import { chipHtml, clientAvatarHtml, emptyHtml } from '../common.js';
import { openDialog, confirmDialog } from '../dialog.js';
import { toastError, toastSuccess } from '../toast.js';
import { clientSelectHtml } from '../entryForm.js';
import { fold } from '../../fin/format.js';
import { isMissingInDb } from '../../fin/db.js';
import { fetchClients } from '../../fin/clients.js';
import {
  ACCESS_LEVELS, accessOf, secretState, fetchCredentials, createCredential, updateCredential, deleteCredential,
  setCredentialSecret, getCredentialSecret,
} from '../../fin/credentials.js';

export const REVEAL_MS = 30000;
let ctx = null;

/** Copia para a área de transferência (com plano B para navegador sem a API). */
async function copyText(text) {
  try {
    await navigator.clipboard.writeText(text);
  } catch {
    const ta = document.createElement('textarea');
    ta.value = text;
    ta.style.cssText = 'position:fixed;opacity:0';
    document.body.appendChild(ta);
    ta.select();
    const ok = document.execCommand('copy');
    ta.remove();
    if (!ok) throw new Error('O navegador não deixou copiar. Use "Mostrar" e copie à mão.');
  }
}

const updatedLabel = (iso) => (iso ? new Date(iso).toLocaleDateString('pt-BR', { day: '2-digit', month: '2-digit', year: '2-digit' }) : '');

export function mount(container) {
  const c = ctx = {
    container, rows: [], clients: new Map(), clientList: [],
    q: '', loading: true, error: null,
    revealed: new Map(), // id -> { value, timer } (segredos à mostra agora)
    busy: new Set(),     // ids com busca de segredo em andamento
  };
  container.innerHTML = `
    <div class="page__inner">
      <div class="toolbar">
        <label class="filter-search">
          ${icon('search')}
          <input class="input" id="crSearch" placeholder="Buscar por nome, serviço ou login…" autocomplete="off" aria-label="Buscar credenciais" />
        </label>
        <div class="toolbar__spacer"></div>
        <button type="button" class="btn btn--primary" id="crNew">${icon('plus')}<span>Nova credencial</span></button>
      </div>
      <div class="page__body" id="crBody"></div>
    </div>`;
  refreshIcons();

  const $ = (sel) => container.querySelector(sel);
  $('#crSearch').addEventListener('input', debounce(() => { c.q = $('#crSearch').value; render(c); }, 120));
  $('#crNew').addEventListener('click', () => openForm(c, null));
  $('#crBody').addEventListener('click', (e) => {
    if (e.target.closest('[data-retry]')) { load(c); return; }
    if (e.target.closest('[data-new]')) { openForm(c, null); return; }
    if (e.target.closest('a')) return; // link externo: deixa o navegador abrir
    const act = e.target.closest('[data-act]');
    const row = e.target.closest('tr[data-id]');
    if (!row) return;
    const cred = c.rows.find((x) => x.id === row.dataset.id);
    if (!cred) return;
    if (act) {
      if (act.dataset.act === 'copy-login') copyLogin(cred);
      else if (act.dataset.act === 'show') reveal(c, cred);
      else if (act.dataset.act === 'hide') hide(c, cred.id);
      else if (act.dataset.act === 'copy') copySecret(c, cred);
      return;
    }
    openForm(c, cred);
  });
  $('#crBody').addEventListener('keydown', (e) => {
    if ((e.key !== 'Enter' && e.key !== ' ') || e.target.closest('button, a')) return;
    const row = e.target.closest('tr[data-id]');
    if (row) { e.preventDefault(); openForm(c, c.rows.find((x) => x.id === row.dataset.id)); }
  });
  load(c);
}

export function unmount() {
  if (!ctx) return;
  const c = ctx;
  ctx = null;
  // nada de segredo fica na memória depois de sair da tela
  c.revealed.forEach((r) => clearTimeout(r.timer));
  c.revealed.clear();
}

async function load(c) {
  c.loading = true;
  c.error = null;
  render(c);
  try {
    const [rows, clients] = await Promise.all([fetchCredentials(), fetchClients()]);
    if (ctx !== c) return;
    c.rows = rows;
    c.clientList = clients;
    c.clients = new Map(clients.map((x) => [x.id, x]));
  } catch (e) {
    if (ctx !== c) return;
    c.error = isMissingInDb(e) ? 'As tabelas do Financeiro ainda não existem neste banco (migration 010_fin_schema.sql).' : (e.message || 'Não foi possível carregar as credenciais.');
  }
  c.loading = false;
  render(c);
}

// ----------------------------------------------------------------------------
// Segredo: mostrar / esconder / copiar
// ----------------------------------------------------------------------------
function hide(c, id) {
  const r = c.revealed.get(id);
  if (!r) return;
  clearTimeout(r.timer);
  c.revealed.delete(id);
  if (ctx === c) render(c);
}

async function fetchSecret(c, cred) {
  if (c.busy.has(cred.id)) return null;
  c.busy.add(cred.id);
  render(c);
  try {
    const value = await getCredentialSecret(cred.id);
    if (value == null || value === '') { toastError('Esta credencial não tem segredo no Vault. Edite e cadastre um.'); return null; }
    return value;
  } catch (e) {
    toastError(e);
    return null;
  } finally {
    c.busy.delete(cred.id);
    if (ctx === c) render(c);
  }
}

async function reveal(c, cred) {
  const value = await fetchSecret(c, cred);
  if (value == null || ctx !== c) return;
  hide(c, cred.id);
  c.revealed.set(cred.id, { value, timer: setTimeout(() => hide(c, cred.id), REVEAL_MS) });
  render(c);
}

async function copySecret(c, cred) {
  // se já está à mostra, copia o que está na tela; senão busca e copia sem exibir
  const value = c.revealed.get(cred.id)?.value ?? await fetchSecret(c, cred);
  if (value == null) return;
  try { await copyText(value); toastSuccess('Segredo copiado.'); } catch (e) { toastError(e); }
}

async function copyLogin(cred) {
  if (!cred.login) return;
  try { await copyText(cred.login); toastSuccess('Login copiado.'); } catch (e) { toastError(e); }
}

// ----------------------------------------------------------------------------
// Render
// ----------------------------------------------------------------------------
function filtered(c) {
  const q = fold(c.q.trim());
  return c.rows.filter((x) => !q || fold(x.name).includes(q) || fold(x.service).includes(q) || fold(x.login).includes(q));
}

function secretCellHtml(c, x) {
  const st = secretState(x);
  if (st === 'legacy') return chipHtml('Segredo precisa ser recadastrado', '#f59e0b', { title: 'Veio cifrado do sistema antigo e não dá para recuperar. Abra a credencial e cadastre o segredo de novo.' });
  if (st === 'none') return '<span class="subtle">Sem segredo</span>';
  const shown = c.revealed.get(x.id);
  const busy = c.busy.has(x.id);
  return `
    <div class="secret">
      ${shown ? `<code class="secret__value">${esc(shown.value)}</code>` : '<span class="secret__mask" aria-label="Segredo oculto">••••••••</span>'}
      <button type="button" class="btn btn--sm" data-act="${shown ? 'hide' : 'show'}" ${busy ? 'disabled' : ''} title="${shown ? 'Ocultar' : 'Mostrar por 30 segundos'}">
        ${icon(busy ? 'loader-circle' : (shown ? 'eye-off' : 'eye'), busy ? 'ico--sm spin' : 'ico--sm')}<span class="hide-md">${shown ? 'Ocultar' : 'Mostrar'}</span>
      </button>
      <button type="button" class="btn btn--sm" data-act="copy" ${busy ? 'disabled' : ''} title="Copiar o segredo sem mostrar">
        ${icon('copy', 'ico--sm')}<span class="hide-md">Copiar</span>
      </button>
    </div>`;
}

function render(c) {
  const body = c.container.querySelector('#crBody');
  if (!body) return;
  const state = (html) => { body.innerHTML = `<div class="page-state">${html}</div>`; refreshIcons(); };
  if (c.loading && !c.rows.length) return state(`${icon('loader-circle', 'spin')} Carregando credenciais…`);
  if (c.error) {
    return state(emptyHtml({
      icon: 'triangle-alert', title: 'Não deu para carregar', text: c.error,
      action: `<button type="button" class="btn" data-retry>${icon('refresh-cw')} Tentar de novo</button>`,
    }));
  }
  if (!c.rows.length) {
    return state(emptyHtml({
      icon: 'key-round', title: 'Nenhuma credencial ainda', text: 'Guarde aqui logins, senhas e tokens. O segredo fica cifrado no Vault do Supabase.',
      action: `<button type="button" class="btn btn--primary" data-new>${icon('plus')} Nova credencial</button>`,
    }));
  }
  const rows = filtered(c);
  if (!rows.length) return state(emptyHtml({ icon: 'search', title: 'Nenhuma credencial corresponde à busca' }));

  const dash = '<span class="subtle">—</span>';
  body.innerHTML = `
    <div class="table-wrap">
      <table class="table table--clickable table--dense">
        <thead><tr>
          <th>Nome / serviço</th><th class="hide-sm">Login</th><th class="hide-sm">Cliente</th>
          <th class="hide-sm">Nível</th><th class="hide-sm">Link</th><th>Segredo</th><th class="hide-sm">Atualizada</th>
        </tr></thead>
        <tbody>${rows.map((x) => {
          const cl = c.clients.get(x.client_id);
          const access = accessOf(x.access);
          return `
          <tr data-id="${x.id}" tabindex="0">
            <td><div class="entry-desc"><span class="truncate">${esc(x.name)}</span></div>
              ${x.service ? `<div class="subtle truncate hide-sm">${esc(x.service)}</div>` : ''}
              <div class="entry-sub show-sm-block"><span class="subtle truncate">${esc([x.service, x.login].filter(Boolean).join(' · '))}</span></div></td>
            <td class="hide-sm">${x.login ? `<div class="login-cell"><span class="truncate">${esc(x.login)}</span><button type="button" class="btn btn--ghost btn--icon btn--sm" data-act="copy-login" title="Copiar login" aria-label="Copiar login">${icon('copy', 'ico--sm')}</button></div>` : dash}</td>
            <td class="hide-sm">${cl ? `<div class="cell-main">${clientAvatarHtml(cl)}<span class="truncate">${esc(cl.name)}</span></div>` : dash}</td>
            <td class="hide-sm">${chipHtml(access.label, access.color)}</td>
            <td class="hide-sm">${x.url ? `<a class="ext-link" href="${esc(normalizeUrl(x.url))}" target="_blank" rel="noopener noreferrer" title="${esc(x.url)}"><span class="truncate">${esc(hostnameOf(x.url))}</span>${icon('external-link', 'ico--sm')}</a>` : dash}</td>
            <td>${secretCellHtml(c, x)}</td>
            <td class="hide-sm nowrap">${esc(updatedLabel(x.updated_at)) || dash}</td>
          </tr>`;
        }).join('')}</tbody>
      </table>
    </div>`;
  refreshIcons();
}

// ----------------------------------------------------------------------------
// Modal criar / editar
// ----------------------------------------------------------------------------
function openForm(c, cred) {
  const isNew = !cred;
  const x = cred || { access: 'editor' };
  const st = isNew ? 'none' : secretState(x);
  const opt = (value, label, selected) => `<option value="${esc(value)}" ${selected ? 'selected' : ''}>${esc(label)}</option>`;
  // nível antigo fora da lista continua escolhível só na credencial que já o tem
  const levels = ACCESS_LEVELS.some((a) => a.id === x.access) ? ACCESS_LEVELS : [...ACCESS_LEVELS, accessOf(x.access)];

  const dlg = openDialog({
    title: isNew ? 'Nova credencial' : 'Editar credencial',
    size: 'lg',
    body: `
      <div class="form-row">
        <div class="form-field"><label for="cdName">Nome</label><input class="input" id="cdName" value="${esc(x.name || '')}" placeholder="Ex.: Hostinger — conta principal" autocomplete="off" /></div>
        <div class="form-field"><label for="cdService">Serviço</label><input class="input" id="cdService" value="${esc(x.service || '')}" placeholder="Ex.: Hostinger" autocomplete="off" /></div>
      </div>
      <div class="form-row">
        ${clientSelectHtml('cdClient', c.clientList, x.client_id, { label: 'Cliente', empty: 'Sem cliente' })}
        <div class="form-field">
          <label for="cdAccess">Nível de acesso</label>
          <select class="select" id="cdAccess">${levels.map((a) => opt(a.id, a.label, a.id === x.access)).join('')}</select>
        </div>
      </div>
      <div class="form-field"><label for="cdLogin">Login</label><input class="input" id="cdLogin" value="${esc(x.login || '')}" placeholder="Usuário, e-mail ou ID da conta" autocomplete="off" /></div>
      <div class="form-field">
        <label for="cdSecret">Segredo</label>
        ${st === 'legacy' ? `<div class="info-box info-box--warn">${icon('triangle-alert')}<span>Segredo precisa ser recadastrado: o desta credencial veio cifrado do sistema antigo e não dá para recuperar.</span></div>` : ''}
        <div class="secret-input">
          <input class="input" id="cdSecret" type="password" autocomplete="new-password" spellcheck="false"
            placeholder="${st === 'vault' ? 'Deixe em branco para manter o atual' : 'Senha, token ou chave'}" />
          <button type="button" class="btn btn--icon" id="cdToggle" title="Mostrar o que foi digitado" aria-label="Mostrar ou ocultar o que foi digitado">${icon('eye')}</button>
        </div>
        <span class="hint">Fica cifrado no Vault do Supabase, fora desta tabela.${st === 'vault' ? ' Só é trocado se você digitar algo aqui.' : ''}</span>
      </div>
      <div class="form-field"><label for="cdUrl">Link</label><input class="input" id="cdUrl" value="${esc(x.url || '')}" placeholder="https://…" autocomplete="off" inputmode="url" /></div>
      <div class="form-field"><label for="cdNotes">Notas</label><textarea class="textarea" id="cdNotes" rows="2">${esc(x.notes || '')}</textarea></div>`,
    actions: [
      ...(isNew ? [] : [{ label: `${icon('trash-2')} Excluir`, cls: 'btn--danger-ghost dialog__left', onClick: () => { remove(); return false; } }]),
      { label: 'Cancelar', cls: 'btn--ghost', value: null },
      { label: 'Salvar', cls: 'btn--primary', onClick: () => { save(); return false; } },
    ],
  });

  const root = dlg.root;
  const $ = (id) => root.querySelector('#' + id);
  const saveBtn = root.querySelector('.dialog__actions .btn--primary');
  const secret = $('cdSecret');
  const notes = $('cdNotes');
  notes.addEventListener('input', () => autoResize(notes));
  setTimeout(() => autoResize(notes), 0);
  $('cdToggle').addEventListener('click', () => {
    const show = secret.type === 'password';
    secret.type = show ? 'text' : 'password';
    $('cdToggle').innerHTML = icon(show ? 'eye-off' : 'eye');
    refreshIcons();
  });
  root.querySelectorAll('input').forEach((inp) => inp.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') { e.preventDefault(); save(); }
  }));
  dlg.result.then(() => { secret.value = ''; }); // não deixa o segredo digitado num campo destacado da página

  let busy = false;
  const setBusy = (b) => {
    busy = b;
    root.querySelectorAll('.dialog__actions .btn').forEach((btn) => { btn.disabled = b; });
    saveBtn.innerHTML = b ? `${icon('loader-circle', 'spin')} Salvando…` : 'Salvar';
    refreshIcons();
  };

  async function save() {
    if (busy) return;
    const name = $('cdName').value.trim();
    if (!name) { $('cdName').focus(); return; }
    const data = {
      name,
      service: $('cdService').value.trim() || null,
      client_id: $('cdClient').value || null,
      login: $('cdLogin').value.trim() || null,
      url: $('cdUrl').value.trim() ? normalizeUrl($('cdUrl').value) : null,
      access: $('cdAccess').value,
      notes: notes.value.trim() || null,
    };
    const typed = secret.value; // só vai para o Vault se a pessoa digitou algo
    setBusy(true);
    let row;
    try {
      row = isNew ? await createCredential(data) : await updateCredential(x.id, data);
    } catch (e) {
      setBusy(false);
      toastError(e);
      return;
    }
    let secretError = null;
    if (typed) {
      try { await setCredentialSecret(row.id, typed); } catch (e) { secretError = e; }
    }
    secret.value = '';
    dlg.close('saved');
    if (secretError) toastError(`Credencial salva, mas o segredo não foi gravado. ${secretError.message || ''}`);
    else toastSuccess(isNew ? 'Credencial criada.' : 'Credencial salva.');
    if (ctx === c) { hide(c, row.id); load(c); }
  }

  async function remove() {
    if (busy) return;
    const ok = await confirmDialog({
      title: 'Excluir credencial',
      message: `Excluir "<b>${esc(x.name)}</b>" definitivamente? O segredo guardado no Vault é apagado junto.`,
      confirmText: 'Excluir',
    });
    if (!ok) return;
    setBusy(true);
    try {
      await deleteCredential(x.id);
      dlg.close('deleted');
      toastSuccess('Credencial excluída.');
      if (ctx === c) { hide(c, x.id); load(c); }
    } catch (e) {
      setBusy(false);
      toastError(e);
    }
  }
}
