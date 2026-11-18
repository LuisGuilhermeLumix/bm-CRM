// Seção Configurações (#/config/<aba>): Usuários, Categorias,
// Tipos de operação + sócios + regras de distribuição + reinvestimento/reserva,
// e Empresa (as entidades internas Lumix e Lumix REC).
import { icon, refreshIcons } from '../icons.js';
import { esc, nextPaletteColor } from '../../utils.js';
import { state, on, emit } from '../../state.js';
import { setSubRoute } from '../../router.js';
import { avatarHtml, chipHtml, clientAvatarHtml, emptyHtml } from '../common.js';
import { logoFileInputHtml, bindLogoUpload } from '../logoUpload.js';
import { openUserForm } from '../userForm.js';
import { openProfileEditor } from '../profileEditor.js';
import { fetchAllAccess, removeFromCrm } from '../../fin/users.js';
import { loadProfiles } from '../../auth.js';
import { openDialog, confirmDialog, promptDialog } from '../dialog.js';
import { openColorPopover } from '../colorPicker.js';
import { toastError, toastSuccess } from '../toast.js';
import { isMissingInDb } from '../../fin/db.js';
import { fetchClients, updateClient, internalEntities } from '../../fin/clients.js';
import {
  CATEGORY_KINDS, fetchCategories, createCategory, renameCategory, deleteCategory, categoryUsage,
  fetchOperationTypes, createOperationType, updateOperationType,
  fetchPartners, createPartner, updatePartner,
  fetchRules, saveRules, fetchSettings, saveSettings, setProfileAllowed, fetchProfileEmails,
} from '../../fin/refs.js';

const TABS = [
  { id: 'usuarios',   label: 'Usuários',                   icon: 'user-check' },
  { id: 'categorias', label: 'Categorias',                 icon: 'tags' },
  { id: 'operacoes',  label: 'Tipos de operação e regras', icon: 'chart-pie' },
  { id: 'empresa',    label: 'Empresa',                    icon: 'building-2' },
];

let ctx = null;

export function mount(container, route) {
  const c = ctx = {
    container, offs: [], seq: 0,
    tab: TABS.some((t) => t.id === route?.sub) ? route.sub : 'usuarios',
    emails: null, emailsError: null, // aba Usuários: { id: email } (RPC da migration 012)
  };
  container.innerHTML = `
    <div class="page__inner page__inner--narrow">
      <div class="tabs tabs--page" id="cfgTabs" role="tablist"></div>
      <div id="cfgBody"></div>
    </div>`;
  c.offs.push(on('profiles', () => { if (ctx === c && c.tab === 'usuarios') renderUsers(c); }));
  showTab(c, c.tab, false);
}

export function unmount() {
  if (!ctx) return;
  ctx.offs.forEach((off) => off());
  ctx = null;
}

function showTab(c, tab, updateUrl = true) {
  c.tab = tab;
  c.seq++; // invalida carregamentos da aba anterior
  if (updateUrl) setSubRoute(tab);
  const host = c.container.querySelector('#cfgTabs');
  host.innerHTML = TABS.map((t) => `
    <button type="button" class="tab ${t.id === tab ? 'is-active' : ''}" role="tab" aria-selected="${t.id === tab}" data-tab="${t.id}">${icon(t.icon, 'ico--sm')} ${esc(t.label)}</button>`).join('');
  host.querySelectorAll('[data-tab]').forEach((b) => b.addEventListener('click', () => { if (b.dataset.tab !== c.tab) showTab(c, b.dataset.tab); }));
  if (tab === 'usuarios') { renderUsers(c); loadEmails(c); }
  else if (tab === 'categorias') loadCategories(c);
  else if (tab === 'empresa') loadCompany(c);
  else loadOperations(c);
  refreshIcons();
}

const body = (c) => c.container.querySelector('#cfgBody');

function setLoading(c, text) {
  body(c).innerHTML = `<div class="page-state">${icon('loader-circle', 'spin')} ${esc(text)}</div>`;
  refreshIcons();
}

function setError(c, e, retry) {
  const msg = isMissingInDb(e) ? 'As tabelas do Financeiro ainda não existem neste banco (migration 010_fin_schema.sql).' : (e.message || 'Algo deu errado.');
  body(c).innerHTML = `<div class="page-state">${emptyHtml({
    icon: 'triangle-alert', title: 'Não deu para carregar', text: msg,
    action: `<button type="button" class="btn" data-retry>${icon('refresh-cw')} Tentar de novo</button>`,
  })}</div>`;
  refreshIcons();
  body(c).querySelector('[data-retry]').addEventListener('click', retry);
}

