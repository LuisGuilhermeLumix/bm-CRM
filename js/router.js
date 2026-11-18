// Roteamento por hash: #/boards/<id>, #/dashboard, #/clientes, #/financeiro…
// A URL é a fonte da verdade da seção aberta. Links da sidebar são <a href>
// comuns (o navegador dispara `hashchange`); o board aberto é sincronizado na
// URL por syncBoardRoute(), chamado de openBoard/closeBoard.
import { state } from './state.js';
import { storage } from './utils.js';

export const LAST_ROUTE_KEY = 'lumix.lastRoute';

/** Seções do app, na ordem da sidebar. `id` é também o segmento da rota. */
export const SECTIONS = [
  { id: 'boards',       label: 'Boards',                icon: 'kanban' },
  { id: 'dashboard',    label: 'Dashboard',             icon: 'layout-dashboard' },
  { id: 'clientes',     label: 'Clientes',              icon: 'users' },
  { id: 'financeiro',   label: 'Financeiro',            icon: 'wallet' },
  { id: 'distribuicao', label: 'Distribuição de Lucro', icon: 'chart-pie' },
  { id: 'credenciais',  label: 'Credenciais',           icon: 'key-round' },
  { id: 'anotacoes',    label: 'Anotações',             icon: 'notebook-pen' },
  { id: 'relatorios',   label: 'Relatórios',            icon: 'chart-column' },
  { id: 'config',       label: 'Configurações',         icon: 'settings' },
];

export const getSection = (id) => SECTIONS.find((s) => s.id === id) || null;

/** "#/boards/<id>" → { section, boardId }. Devolve null se não for uma rota válida. */
export function parseHash(hash = location.hash) {
  const m = /^#\/([a-z]+)(?:\/([^/?#]+))?\/?$/.exec(hash || '');
  if (!m || !getSection(m[1])) return null;
  if (m[1] === 'boards') return { section: 'boards', boardId: m[2] ? decodeURIComponent(m[2]) : null };
  if (m[2]) return null;
  return { section: m[1], boardId: null };
}

export function routeHash(route) {
  if (route.section === 'boards') return route.boardId ? `#/boards/${encodeURIComponent(route.boardId)}` : '#/boards';
  return `#/${route.section}`;
}

/** Troca o hash sem disparar `hashchange` (pushState/replaceState não disparam). */
function writeHash(hash, replace) {
  if (location.hash === hash) return;
  const url = location.pathname + location.search + hash;
  if (replace) history.replaceState(null, '', url);
  else history.pushState(null, '', url);
}

let handler = null;
let listening = false;

/**
 * Liga o roteador e aplica a rota atual.
 * onRoute(route, fromBrowser): fromBrowser = true quando veio de voltar/avançar,
 * de um link ou de edição manual da URL (e não da carga inicial).
 */
export function startRouter(onRoute) {
  handler = onRoute;
  if (!listening) {
    listening = true;
    window.addEventListener('hashchange', () => resolve(true));
  }
  resolve(false);
}

/** false antes de startRouter() e depois de stopRouter() (logout). */
export const isRouterActive = () => !!handler;

export function stopRouter() {
  handler = null;
  state.route = { section: 'boards', boardId: null };
}

function resolve(fromBrowser) {
  if (!handler) return;
  let route = parseHash();
  if (!route) {
    // Rota escrita errado ("#/xyz") cai em Boards. Sem rota nenhuma (URL limpa,
    // ou sobra do link de autenticação) volta para a última rota usada.
    const typedRoute = location.hash.startsWith('#/');
    route = (!typedRoute && parseHash(storage.get(LAST_ROUTE_KEY) || '')) || { section: 'boards', boardId: null };
    writeHash(routeHash(route), true);
  }
  state.route = route;
  storage.set(LAST_ROUTE_KEY, routeHash(route));
  handler(route, fromBrowser);
}

/**
 * Mantém URL e state.route em dia com o board aberto (ou com nenhum, se
 * boardId = null). Só entra no histórico a troca de um board existente para
 * outro; rota sem id, com id inválido ou de board excluído é substituída, para
 * o "voltar" do navegador não cair de novo num endereço que redireciona.
 */
export function syncBoardRoute(boardId) {
  if (state.route.section !== 'boards') return;
  const cur = parseHash();
  const fromBoard = cur?.section === 'boards' && cur.boardId && cur.boardId !== boardId
    && state.boards.some((b) => b.id === cur.boardId);
  const route = { section: 'boards', boardId: boardId || null };
  writeHash(routeHash(route), !(boardId && fromBoard));
  state.route = route;
  storage.set(LAST_ROUTE_KEY, routeHash(route));
}
