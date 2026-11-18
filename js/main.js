// Bootstrap: configuração, autenticação, shell, rotas e atalhos
import { isConfigured } from './supabase.js';
import { state, on, emit, sortedBoards } from './state.js';
import { getSession, onAuthChange, loadProfiles, signOut } from './auth.js';
import { loadBoards, openBoard, closeBoard, suspendBoard, createFirstBoard, LAST_BOARD_KEY } from './boards.js';
import { subscribeGlobal, subscribeBoards, unsubscribeBoards, unsubscribeAll } from './realtime.js';
import { startRouter, stopRouter, isRouterActive, syncBoardRoute } from './router.js';
import { fetchColumns } from './columns.js';
import { fetchFields } from './fields.js';
import { fetchTags } from './tags.js';
import { fetchCards } from './cards.js';
import { storage, isTyping } from './utils.js';
import { icon, refreshIcons } from './ui/icons.js';
import { initTheme } from './ui/theme.js';
import { renderLogin, renderSetup, renderNoAccess } from './ui/login.js';
import { initSidebar } from './ui/sidebar.js';
import { initTopbar, newCardFlow } from './ui/topbar.js';
import { initKanban } from './ui/kanban.js';
import { PAGES } from './ui/pages/index.js';
import { closeTop, hasOpenLayers } from './ui/dialog.js';
import { toast, toastError } from './ui/toast.js';

const app = () => document.getElementById('app');
let started = false;
let recoveryMode = false;
let currentPage = null;   // módulo da seção montada em #page (fora de Boards)
let boardsLive = false;   // seção Boards aberta: realtime da lista de boards ligado
let boardsStale = false;  // a lista de boards pode ter mudado enquanto estávamos em outra seção

async function boot() {
  if (!isConfigured) { renderSetup(app()); return; }
  initTheme();
  initKeyboard();

  // Link de "esqueci a senha" volta com #access_token=...&type=recovery
  recoveryMode = location.hash.includes('type=recovery');

  onAuthChange((event, session) => {
    // supabase-js pede para não chamar o client dentro do callback: adia um tick
    setTimeout(() => handleAuth(event, session), 0);
  });

  if (recoveryMode) {
    showRecovery();
    return;
  }

  let session = null;
  try { session = await getSession(); } catch (e) { console.warn(e); }
  if (session) startApp(session); else renderLogin(app());
}

function showRecovery() {
  renderLogin(app(), {
    mode: 'recovery',
    onRecovered: async () => {
      recoveryMode = false;
      history.replaceState(null, '', location.pathname);
      const s = await getSession().catch(() => null);
      if (s) startApp(s); else renderLogin(app());
    },
  });
}

function handleAuth(event, session) {
  if (event === 'PASSWORD_RECOVERY') { recoveryMode = true; teardown(); showRecovery(); return; }
  if (event === 'SIGNED_OUT') { recoveryMode = false; teardown(); renderLogin(app()); return; }
  if (event === 'SIGNED_IN' && session && !started && !recoveryMode) startApp(session);
}

function closeLayers() {
  while (closeTop()) { /* fecha modais/painéis/menus abertos */ }
}

function teardown() {
  started = false;
  stopRouter();
  unmountPage();
  boardsLive = false;
  boardsStale = false;
  unsubscribeAll();
  closeLayers();
  state.session = null; state.user = null; state.profile = null;
  state.boards = []; state.boardId = null;
  state.columns = []; state.fields = []; state.tags = []; state.cards = [];
}

async function startApp(session) {
  if (started) return;
  started = true;
  state.session = session;
  state.user = session.user;

  const host = app();
  host.innerHTML = `
    <div class="shell" id="shell">
      <aside class="sidebar" id="sidebar"></aside>
      <div class="sidebar-backdrop" id="sidebarBackdrop"></div>
      <main class="main">
        <header class="topbar hidden" id="topbar"></header>
        <section class="board" id="board">
          <div class="board__loading">${icon('loader-circle', 'spin')} Carregando…</div>
        </section>
        <section class="page hidden" id="page"></section>
      </main>
    </div>`;
  refreshIcons();

  try {
    await loadProfiles();
  } catch (e) {
    toastError(e);
  }
  if (!started) return; // deslogou no meio

  // Lista de permitidos (migração 002): logou, mas profiles.allowed = false.
  // Se a coluna não existir (migração não aplicada), allowed vem undefined e passa.
  if (state.profile && state.profile.allowed === false) {
    renderNoAccess(host, { email: state.user.email, onSignOut: () => signOut().catch(toastError) });
    return;
  }

  try {
    await loadBoards();
  } catch (e) {
    toastError(e);
  }
  if (!started) return;

  initSidebar();
  initTopbar();
  initKanban();
  subscribeGlobal();

  on('boards', ensureBoard);
  on('board', onBoardEvent);
  on('board-deleted-remotely', onBoardDeletedRemotely);
  initResync();
  startRouter(applyRoute); // lê a URL (ou a última rota) e abre a seção
}

function onBoardEvent() {
  if (!state.boardId) ensureBoard();
}

function onBoardDeletedRemotely() {
  toast('Este board foi excluído pela outra pessoa.', { type: 'warning' });
  state.boardId = null;
  ensureBoard();
}

// ----------------------------------------------------------------------------
// Rotas / seções
// ----------------------------------------------------------------------------

/**
 * Aplica a rota (state.route já foi atualizado pelo router).
 * Boards usa #board (kanban); as outras seções montam o módulo em #page.
 * Ao sair de Boards, solta o realtime do board e da lista de boards.
 */