/** Input de nome inline: salva ao sair do campo ou no Enter; Esc desfaz. */
function bindInlineInput(input, getCurrent, save) {
  input.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') { e.preventDefault(); input.blur(); }
    if (e.key === 'Escape') { e.stopPropagation(); input.value = getCurrent() ?? ''; input.blur(); }
  });
  input.addEventListener('blur', async () => {
    const v = input.value.trim();
    const cur = getCurrent() ?? '';
    if (v === cur) { input.value = cur; return; }
    try { await save(v); } catch (e) { toastError(e); input.value = getCurrent() ?? ''; }
  });
}

// ============================================================================
// USUÁRIOS
// ============================================================================
/** E-mails, permissões e tipos de operação: uma vez por visita; a lista aparece antes e completa quando chegam. */
async function loadEmails(c, force = false) {
  if (c.emailsLoading || (c.usersLoaded && !force)) return;
  c.emailsLoading = true;
  const [emails, access, types] = await Promise.all([
    fetchProfileEmails().catch((e) => ({ __error: e })),
    fetchAllAccess().catch((e) => ({ __error: e })),
    fetchOperationTypes().catch(() => []),
  ]);
  c.emails = emails.__error ? null : emails;
  c.emailsError = emails.__error || null;
  c.allAccess = access.__error ? null : access;
  c.accessError = access.__error || null;
  c.userTypes = types;
  c.emailsLoading = false;
  c.usersLoaded = true;
  if (ctx === c && c.tab === 'usuarios') renderUsers(c);
}

/** "3 boards · Finanças · Recuperação" — o que um member enxerga, em uma linha. */
function accessSummary(c, u) {
  if (u.role === 'admin') return 'Acesso total';
  const a = c.allAccess?.[u.id];
  if (!c.allAccess) return '';
  if (!a) return 'Nenhuma permissão';
  const parts = [];
  if (a.boards.length) parts.push(`${a.boards.length} ${a.boards.length === 1 ? 'board' : 'boards'}`);
  const other = a.sections.filter((x) => x !== 'boards' && x !== 'dashboard' && !['clientes', 'financeiro', 'distribuicao', 'relatorios'].includes(x));
  if (a.sections.includes('dashboard')) parts.push('Dashboard');
  if (a.sections.some((x) => ['clientes', 'financeiro', 'distribuicao', 'relatorios'].includes(x))) {
    const names = a.operation_types.map((id) => (c.userTypes || []).find((t) => t.id === id)?.name).filter(Boolean);
    parts.push(`Finanças · ${names.length ? names.join(', ') : 'sem tipo liberado'}`);
  }
  other.forEach((x) => parts.push(x));
  return parts.join(' · ') || 'Nenhuma permissão';
}

