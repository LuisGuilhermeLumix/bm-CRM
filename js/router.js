// Roteamento por hash: #/boards/<id>, #/dashboard, #/clientes, #/config/<aba>…
// A URL é a fonte da verdade da seção aberta. Links da sidebar são <a href>
// comuns (o navegador dispara `hashchange`); o board aberto é sincronizado na
// URL por syncBoardRoute(), chamado de openBoard/closeBoard.
import { state } from './state.js';
import { storage } from './utils.js';

export const LAST_ROUTE_KEY = 'lumix.lastRoute';

/** Seções do app. `id` é também o segmento da rota. A ordem do menu está em NAV. */
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

/** Menu lateral: seções avulsas e grupos expansíveis. As rotas não dependem desta ordem. */
export const NAV = [
  { section: 'dashboard' },
  { section: 'clientes' },
  { group: 'organizacao', label: 'Organização', icon: 'folder-kanban', items: ['boards', 'credenciais', 'anotacoes'] },
  { group: 'financas', label: 'Finanças', icon: 'landmark', items: ['financeiro', 'distribuicao', 'relatorios'] },
  { section: 'config' },
];
/** Grupo do menu que contém a seção (ou null, se ela é avulsa). */
export const navGroupOf = (sectionId) => NAV.find((n) => n.group && n.items.includes(sectionId)) || null;

/**
 * "#/boards/<id>" → { section, boardId, sub }. Nas outras seções o segundo
 * segmento é uma sub-rota opcional (ex.: a aba em "#/config/categorias").
 * Devolve null se não for uma rota válida.
 */
export function parseHash(hash = location.hash) {
  const m = /^#\/([a-z]+)(?:\/([^/?#]+))?\/?$/.exec(hash || '');
  if (!m || !getSection(m[1])) return null;
  const second = m[2] ? decodeURIComponent(m[2]) : null;
  if (m[1] === 'boards') return { section: 'boards', boardId: second, sub: null };
  return { section: m[1], boardId: null, sub: second };
}

export function routeHash(route) {
  if (route.section === 'boards') return route.boardId ? `#/boards/${encodeURIComponent(route.boardId)}` : '#/boards';
  return route.sub ? `#/${route.section}/${encodeURIComponent(route.sub)}` : `#/${route.section}`;
}

/** Troca a rota atual por outra (sem entrar no histórico) e aplica. Usado quando a seção não é permitida. */
export function replaceRoute(hash) {
  writeHash(hash, true);
  resolve(false);
}

/** Vai para outra rota (entra no histórico e passa pelo fluxo normal de troca de seção). */
export function navigate(hash) {
  if (location.hash !== hash) location.hash = hash;
}

/**
 * Troca só a sub-rota da seção atual (ex.: a aba aberta), sem remontar a
 * página e sem empilhar histórico.
 */
export function setSubRoute(sub) {
  if (state.route.section === 'boards') return;
  const route = { ...state.route, sub: sub || null };
  writeHash(routeHash(route), true);
  state.route = route;
  storage.set(LAST_ROUTE_KEY, routeHash(route));
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
  state.route = { section: 'boards', boardId: null, sub: null };
}

function resolve(fromBrowser) {
  if (!handler) return;
  let route = parseHash();
  if (!route) {
    // Rota vazia (URL limpa, ou sobra do link de autenticação) ou escrita errado
    // ("#/xyz") abre o Dashboard, a tela inicial do sistema.
    route = { section: 'dashboard', boardId: null, sub: null };
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
  const route = { section: 'boards', boardId: boardId || null, sub: null };
  writeHash(routeHash(route), !(boardId && fromBoard));
  state.route = route;
  storage.set(LAST_ROUTE_KEY, routeHash(route));
}
