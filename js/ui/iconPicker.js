// Seletor de ícones Lucide: popover com busca e grid. Lista curada para CRM.
// Todos os nomes abaixo existem na versão do Lucide fixada no index.html
// (validado por script na entrega; se trocar a versão, revalide).
import { icon, refreshIcons } from './icons.js';
import { esc } from '../utils.js';
import { openPopover, closePopover } from './dialog.js';

export const CRM_ICONS = [
  // pessoas / empresas
  'user', 'users', 'user-round', 'user-check', 'user-plus', 'contact', 'id-card', 'handshake',
  'building-2', 'building', 'store', 'factory', 'warehouse', 'landmark', 'briefcase',
  // contato
  'phone', 'phone-call', 'smartphone', 'mail', 'at-sign', 'send', 'message-circle', 'message-square', 'messages-square',
  // tempo
  'calendar', 'calendar-days', 'calendar-check', 'clock', 'timer', 'hourglass', 'history',
  // dinheiro
  'banknote', 'dollar-sign', 'coins', 'credit-card', 'wallet', 'receipt', 'piggy-bank', 'percent',
  // marcação
  'tag', 'tags', 'bookmark', 'star', 'heart', 'flag', 'target', 'crosshair', 'trophy', 'award',
  // links / lugares
  'link', 'external-link', 'globe', 'map-pin', 'map', 'navigation', 'home',
  // comércio / logística
  'shopping-cart', 'shopping-bag', 'package', 'box', 'truck', 'gift',
  // documentos
  'file-text', 'file', 'clipboard', 'clipboard-check', 'notebook-pen', 'pen-line', 'pencil', 'folder', 'archive', 'inbox', 'database',
  // estado
  'check', 'circle-check', 'check-square', 'x', 'circle-x', 'circle-alert', 'triangle-alert', 'info', 'circle-help', 'shield-check', 'lock', 'key', 'eye',
  // tipos / listas
  'type', 'align-left', 'hash', 'list', 'list-checks', 'layers', 'layout-grid', 'kanban', 'sliders-horizontal',
  // métricas
  'chart-bar', 'chart-line', 'chart-pie', 'trending-up', 'trending-down',
  // diversos
  'zap', 'sparkles', 'rocket', 'lightbulb', 'megaphone', 'bell', 'camera', 'image', 'video', 'mic', 'headphones',
  'wrench', 'settings', 'paintbrush', 'palette', 'music', 'graduation-cap', 'stethoscope', 'dumbbell', 'utensils',
  'car', 'bike', 'plane', 'scissors', 'monitor', 'laptop', 'printer', 'cloud', 'wifi',
];