function renderUsers(c) {
  const me = state.user?.id;
  // só quem faz parte do CRM (a policy já filtra; o in_crm explícito vale sem a 020 também)
  const users = Object.values(state.profiles).filter((u) => u.in_crm !== false || u.id === me).sort((a, b) =>
    (Number(b.allowed === true) - Number(a.allowed === true)) || a.name.localeCompare(b.name, 'pt-BR'));
  const allowedCount = users.filter((u) => u.allowed === true).length;
  const hasRoles = users.some((u) => 'role' in u); // sem a migration 018 não há papel
  body(c).innerHTML = `
    <section class="panel">
      <header class="panel__head">
        <div>
          <h2>Usuários</h2>
          <p class="hint">Administrador vê e faz tudo. Membro vê só as seções, boards e tipos de operação liberados; em finanças, só lê. As contas vêm do login do Supabase, compartilhado com outros sistemas — quem entra por fora chega bloqueado.</p>
        </div>
        <div class="row">
          <span class="panel__meta">${allowedCount} de ${users.length} liberados</span>
          <button type="button" class="btn btn--primary btn--sm" id="usAdd" ${hasRoles ? '' : 'disabled title="Falta aplicar a migration 018_permissions.sql"'}>${icon('user-plus', 'ico--sm')}<span>Adicionar usuário</span></button>
        </div>
      </header>
      ${c.emailsError ? `<div class="info-box info-box--warn">${icon('triangle-alert')}<span>Não deu para ler os e-mails. ${esc(c.emailsError.message || '')}</span></div>` : ''}
      ${c.accessError ? `<div class="info-box info-box--warn">${icon('triangle-alert')}<span>${esc(c.accessError.message || '')}</span></div>` : ''}
      <div class="settings-list">
        ${users.map((u) => `
          <div class="settings-row settings-row--user">
            ${avatarHtml(u, 'lg')}
            <span class="settings-row__who">
              <span class="settings-row__name">${esc(u.name)}${u.id === me ? ' <span class="subtle">(você)</span>' : ''}
                ${hasRoles ? chipHtml(u.role === 'admin' ? 'Administrador' : 'Membro', u.role === 'admin' ? '#8b5cf6' : '#6b7280', { small: true }) : ''}</span>
              ${c.emails?.[u.id] ? `<span class="subtle truncate">${esc(c.emails[u.id])}</span>` : ''}
              ${hasRoles ? `<span class="subtle truncate">${esc(accessSummary(c, u))}</span>` : ''}
            </span>
            <button type="button" class="btn btn--sm" data-edit="${u.id}" title="Editar nome e foto">${icon('user-pen', 'ico--sm')}<span class="hide-sm">Editar</span></button>
            ${hasRoles ? `<button type="button" class="btn btn--sm" data-perm="${u.id}">${icon('shield-check', 'ico--sm')}<span class="hide-sm">Permissões</span></button>` : ''}
            ${u.id !== me ? `<button type="button" class="btn btn--ghost btn--icon btn--sm" data-remove-user="${u.id}" title="Remover do CRM" aria-label="Remover ${esc(u.name)} do CRM">${icon('user-x')}</button>` : ''}
            <label class="toggle" title="${u.id === me ? 'Você não pode bloquear o seu próprio acesso' : ''}">
              <input type="checkbox" data-allow="${u.id}" ${u.allowed === true ? 'checked' : ''} ${u.id === me ? 'disabled' : ''} />
              <span class="toggle__track"></span>
              <span class="toggle__text">${u.allowed === true ? 'Liberado' : 'Bloqueado'}</span>
            </label>
          </div>`).join('')}
      </div>
    </section>`;
  refreshIcons();
  const reload = async () => { await loadProfiles().catch(() => {}); c.usersLoaded = false; loadEmails(c, true); };
  body(c).querySelector('#usAdd')?.addEventListener('click', () => openUserForm({ types: c.userTypes || [], onSaved: reload }));
  body(c).querySelectorAll('[data-remove-user]').forEach((b) => b.addEventListener('click', async () => {
    const u = state.profiles[b.dataset.removeUser];
    if (!u) return;
    const ok = await confirmDialog({
      title: 'Remover do CRM',
      message: `Tira o acesso de <b>${esc(u.name)}</b> ao Lumix OP. O login continua existindo no Supabase para outros sistemas.`,
      confirmText: 'Remover',
    });
    if (!ok) return;
    b.disabled = true;
    try {
      await removeFromCrm(u.id);
      delete state.profiles[u.id];
      emit('profiles');
      toastSuccess(`${u.name} foi removido do CRM.`);
    } catch (e) {
      b.disabled = false;
      toastError(e);
    }
  }));
  body(c).querySelectorAll('[data-edit]').forEach((b) => b.addEventListener('click', () => {
    openProfileEditor(b.dataset.edit, { email: c.emails?.[b.dataset.edit] || null });
  }));
  body(c).querySelectorAll('[data-perm]').forEach((b) => b.addEventListener('click', () => {
    const u = state.profiles[b.dataset.perm];
    if (!u) return;
    openUserForm({ profile: u, access: c.allAccess?.[u.id], types: c.userTypes || [], onSaved: reload });
  }));
  body(c).querySelectorAll('[data-allow]').forEach((inp) => inp.addEventListener('change', async () => {
    const id = inp.dataset.allow;
    const allowed = inp.checked;
    inp.disabled = true;
    try {
      const row = await setProfileAllowed(id, allowed); // emite 'profiles' → repinta
      toastSuccess(`${row?.name || 'Usuário'}: acesso ${allowed ? 'liberado' : 'bloqueado'}.`);
    } catch (e) {
      toastError(e);
      if (ctx === c && c.tab === 'usuarios') renderUsers(c);
    }
  }));
}

// ============================================================================
// CATEGORIAS
// ============================================================================
async function loadCategories(c) {
  const seq = c.seq;
  setLoading(c, 'Carregando categorias…');
  try {
    const kinds = Object.keys(CATEGORY_KINDS);
    const lists = await Promise.all(kinds.map(fetchCategories));
    if (ctx !== c || seq !== c.seq) return;
    c.cats = Object.fromEntries(kinds.map((k, i) => [k, lists[i]]));
    renderCategories(c);
  } catch (e) {
    if (ctx !== c || seq !== c.seq) return;
    setError(c, e, () => loadCategories(c));
  }
}

