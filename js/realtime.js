// Realtime: mantém o estado sincronizado com o que a outra pessoa faz.
// Eventos gerados por este mesmo cliente chegam também, mas como o estado
// local já foi atualizado de forma otimista (com a linha devolvida pelo
// servidor, incluindo updated_at), o upsert não detecta mudança e nada é
// re-renderizado — sem piscar.
import { sb } from './supabase.js';
import {
  state, emit, upsertCard, removeCard, upsertColumn, removeColumn, upsertField, removeField,
  upsertTag, removeTag, upsertBoard, removeBoard, getCard,
} from './state.js';
import { normalizeCard } from './cards.js';

let boardChannel = null;
let globalChannel = null;

function handle(table, payload) {
  const { eventType, new: n, old: o } = payload;
  switch (table) {
    case 'cards': {
      if (eventType === 'DELETE') {
        if (removeCard(o.id)) emit('cards');
        return;
      }
      if (n.board_id !== state.boardId) return;
      if (upsertCard(normalizeCard(n))) emit('cards');
      return;
    }
    case 'card_tags': {
      // tabela sem board_id: só reage se o card estiver no board aberto
      const row = eventType === 'DELETE' ? o : n;
      const card = getCard(row.card_id);
      if (!card) return;
      const has = card.tag_ids.includes(row.tag_id);
      if (eventType === 'DELETE' && has) {
        card.tag_ids = card.tag_ids.filter((t) => t !== row.tag_id);
        emit('cards');
      } else if (eventType !== 'DELETE' && !has) {
        card.tag_ids = [...card.tag_ids, row.tag_id];
        emit('cards');
      }
      return;
    }
    case 'columns': {
      if (eventType === 'DELETE') { if (removeColumn(o.id)) emit('columns'); return; }
      if (n.board_id !== state.boardId) return;
      if (upsertColumn(n)) emit('columns');
      return;
    }
    case 'fields': {
      if (eventType === 'DELETE') { if (removeField(o.id)) emit('fields'); return; }
      if (n.board_id !== state.boardId) return;
      if (upsertField(n)) emit('fields');
      return;
    }
    case 'tags': {
      if (eventType === 'DELETE') {
        if (removeTag(o.id)) {
          state.cards.forEach((c) => { c.tag_ids = c.tag_ids.filter((t) => t !== o.id); });
          emit('tags'); emit('cards');
        }
        return;
      }
      if (n.board_id !== state.boardId) return;
      if (upsertTag(n)) emit('tags');
      return;
    }
    case 'boards': {
      if (eventType === 'DELETE') {
        if (removeBoard(o.id)) {
          emit('boards');
          if (state.boardId === o.id) emit('board-deleted-remotely', o.id);
        }
        return;
      }
      if (upsertBoard(n)) emit('boards');
      return;
    }
    case 'profiles': {
      if (eventType === 'DELETE') {
        delete state.profiles[o.id];
        if (state.profile?.id === o.id) state.profile = null;
      } else {
        state.profiles[n.id] = n;
        if (state.user?.id === n.id) state.profile = n;
      }
      emit('profiles');
      return;
    }
  }
}

export function subscribeBoard(boardId) {
  unsubscribeBoard();
  const filter = `board_id=eq.${boardId}`;
  boardChannel = sb.channel(`board-${boardId}`);
  for (const table of ['cards', 'columns', 'fields', 'tags']) {
    boardChannel.on('postgres_changes', { event: '*', schema: 'public', table, filter }, (p) => handle(table, p));
  }
  boardChannel.on('postgres_changes', { event: '*', schema: 'public', table: 'card_tags' }, (p) => handle('card_tags', p));
  boardChannel.subscribe((status) => {
    if (status === 'CHANNEL_ERROR') console.warn('realtime: erro no canal do board');
  });
}

export function unsubscribeBoard() {
  if (boardChannel) {
    sb.removeChannel(boardChannel);
    boardChannel = null;
  }
}

export function subscribeGlobal() {
  if (globalChannel) return;
  globalChannel = sb.channel('global')
    .on('postgres_changes', { event: '*', schema: 'public', table: 'boards' }, (p) => handle('boards', p))
    .on('postgres_changes', { event: '*', schema: 'public', table: 'profiles' }, (p) => handle('profiles', p))
    .subscribe();
}

export function unsubscribeAll() {
  unsubscribeBoard();
  if (globalChannel) { sb.removeChannel(globalChannel); globalChannel = null; }
}
