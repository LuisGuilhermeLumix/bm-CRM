// Sidebar: lista de boards, novo board, usuário e tema
import Sortable from 'https://cdn.jsdelivr.net/npm/sortablejs@1.15.6/modular/sortable.esm.js';
import { icon, refreshIcons } from './icons.js';
import { esc, storage, isMobile } from '../utils.js';
import { state, on, sortedBoards } from '../state.js';
import { openBoard, reorderBoards } from '../boards.js';
import { signOut } from '../auth.js';
import { currentTheme, toggleTheme } from './theme.js';
import { openMenu, pushClosable, removeClosable } from './dialog.js';
import { openProfileEditor } from './profileEditor.js';
import { toastError } from './toast.js';
import { openNewBoardDialog } from './boardForm.js';
import { avatarHtml, emptyHtml } from './common.js';

const COLLAPSE_KEY = 'lumix.sidebarCollapsed';
let sortable = null;
let drawerOpen = false;

const shell = () => document.getElementById('shell');

export function initSidebar() {
  if (storage.get(COLLAPSE_KEY)) shell()?.classList.add('sidebar-collapsed');
  ['boards', 'board', 'profiles', 'theme'].forEach((ev) => on(ev, render));
  document.getElementById('sidebarBackdrop')?.addEventListener('click', closeSidebar);
  render();
}

export function openSidebar() {
  if (drawerOpen) return;
  drawerOpen = true;
  shell()?.classList.add('sidebar-open');
  pushClosable(closeSidebar);
}

export function closeSidebar() {
  if (!drawerOpen) return;
  drawerOpen = false;
  shell()?.classList.remove('sidebar-open');
  removeClosable(closeSidebar);
}

export function toggleSidebar() {
  if (isMobile()) {
    drawerOpen ? closeSidebar() : openSidebar();
  } else {
    const s = shell();
    s.classList.toggle('sidebar-collapsed');
    storage.set(COLLAPSE_KEY, s.classList.contains('sidebar-collapsed'));
  }
}

function render() {
  const host = document.getElementById('sidebar');
  if (!host) return;
  const boards = sortedBoards();
  const p = state.profile;
  const theme = currentTheme();
  sortable?.destroy();
  sortable = null;

  host.innerHTML = `
    <div class="sidebar__head">
      <div class="brand">
        <span class="brand__logo"><img src="assets/lumix-logo.png" alt="Lumix BM" /></span>
        <span class="brand__text">Lumix BM</span>
      </div>
      <button class="btn btn--ghost btn--icon btn--sm btn-collapse-sidebar" id="btnCollapse" title="Recolher / expandir">${icon('panel-left')}</button>
    </div>
    <div class="sidebar__section">
      <span>Boards</span>
      <button class="btn btn--ghost btn--icon btn--sm btn-new-board" title="Novo board">${icon('plus')}</button>
    </div>
    <nav class="sidebar__boards" id="boardsList">
      ${boards.map((b) => `
        <button class="board-item ${b.id === state.boardId ? 'is-active' : ''}" data-board-id="${b.id}" style="--c:${esc(b.color)}" title="${esc(b.name)}">
          <span class="board-item__icon">${icon(b.icon || 'kanban')}</span>
          <span class="board-item__name">${esc(b.name)}</span>
        </button>`).join('')}
      ${!boards.length ? emptyHtml({ icon: 'layout-grid', text: 'Nenhum board ainda.', small: true }) : ''}
    </nav>
    <div style="padding: 6px 10px 10px">
      <button class="btn btn--block btn-new-board">${icon('plus')}<span>Novo board</span></button>
    </div>
    <div class="sidebar__footer">
      <button class="user-chip" id="userMenu" title="${esc(p?.name || '')}">
        ${avatarHtml(p || { name: state.user?.email || '', avatar_color: '#6b7280' })}
        <span class="user-chip__name">${esc(p?.name || state.user?.email || '')}</span>
        ${icon('chevron-up', 'ico--sm')}
      </button>
      <button class="btn btn--ghost btn--icon btn--sm" id="btnTheme" title="${theme === 'dark' ? 'Tema claro' : 'Tema escuro'}">${icon(theme === 'dark' ? 'sun' : 'moon')}</button>
    </div>`;
  refreshIcons();

  host.querySelector('#btnCollapse').addEventListener('click', toggleSidebar);
  host.querySelectorAll('[data-board-id]').forEach((b) => b.addEventListener('click', async () => {
    closeSidebar();
    if (b.dataset.boardId === state.boardId) return;
    try { await openBoard(b.dataset.boardId); } catch (e) { toastError(e); }
  }));
  host.querySelectorAll('.btn-new-board').forEach((b) => b.addEventListener('click', async () => {
    closeSidebar();
    const board = await openNewBoardDialog();
    if (board) openBoard(board.id).catch(toastError);
  }));
  host.querySelector('#btnTheme').addEventListener('click', toggleTheme);
  host.querySelector('#userMenu').addEventListener('click', (e) => {
    openMenu(e.currentTarget, [
      { label: p?.name || state.user?.email || '', header: true },
      { label: 'Editar perfil', icon: 'user-pen', value: 'profile' },
      { label: theme === 'dark' ? 'Tema claro' : 'Tema escuro', icon: theme === 'dark' ? 'sun' : 'moon', value: 'theme' },
      'sep',
      { label: 'Sair', icon: 'log-out', value: 'logout', danger: true },
    ], async (v) => {
      if (v === 'profile') openProfileEditor();
      if (v === 'theme') toggleTheme();
      if (v === 'logout') { try { await signOut(); } catch (err) { toastError(err); } }
    });
  });

  const list = host.querySelector('#boardsList');
  if (boards.length > 1) {
    sortable = new Sortable(list, {
      draggable: '.board-item', animation: 150, delay: 150, delayOnTouchOnly: true, ghostClass: 'sortable-ghost',
      onEnd: () => setTimeout(() => {
        const ids = [...list.querySelectorAll('.board-item')].map((b) => b.dataset.boardId);
        if (ids.join() === sortedBoards().map((b) => b.id).join()) return;
        reorderBoards(ids).catch((e) => { toastError(e); render(); });
      }, 0),
    });
  }
}