function renderCategories(c) {
  const sortCats = (list) => list.sort((a, b) => a.name.localeCompare(b.name, 'pt-BR'));
  body(c).innerHTML = `
    <div class="panel-grid">
      ${Object.entries(CATEGORY_KINDS).map(([kind, def]) => `
        <section class="panel" data-kind="${kind}">
          <header class="panel__head"><h2>${esc(def.title)}</h2><span class="panel__meta">${c.cats[kind].length}</span></header>
          <div class="settings-list">
            ${sortCats(c.cats[kind]).map((cat) => `
              <div class="settings-row">
                <input class="input input--invisible" value="${esc(cat.name)}" data-cat="${cat.id}" aria-label="Nome" />
                <button type="button" class="btn btn--ghost btn--icon btn--sm" data-del="${cat.id}" title="Excluir" aria-label="Excluir ${esc(cat.name)}">${icon('trash-2')}</button>
              </div>`).join('')}
            ${!c.cats[kind].length ? '<p class="hint">Nada cadastrado ainda.</p>' : ''}
          </div>
          <form class="add-row" data-add="${kind}">
            <input class="input" placeholder="Novo nome…" autocomplete="off" aria-label="Novo nome" />
            <button type="submit" class="btn">${icon('plus')}<span>Adicionar</span></button>
          </form>
        </section>`).join('')}
    </div>`;
  refreshIcons();

  body(c).querySelectorAll('[data-kind]').forEach((panel) => {
    const kind = panel.dataset.kind;
    const def = CATEGORY_KINDS[kind];
    const find = (id) => c.cats[kind].find((x) => String(x.id) === String(id));

    panel.querySelectorAll('[data-cat]').forEach((inp) => bindInlineInput(inp, () => find(inp.dataset.cat)?.name, async (name) => {
      if (!name) throw new Error('O nome não pode ficar vazio.');
      const row = await renameCategory(kind, find(inp.dataset.cat).id, name);
      Object.assign(find(row.id), row);
    }));

    panel.querySelectorAll('[data-del]').forEach((btn) => btn.addEventListener('click', async () => {
      const cat = find(btn.dataset.del);
      if (!cat) return;
      btn.disabled = true;
      try {
        const n = await categoryUsage(kind, cat.id);
        if (ctx !== c) return;
        if (n > 0) {
          openDialog({
            title: 'Não dá para excluir',
            body: `<p>"<b>${esc(cat.name)}</b>" está em uso por <b>${n} ${n === 1 ? def.usedIn.one : def.usedIn.many}</b>.</p><p>Troque a classificação desses lançamentos antes, ou só renomeie.</p>`,
            actions: [{ label: 'Entendi', cls: 'btn--primary', value: null }],
          });
          return;
        }
        const ok = await confirmDialog({ title: 'Excluir', message: `Excluir "<b>${esc(cat.name)}</b>"? Nenhum lançamento usa.`, confirmText: 'Excluir' });
        if (!ok) return;
        await deleteCategory(kind, cat.id);
        c.cats[kind] = c.cats[kind].filter((x) => x.id !== cat.id);
        if (ctx === c && c.tab === 'categorias') renderCategories(c);
      } catch (e) {
        toastError(e);
      } finally {
        btn.disabled = false;
      }
    }));

    panel.querySelector('[data-add]').addEventListener('submit', async (e) => {
      e.preventDefault();
      const inp = e.currentTarget.querySelector('input');
      const name = inp.value.trim();
      if (!name) { inp.focus(); return; }
      try {
        const row = await createCategory(kind, name);
        c.cats[kind].push(row);
        if (ctx !== c || c.tab !== 'categorias') return;
        renderCategories(c);
        body(c).querySelector(`[data-add="${kind}"] input`)?.focus();
      } catch (err) { toastError(err); }
    });
  });
}

// ============================================================================
// TIPOS DE OPERAÇÃO, SÓCIOS, REGRAS, REINVESTIMENTO/RESERVA
// ============================================================================
const ruleKey = (typeId, partnerId) => `${typeId}:${partnerId}`;
const toPct = (v) => { const n = Number(String(v).replace(',', '.')); return Number.isFinite(n) ? Math.round(n * 100) / 100 : 0; };
const fmtPct = (n) => String(Math.round(n * 100) / 100).replace('.', ',');

async function loadOperations(c) {
  const seq = c.seq;
  setLoading(c, 'Carregando tipos e regras…');
  try {
    const [types, partners, rules, settings] = await Promise.all([
      fetchOperationTypes(), fetchPartners(), fetchRules(),
      fetchSettings().catch((e) => ({ error: e })), // tabela vem da migration 011
    ]);
    if (ctx !== c || seq !== c.seq) return;
    c.types = types;
    c.partners = partners;
    c.rules = Object.fromEntries(rules.map((r) => [ruleKey(r.operation_type_id, r.partner_id), Number(r.pct) || 0]));
    c.draft = { ...c.rules };
    c.settingsError = settings.error || null;
    c.settings = settings.error ? { reinvest_pct: 0, reserve_pct: 0 } : settings;
    renderOperations(c);
  } catch (e) {
    if (ctx !== c || seq !== c.seq) return;
    setError(c, e, () => loadOperations(c));
  }
}