function applyRoute(route, fromBrowser) {
  if (!started) return;
  // voltar/avançar ou link clicado com modal, painel ou menu aberto
  if (fromBrowser) closeLayers();
  const boardEl = document.getElementById('board');
  const pageEl = document.getElementById('page');
  if (!boardEl || !pageEl) return;
  unmountPage();

  if (route.section === 'boards') {
    pageEl.classList.add('hidden');
    boardEl.classList.remove('hidden');
    if (!boardsLive) {
      boardsLive = true;
      subscribeBoards();
      if (boardsStale) { boardsStale = false; loadBoards().catch(toastError); }
    }
    emit('route');
    ensureBoard();
    return;
  }

  if (boardsLive) { boardsLive = false; unsubscribeBoards(); }
  boardsStale = true;
  if (state.boardId) suspendBoard();
  boardEl.classList.add('hidden');
  pageEl.classList.remove('hidden');
  pageEl.scrollTop = 0;
  currentPage = PAGES[route.section];
  try { currentPage.mount(pageEl, route); } catch (e) { console.error(e); toastError(e); }
  emit('route');
}

function unmountPage() {
  if (!currentPage) return;
  try { currentPage.unmount(); } catch (e) { console.error(e); }
  currentPage = null;
  const pageEl = document.getElementById('page');
  if (pageEl) pageEl.innerHTML = '';
}

/**
 * Na seção Boards, garante que o board da rota está aberto. Rota sem board (ou
 * com um que não existe mais) cai no último aberto, senão no primeiro; sem
 * boards, mostra a tela de boas-vindas.
 */
function ensureBoard() {
  // isRouterActive: os listeners sobrevivem ao logout, e num novo login o
  // loadBoards() emite 'boards' antes de a rota da URL ter sido lida
  if (!started || !isRouterActive() || state.route.section !== 'boards') return;
  const boards = sortedBoards();
  if (!boards.length) {
    if (state.boardId) closeBoard(); else syncBoardRoute(null);
    renderWelcome();
    return;
  }
  const has = (id) => !!id && boards.some((b) => b.id === id);
  const wanted = state.route.boardId;
  if (has(wanted)) {
    // openBoard marca state.boardId na hora, então eventos durante o load não reabrem
    if (wanted !== state.boardId) openBoard(wanted).catch(toastError);
    return;
  }
  if (has(state.boardId)) { syncBoardRoute(state.boardId); return; }
  const last = storage.get(LAST_BOARD_KEY);
  openBoard(has(last) ? last : boards[0].id).catch(toastError);
}

function renderWelcome() {
  const board = document.getElementById('board');
  if (!board) return;
  board.innerHTML = `
    <div class="welcome">
      <div class="welcome__card">
        <span class="brand__logo brand__logo--img"><img src="assets/lumix-logo.png" alt="Lumix BM" /></span>
        <h2>Bem-vindo ao Lumix BM</h2>
        <p>Você ainda não tem nenhum board. Comece com um board <b>Clientes</b> já configurado com colunas (Lead → Contato feito → Proposta → Ativo → Perdido) e campos padrão. Dá para mudar tudo depois.</p>
        <button class="btn btn--primary" id="btnFirstBoard">${icon('plus')} Criar primeiro board</button>
      </div>
    </div>`;
  refreshIcons();
  board.querySelector('#btnFirstBoard').addEventListener('click', async (e) => {
    const btn = e.currentTarget;
    btn.disabled = true;
    btn.innerHTML = `${icon('loader-circle', 'spin')} Criando…`;
    refreshIcons();
    try {
      await createFirstBoard(); // emite 'boards' -> ensureBoard abre o novo board
    } catch (err) {
      toastError(err);
      renderWelcome();
    }
  });
}

/** Atalhos: Esc = fecha o que estiver aberto; em Boards, N = novo card e / = busca */
function initKeyboard() {
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') {
      if (closeTop()) { e.preventDefault(); return; }
      if (isTyping()) document.activeElement.blur();
      return;
    }
    if (isTyping() || e.ctrlKey || e.metaKey || e.altKey) return;
    if (!isRouterActive() || state.route.section !== 'boards') return; // atalhos do kanban só em Boards
    if (e.key === '/') {
      const s = document.getElementById('searchInput');
      if (s) { e.preventDefault(); s.closest('.search')?.classList.add('is-open'); s.focus(); s.select(); }
      return;
    }
    if (e.key.toLowerCase() === 'n' && state.boardId && !hasOpenLayers()) {
      e.preventDefault();
      newCardFlow();
    }
  });
}

/**
 * Quando a aba fica em segundo plano por um tempo, o websocket do realtime
 * pode cair e eventos se perdem. Ao voltar, recarrega o board aberto.
 */
function initResync() {
  let hiddenAt = 0;
  document.addEventListener('visibilitychange', async () => {
    if (document.visibilityState === 'hidden') { hiddenAt = Date.now(); return; }
    if (!state.boardId || state.dragging || Date.now() - hiddenAt < 20000) return;
    const id = state.boardId;
    try {
      const [columns, fields, tags, cards] = await Promise.all([fetchColumns(id), fetchFields(id), fetchTags(id), fetchCards(id)]);
      if (state.boardId !== id) return;
      state.columns = columns; state.fields = fields; state.tags = tags; state.cards = cards;
      emit('columns'); emit('fields'); emit('tags'); emit('cards');
      loadBoards().catch(() => {});
    } catch { /* silencioso: realtime continua tentando */ }
  });
}

boot().catch((e) => {
  console.error(e);
  toastError(e);
});