// Sinônimos em português para a busca (o nome do ícone também funciona)
const KEYWORDS = {
  'building-2': 'prédio empresa', building: 'prédio empresa', store: 'loja', factory: 'fábrica', warehouse: 'galpão armazém', landmark: 'banco instituição',
  briefcase: 'pasta negócio', user: 'usuário pessoa', users: 'pessoas equipe', 'user-round': 'usuário pessoa', 'user-check': 'aprovado', 'user-plus': 'novo cliente',
  contact: 'contato', 'id-card': 'documento identidade', handshake: 'parceria acordo',
  phone: 'telefone', 'phone-call': 'ligação telefone', smartphone: 'celular whatsapp', mail: 'e-mail email', 'at-sign': 'arroba email', send: 'enviar',
  'message-circle': 'mensagem whatsapp chat', 'message-square': 'mensagem chat', 'messages-square': 'conversa chat',
  calendar: 'calendário data', 'calendar-days': 'calendário data', 'calendar-check': 'agendado', clock: 'relógio hora', timer: 'cronômetro', hourglass: 'ampulheta prazo', history: 'histórico',
  banknote: 'dinheiro valor', 'dollar-sign': 'dinheiro valor cifrão', coins: 'moedas', 'credit-card': 'cartão', wallet: 'carteira', receipt: 'recibo nota', 'piggy-bank': 'cofrinho poupança', percent: 'porcentagem desconto',
  tag: 'etiqueta', tags: 'etiquetas', bookmark: 'favorito', star: 'estrela', heart: 'coração', flag: 'bandeira', target: 'alvo meta', crosshair: 'alvo mira', trophy: 'troféu', award: 'prêmio',
  link: 'link site', 'external-link': 'link externo', globe: 'site mundo', 'map-pin': 'endereço local mapa', map: 'mapa', navigation: 'navegação rota', home: 'casa endereço',
  'shopping-cart': 'carrinho compra', 'shopping-bag': 'sacola compra', package: 'caixa pacote', box: 'caixa', truck: 'caminhão entrega', gift: 'presente',
  'file-text': 'documento arquivo', file: 'arquivo', clipboard: 'prancheta', 'clipboard-check': 'checklist', 'notebook-pen': 'anotação', 'pen-line': 'caneta assinatura', pencil: 'lápis editar',
  folder: 'pasta', archive: 'arquivo', inbox: 'caixa entrada', database: 'banco dados',
  check: 'certo ok', 'circle-check': 'check ok', 'check-square': 'check', x: 'fechar', 'circle-x': 'erro', 'circle-alert': 'alerta', 'triangle-alert': 'alerta atenção', info: 'informação', 'circle-help': 'ajuda dúvida',
  'shield-check': 'segurança', lock: 'cadeado senha', key: 'chave', eye: 'olho visualizar',
  type: 'texto', 'align-left': 'texto', hash: 'número', list: 'lista', 'list-checks': 'lista', layers: 'camadas', 'layout-grid': 'grade', kanban: 'quadro', 'sliders-horizontal': 'ajustes',
  'chart-bar': 'gráfico', 'chart-line': 'gráfico', 'chart-pie': 'gráfico pizza', 'trending-up': 'crescimento', 'trending-down': 'queda',
  zap: 'raio rápido', sparkles: 'brilho', rocket: 'foguete', lightbulb: 'ideia lâmpada', megaphone: 'megafone marketing', bell: 'sino notificação',
  camera: 'câmera foto', image: 'imagem foto', video: 'vídeo', mic: 'microfone', headphones: 'fone', wrench: 'ferramenta', settings: 'configuração', paintbrush: 'pincel', palette: 'paleta cor', music: 'música',
  'graduation-cap': 'formatura educação', stethoscope: 'saúde médico', dumbbell: 'academia', utensils: 'restaurante comida', car: 'carro', bike: 'bicicleta', plane: 'avião viagem', scissors: 'tesoura',
  monitor: 'computador', laptop: 'notebook', printer: 'impressora', cloud: 'nuvem', wifi: 'internet',
};

/**
 * openIconPicker(anchor, current, onPick, opts)
 *  - onPick(name | null) — null significa "padrão do tipo" (só quando allowDefault)
 *  - opts.nested: abrir por cima de outro popover sem fechá-lo
 */
export function openIconPicker(anchor, current, onPick, { nested = false, allowDefault = true, defaultLabel = 'Padrão do tipo' } = {}) {
  const pop = openPopover(anchor, `
    <input class="input input--sm popover__search" placeholder="Buscar ícone…" autocomplete="off" />
    ${allowDefault ? `
      <button type="button" class="menu__item ${!current ? 'is-selected' : ''}" data-default>
        ${icon('rotate-ccw')}<span class="grow">${esc(defaultLabel)}</span>${!current ? icon('check', 'check ico--sm') : ''}
      </button>` : ''}
    <div class="icon-picker__grid"></div>`, { cls: 'popover--icons', nested });
  const search = pop.querySelector('input');
  const grid = pop.querySelector('.icon-picker__grid');

  const paint = () => {
    const q = search.value.trim().toLowerCase();
    const list = CRM_ICONS.filter((n) => !q || n.includes(q) || (KEYWORDS[n] || '').includes(q));
    grid.innerHTML = list.map((n) => `
      <button type="button" class="${n === current ? 'is-selected' : ''}" data-icon="${n}" title="${n}">${icon(n)}</button>`).join('')
      || '<div class="popover__empty">Nenhum ícone encontrado.</div>';
    refreshIcons();
  };
  grid.addEventListener('click', (e) => {
    const b = e.target.closest('[data-icon]');
    if (!b) return;
    closePopover(pop);
    onPick(b.dataset.icon);
  });
  pop.querySelector('[data-default]')?.addEventListener('click', () => { closePopover(pop); onPick(null); });
  search.addEventListener('input', paint);
  search.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') { e.preventDefault(); grid.querySelector('[data-icon]')?.click(); }
  });
  paint();
  return pop;
}