function renderOperations(c) {
  const alive = () => ctx === c && c.tab === 'operacoes';
  body(c).innerHTML = `
    <section class="panel">
      <header class="panel__head">
        <div><h2>Tipos de operação</h2><p class="hint">Cada cliente pertence a um tipo, e cada tipo tem a sua regra de divisão. Tipo desativado some das listas de escolha, mas o histórico continua.</p></div>
      </header>
      <div class="settings-list">
        ${c.types.map((t) => `
          <div class="settings-row ${t.active ? '' : 'is-off'}">
            <button type="button" class="color-btn color-btn--sm" data-type-color="${t.id}" style="--c:${esc(t.color)}" title="Cor"></button>
            <input class="input input--invisible" value="${esc(t.name)}" data-type-name="${t.id}" aria-label="Nome do tipo" />
            <label class="toggle"><input type="checkbox" data-type-active="${t.id}" ${t.active ? 'checked' : ''} /><span class="toggle__track"></span><span class="toggle__text">Ativo</span></label>
          </div>`).join('')}
        ${!c.types.length ? '<p class="hint">Nenhum tipo cadastrado.</p>' : ''}
      </div>
      <form class="add-row" id="opAddType">
        <input class="input" placeholder="Novo tipo de operação…" autocomplete="off" aria-label="Novo tipo de operação" />
        <button type="submit" class="btn">${icon('plus')}<span>Adicionar</span></button>
      </form>
    </section>

    <section class="panel">
      <header class="panel__head">
        <div><h2>Sócios</h2><p class="hint">Sócio desativado não entra em novas distribuições.</p></div>
        <button type="button" class="btn btn--sm" id="opAddPartner">${icon('user-plus')}<span>Novo sócio</span></button>
      </header>
      <div class="settings-list">
        ${c.partners.map((p) => `
          <div class="settings-row settings-row--partner ${p.active ? '' : 'is-off'}">
            <button type="button" class="color-btn color-btn--sm" data-partner-color="${p.id}" style="--c:${esc(p.color || '#6b7280')}" title="Cor"></button>
            <input class="input input--invisible settings-row__grow" value="${esc(p.name)}" data-partner-name="${p.id}" aria-label="Nome do sócio" />
            <input class="input input--sm settings-row__pix" value="${esc(p.pix_key || '')}" data-partner-pix="${p.id}" placeholder="Chave PIX" aria-label="Chave PIX de ${esc(p.name)}" autocomplete="off" />
            <label class="toggle"><input type="checkbox" data-partner-active="${p.id}" ${p.active ? 'checked' : ''} /><span class="toggle__track"></span><span class="toggle__text">Ativo</span></label>
          </div>`).join('')}
        ${!c.partners.length ? '<p class="hint">Nenhum sócio cadastrado.</p>' : ''}
      </div>
    </section>

    <section class="panel">
      <header class="panel__head">
        <div><h2>Regras de distribuição</h2><p class="hint">Quanto do lucro de cada tipo vai para cada sócio. Cada linha de tipo ativo precisa somar 100%.</p></div>
      </header>
      <div id="opRules"></div>
    </section>

    <section class="panel">
      <header class="panel__head">
        <div><h2>Reinvestimento e reserva</h2><p class="hint">Percentuais abatidos do lucro antes de dividir entre os sócios. Com 0%, todo o lucro é distribuído.</p></div>
      </header>
      ${c.settingsError ? `<div class="info-box info-box--warn">${icon('triangle-alert')}<span>${esc(c.settingsError.message || 'Não foi possível ler os parâmetros.')}</span></div>` : ''}
      <form class="form-row form-row--end" id="opSettings">
        <div class="form-field"><label for="opReinvest">Reinvestir (%)</label><input class="input" id="opReinvest" inputmode="decimal" value="${fmtPct(c.settings.reinvest_pct)}" ${c.settingsError ? 'disabled' : ''} /></div>
        <div class="form-field"><label for="opReserve">Reserva (%)</label><input class="input" id="opReserve" inputmode="decimal" value="${fmtPct(c.settings.reserve_pct)}" ${c.settingsError ? 'disabled' : ''} /></div>
        <button type="submit" class="btn btn--primary" ${c.settingsError ? 'disabled' : ''}>Salvar</button>
      </form>
    </section>`;
  refreshIcons();
  renderRules(c);

  const root = body(c);
  const typeById = (id) => c.types.find((t) => t.id === id);
  const partnerById = (id) => c.partners.find((p) => p.id === id);
  const rerender = () => { if (alive()) renderOperations(c); };

  // --- tipos
  root.querySelectorAll('[data-type-name]').forEach((inp) => bindInlineInput(inp, () => typeById(inp.dataset.typeName)?.name, async (name) => {
    if (!name) throw new Error('O nome não pode ficar vazio.');
    Object.assign(typeById(inp.dataset.typeName), await updateOperationType(inp.dataset.typeName, { name }));
    if (alive()) renderRules(c);
  }));
  root.querySelectorAll('[data-type-color]').forEach((btn) => btn.addEventListener('click', () => {
    const t = typeById(btn.dataset.typeColor);
    openColorPopover(btn, t.color, async (color) => {
      try { Object.assign(t, await updateOperationType(t.id, { color })); rerender(); } catch (e) { toastError(e); }
    });
  }));
  root.querySelectorAll('[data-type-active]').forEach((inp) => inp.addEventListener('change', async () => {
    const t = typeById(inp.dataset.typeActive);
    try { Object.assign(t, await updateOperationType(t.id, { active: inp.checked })); } catch (e) { toastError(e); }
    rerender();
  }));
  root.querySelector('#opAddType').addEventListener('submit', async (e) => {
    e.preventDefault();
    const inp = e.currentTarget.querySelector('input');
    const name = inp.value.trim();
    if (!name) { inp.focus(); return; }
    try {
      c.types.push(await createOperationType({ name, color: nextPaletteColor(c.types.map((t) => t.color)) }, c.types));
      rerender();
      toastSuccess('Tipo criado. Defina a regra de distribuição dele abaixo.');
    } catch (err) { toastError(err); }
  });

  // --- sócios
  root.querySelectorAll('[data-partner-name]').forEach((inp) => bindInlineInput(inp, () => partnerById(inp.dataset.partnerName)?.name, async (name) => {
    if (!name) throw new Error('O nome não pode ficar vazio.');
    Object.assign(partnerById(inp.dataset.partnerName), await updatePartner(inp.dataset.partnerName, { name }));
    if (alive()) renderRules(c);
  }));
  root.querySelectorAll('[data-partner-pix]').forEach((inp) => bindInlineInput(inp, () => partnerById(inp.dataset.partnerPix)?.pix_key || '', async (pix) => {
    Object.assign(partnerById(inp.dataset.partnerPix), await updatePartner(inp.dataset.partnerPix, { pix_key: pix || null }));
  }));
  root.querySelectorAll('[data-partner-color]').forEach((btn) => btn.addEventListener('click', () => {
    const p = partnerById(btn.dataset.partnerColor);
    openColorPopover(btn, p.color, async (color) => {
      try { Object.assign(p, await updatePartner(p.id, { color })); rerender(); } catch (e) { toastError(e); }
    });
  }));
  root.querySelectorAll('[data-partner-active]').forEach((inp) => inp.addEventListener('change', async () => {
    const p = partnerById(inp.dataset.partnerActive);
    try { Object.assign(p, await updatePartner(p.id, { active: inp.checked })); } catch (e) { toastError(e); }
    rerender();
  }));
  root.querySelector('#opAddPartner').addEventListener('click', async () => {
    const name = (await promptDialog({ title: 'Novo sócio', label: 'Nome', confirmText: 'Criar' }))?.trim();
    if (!name) return;
    try {
      c.partners.push(await createPartner({ name, color: nextPaletteColor(c.partners.map((p) => p.color)) }, c.partners));
      rerender();
    } catch (err) { toastError(err); }
  });

  // --- reinvestimento / reserva
  root.querySelector('#opSettings').addEventListener('submit', async (e) => {
    e.preventDefault();
    const reinvest = toPct(root.querySelector('#opReinvest').value);
    const reserve = toPct(root.querySelector('#opReserve').value);
    if (reinvest < 0 || reserve < 0 || reinvest + reserve > 100) {
      toastError('Reinvestir + reserva precisam ficar entre 0% e 100%.');
      return;
    }
    const btn = e.currentTarget.querySelector('button');
    btn.disabled = true;
    try {
      await saveSettings({ reinvest_pct: reinvest, reserve_pct: reserve });
      c.settings = { reinvest_pct: reinvest, reserve_pct: reserve };
      toastSuccess('Percentuais salvos.');
    } catch (err) { toastError(err); }
    btn.disabled = false;
  });
}

