-- ============================================================================
-- Lumix BM — 005: campos por card
-- Cada card passa a ter seu próprio conjunto (e ordem) de campos em
-- cards.field_ids. O board continua dono do catálogo de definições (fields).
-- Idempotente: pode rodar de novo.
-- ============================================================================

alter table public.cards
  add column if not exists field_ids uuid[] not null default '{}';

alter table public.fields
  add column if not exists default_on_new_cards boolean not null default true;

comment on column public.cards.field_ids is
  'Ids de fields que este card exibe, na ordem do modal. Um campo do board só aparece no card se estiver aqui.';
comment on column public.fields.default_on_new_cards is
  'Quando true, o campo entra automaticamente em field_ids de cards novos.';

-- Índice GIN: "quais cards usam o campo X" (contagens de uso e remoção em massa)
create index if not exists cards_field_ids_gin on public.cards using gin (field_ids);

-- ----------------------------------------------------------------------------
-- Backfill: cards existentes recebem todos os campos do board, na ordem de
-- fields.position. Só mexe em quem ainda está vazio.
-- ----------------------------------------------------------------------------
update public.cards c
   set field_ids = coalesce(
     (select array_agg(f.id order by f.position, f.created_at)
        from public.fields f
       where f.board_id = c.board_id),
     '{}'::uuid[]
   )
 where c.field_ids = '{}'::uuid[];

-- ----------------------------------------------------------------------------
-- remove_field_from_card: tira o campo SÓ deste card (array + valores).
-- Não apaga a definição do campo no board.
-- ----------------------------------------------------------------------------
create or replace function public.remove_field_from_card(p_card_id uuid, p_field_id uuid)
returns public.cards
language plpgsql
security invoker
as $$
declare
  v_card public.cards;
  v_key  text := p_field_id::text;
  v_skey text := p_field_id::text || ':status';
begin
  update public.cards
     set field_ids = array_remove(field_ids, p_field_id),
         values    = (coalesce(values, '{}'::jsonb) - v_key) - v_skey
   where id = p_card_id
   returning * into v_card;
  if not found then
    raise exception 'Card não encontrado';
  end if;
  return v_card;
end;
$$;

-- ----------------------------------------------------------------------------
-- strip_field_values: ao excluir um campo do board, além de limpar os valores
-- (e o status) em todos os cards, tira o id de cards.field_ids.
-- ----------------------------------------------------------------------------
create or replace function public.strip_field_values(p_field_id uuid)
returns int
language plpgsql
security invoker
as $$
declare
  v_board uuid;
  v_key   text := p_field_id::text;
  v_skey  text := p_field_id::text || ':status';
  v_n     int;
begin
  select board_id into v_board from public.fields where id = p_field_id;
  if v_board is null then return 0; end if;
  update public.cards
     set values    = (values - v_key) - v_skey,
         field_ids = array_remove(field_ids, p_field_id)
   where board_id = v_board
     and (values ? v_key or values ? v_skey or p_field_id = any(field_ids));
  get diagnostics v_n = row_count;
  return v_n;
end;
$$;