/** Grade tipo × sócio. Edita em rascunho (c.draft) e grava tudo em "Salvar regras". */
function renderRules(c) {
  const host = body(c).querySelector('#opRules');
  if (!host) return;
  if (!c.types.length || !c.partners.length) {
    host.innerHTML = '<p class="hint">Cadastre ao menos um tipo de operação e um sócio para definir as regras.</p>';
    return;
  }
  const pct = (t, p) => c.draft[ruleKey(t.id, p.id)] ?? 0;
  const sumOf = (t) => Math.round(c.partners.reduce((s, p) => s + pct(t, p), 0) * 100) / 100;
  const sumOk = (t) => Math.abs(sumOf(t) - 100) < 0.005;
  const dirty = () => c.types.some((t) => c.partners.some((p) => pct(t, p) !== (c.rules[ruleKey(t.id, p.id)] ?? 0)));
  const sumChip = (t) => {
    const s = sumOf(t);
    if (sumOk(t)) return chipHtml(`${fmtPct(s)}%`, '#22c55e', { title: 'Soma 100%' });
    return chipHtml(`${fmtPct(s)}%`, t.active ? '#ef4444' : '#6b7280', { title: t.active ? `Faltam ${fmtPct(Math.round((100 - s) * 100) / 100)} p.p. para 100%` : 'Tipo desativado' });
  };

  host.innerHTML = `
    <div class="table-wrap">
      <table class="table table--rules">
        <thead><tr>
          <th>Tipo de operação</th>
          ${c.partners.map((p) => `<th class="num"><span class="th-dot"><span class="dot" style="--c:${esc(p.color || '#6b7280')}"></span>${esc(p.name)}${p.active ? '' : ' <span class="subtle">(inativo)</span>'}</span></th>`).join('')}
          <th class="num">Soma</th>
        </tr></thead>
        <tbody>${c.types.map((t) => `
          <tr data-type="${t.id}" class="${t.active ? '' : 'is-off'}">
            <td><span class="th-dot"><span class="dot" style="--c:${esc(t.color)}"></span><span class="truncate">${esc(t.name)}</span>${t.active ? '' : ' <span class="subtle">(inativo)</span>'}</span></td>
            ${c.partners.map((p) => `<td class="num"><span class="pct-input"><input class="input input--sm" inputmode="decimal" value="${fmtPct(pct(t, p))}" data-rule="${ruleKey(t.id, p.id)}" aria-label="% de ${esc(p.name)} em ${esc(t.name)}" /><span>%</span></span></td>`).join('')}
            <td class="num" data-sum>${sumChip(t)}</td>
          </tr>`).join('')}</tbody>
      </table>
    </div>
    <div class="panel__foot">
      <span class="hint" id="opRulesMsg"></span>
      <button type="button" class="btn btn--ghost" id="opRulesReset">Desfazer</button>
      <button type="button" class="btn btn--primary" id="opRulesSave">Salvar regras</button>
    </div>`;

  const saveBtn = host.querySelector('#opRulesSave');
  const resetBtn = host.querySelector('#opRulesReset');
  const msg = host.querySelector('#opRulesMsg');
  const sync = () => {
    const d = dirty();
    saveBtn.disabled = !d;
    resetBtn.disabled = !d;
    msg.textContent = d ? 'Alterações não salvas.' : '';
  };
  sync();

  host.querySelectorAll('[data-rule]').forEach((inp) => {
    inp.addEventListener('focus', () => inp.select());
    inp.addEventListener('input', () => {
      c.draft[inp.dataset.rule] = Math.max(0, Math.min(100, toPct(inp.value)));
      const t = c.types.find((x) => x.id === inp.closest('tr').dataset.type);
      inp.closest('tr').querySelector('[data-sum]').innerHTML = sumChip(t);
      sync();
    });
    inp.addEventListener('blur', () => { inp.value = fmtPct(c.draft[inp.dataset.rule] ?? 0); });
    inp.addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); inp.blur(); if (!saveBtn.disabled) saveBtn.click(); } });
  });

  resetBtn.addEventListener('click', () => { c.draft = { ...c.rules }; renderRules(c); });

  saveBtn.addEventListener('click', async () => {
    const bad = c.types.filter((t) => t.active && !sumOk(t));
    if (bad.length) {
      toastError(`A soma precisa dar 100% em: ${bad.map((t) => `${t.name} (${fmtPct(sumOf(t))}%)`).join(', ')}.`);
      host.querySelector(`tr[data-type="${bad[0].id}"] input`)?.focus();
      return;
    }
    saveBtn.disabled = true;
    try {
      const rows = c.types.flatMap((t) => c.partners.map((p) => ({ operation_type_id: t.id, partner_id: p.id, pct: pct(t, p) })));
      await saveRules(rows);
      c.rules = Object.fromEntries(rows.map((r) => [ruleKey(r.operation_type_id, r.partner_id), r.pct]));
      c.draft = { ...c.rules };
      toastSuccess('Regras de distribuição salvas.');
      if (ctx === c && c.tab === 'operacoes') renderRules(c);
    } catch (e) {
      toastError(e);
      saveBtn.disabled = false;
    }
  });
}

// ============================================================================
// EMPRESA — entidades internas (fin_clients.is_internal)
// Só edita nome, logo e tipo de operação. Não cria nem exclui: são as duas do
// seed da migration 014; para mais uma, é no SQL.
// ============================================================================
async function loadCompany(c) {
  const seq = c.seq;
  setLoading(c, 'Carregando a empresa…');
  try {
    const [clients, types] = await Promise.all([fetchClients(), fetchOperationTypes()]);
    if (ctx !== c || seq !== c.seq) return;
    c.entities = internalEntities(clients);
    c.entityTypes = types;
    c.entitiesNoColumn = clients.length > 0 && !('is_internal' in clients[0]); // migration 014 não aplicada
    renderCompany(c);
  } catch (e) {
    if (ctx !== c || seq !== c.seq) return;
    setError(c, e, () => loadCompany(c));
  }
}

function renderCompany(c) {
  const alive = () => ctx === c && c.tab === 'empresa';
  const typeName = (id) => c.entityTypes.find((t) => t.id === id)?.name;
  const effect = (e) => (e.operation_type_id
    ? `As despesas lançadas aqui entram direto no lucro de <b>${esc(typeName(e.operation_type_id) || 'um tipo')}</b>.`
    : 'As despesas lançadas aqui são custo geral: rateadas entre os tipos de operação, proporcional à receita paga de cada um no mês.');

  if (!c.entities.length) {
    body(c).innerHTML = `
      <section class="panel">
        <header class="panel__head"><div><h2>Empresa</h2></div></header>
        <div class="info-box info-box--warn">${icon('triangle-alert')}<span>${c.entitiesNoColumn
          ? 'Falta aplicar a migration 014_fin_adjustments.sql no banco: é ela que cria as entidades Lumix e Lumix REC.'
          : 'Nenhuma entidade interna cadastrada. A migration 014_fin_adjustments.sql cria Lumix e Lumix REC.'}</span></div>
      </section>`;
    refreshIcons();
    return;
  }

  body(c).innerHTML = `
    <section class="panel">
      <header class="panel__head">
        <div>
          <h2>Empresa</h2>
          <p class="hint">Os custos da própria Lumix são lançados nestas entidades, não em clientes. Elas não aparecem na tela Clientes; nos lançamentos, ficam no topo da lista "Empresa / cliente".</p>
        </div>
      </header>
      <div class="entity-list">
        ${c.entities.map((e) => `
          <div class="entity" data-entity="${e.id}">
            <div class="entity__logo">
              <button type="button" class="logo-btn" data-logo title="Enviar logo (PNG, JPG, WebP ou SVG, até 2 MB)">${clientAvatarHtml(e, 'xl')}</button>
              ${logoFileInputHtml('data-file')}
            </div>
            <div class="entity__fields">
              <div class="form-row">
                <div class="form-field">
                  <label for="enName-${e.id}">Nome</label>
                  <input class="input" id="enName-${e.id}" data-name value="${esc(e.name)}" autocomplete="off" />
                </div>
                <div class="form-field">
                  <label for="enType-${e.id}">Tipo de operação</label>
                  <select class="select" id="enType-${e.id}" data-type>
                    <option value="" ${e.operation_type_id ? '' : 'selected'}>Custo geral — rateado</option>
                    ${c.entityTypes.filter((t) => t.active || t.id === e.operation_type_id).map((t) => `<option value="${t.id}" ${t.id === e.operation_type_id ? 'selected' : ''}>${esc(t.name)}</option>`).join('')}
                  </select>
                </div>
              </div>
              <p class="hint" data-effect>${effect(e)}</p>
              <div class="logo-actions">
                <button type="button" class="btn btn--sm" data-pick>${icon('image-plus', 'ico--sm')} ${e.logo_url ? 'Trocar logo' : 'Enviar logo'}</button>
                ${e.logo_url ? `<button type="button" class="btn btn--ghost btn--sm" data-remove>${icon('trash', 'ico--sm')} Remover logo</button>` : ''}
              </div>
            </div>
          </div>`).join('')}
      </div>
    </section>`;
  refreshIcons();

  body(c).querySelectorAll('[data-entity]').forEach((card) => {
    const find = () => c.entities.find((x) => x.id === card.dataset.entity);
    const apply = (row) => { Object.assign(find(), row); if (alive()) renderCompany(c); };

    bindInlineInput(card.querySelector('[data-name]'), () => find()?.name, async (name) => {
      if (!name) throw new Error('O nome não pode ficar vazio.');
      Object.assign(find(), await updateClient(find().id, { name }));
      toastSuccess('Nome salvo.');
    });

    card.querySelector('[data-type]').addEventListener('change', async (ev) => {
      const sel = ev.currentTarget;
      sel.disabled = true;
      try {
        apply(await updateClient(find().id, { operation_type_id: sel.value || null }));
        toastSuccess('Tipo de operação salvo.');
      } catch (e) {
        toastError(e);
        if (alive()) renderCompany(c);
      }
    });

    bindLogoUpload({
      input: card.querySelector('[data-file]'),
      triggers: [card.querySelector('[data-logo]'), card.querySelector('[data-pick]')],
      removeBtn: card.querySelector('[data-remove]'),
      getClient: find,
      onChange: apply,
      setBusy: (b) => card.querySelectorAll('button').forEach((btn) => { btn.disabled = b; }),
    });
  });
}
