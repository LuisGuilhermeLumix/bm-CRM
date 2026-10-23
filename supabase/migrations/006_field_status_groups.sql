-- ============================================================================
-- Lumix BM — 006: grupos de status por campo
-- Um campo pode ter vários grupos de status (ex.: Empresa → Situação,
-- Prioridade, Pendências), cada um com rótulo, opções coloridas e modo
-- único/múltiplo. As colunas antigas status_enabled/status_label/
-- status_options ficam por enquanto (não são dropadas), mas o app passa a
-- usar só `statuses`.
-- Idempotente: pode rodar de novo.
-- ============================================================================

alter table public.fields
  add column if not exists statuses jsonb not null default '[]'::jsonb;

comment on column public.fields.statuses is
  'Grupos de status do campo: [{ "id": "uuid", "label": "Situação", "multiple": false, '
  '"options": [{ "id": "uuid", "label": "Ativa", "color": "#22c55e" }] }]. '
  'Substitui status_enabled/status_label/status_options (mantidas só por compatibilidade).';

comment on column public.cards.values is
  '{ "<field_id>": valor, "<field_id>:status:<group_id>": status }. '
  'select guarda o id da opção; multiselect array de ids; date "YYYY-MM-DD"; checkbox true; '
  'number/currency number; demais string. '
  'Status: id da opção (string) quando o grupo é único, ou array de ids quando multiple = true. '
  'A chave antiga "<field_id>:status" foi migrada na 006.';

-- ----------------------------------------------------------------------------
-- Backfill: status antigo (status_enabled) vira um grupo único, e a chave
-- "<field_id>:status" dos cards vira "<field_id>:status:<group_id>".
-- Só mexe em campos com statuses = '[]' (idempotente).
-- ----------------------------------------------------------------------------
do $$
declare
  r        record;
  v_gid    uuid;
  v_old    text;
  v_new    text;
begin
  for r in
    select id, board_id, status_label, status_options
      from public.fields
     where status_enabled = true
       and statuses = '[]'::jsonb
  loop
    v_gid := gen_random_uuid();
    v_old := r.id::text || ':status';
    v_new := r.id::text || ':status:' || v_gid::text;

    update public.fields
       set statuses = jsonb_build_array(jsonb_build_object(
             'id',       v_gid,
             'label',    coalesce(nullif(r.status_label, ''), 'Status'),
             'multiple', false,
             'options',  coalesce(r.status_options, '[]'::jsonb)
           ))
     where id = r.id;

    update public.cards
       set values = (values - v_old) || jsonb_build_object(v_new, values -> v_old)
     where board_id = r.board_id
       and values ? v_old;
  end loop;
end $$;

-- ----------------------------------------------------------------------------
-- Helper: remove de `values` a chave do campo e TODAS as chaves de status dele
-- ("<field_id>:status%").
-- ----------------------------------------------------------------------------
create or replace function public.values_without_field(p_values jsonb, p_field_id uuid)
returns jsonb
language sql
immutable
as $$
  select coalesce(
    (select jsonb_object_agg(k, v)
       from jsonb_each(coalesce(p_values, '{}'::jsonb)) as e(k, v)
      where k <> p_field_id::text
        and k not like p_field_id::text || ':status%'),
    '{}'::jsonb
  );
$$;

-- ----------------------------------------------------------------------------
-- strip_field_values: ao excluir um campo do board, limpa valor + todos os
-- status em todos os cards e tira o id de cards.field_ids.
-- ----------------------------------------------------------------------------
create or replace function public.strip_field_values(p_field_id uuid)
returns int
language plpgsql
security invoker
as $$
declare
  v_board uuid;
  v_n     int;
begin
  select board_id into v_board from public.fields where id = p_field_id;
  if v_board is null then return 0; end if;
  update public.cards
     set values    = public.values_without_field(values, p_field_id),
         field_ids = array_remove(field_ids, p_field_id)
   where board_id = v_board
     and (
       values ? p_field_id::text
       or exists (select 1 from jsonb_object_keys(values) k where k like p_field_id::text || ':status%')
       or p_field_id = any(field_ids)
     );
  get diagnostics v_n = row_count;
  return v_n;
end;
$$;

-- ----------------------------------------------------------------------------
-- remove_field_from_card: tira o campo SÓ deste card (array + valor + status).
-- ----------------------------------------------------------------------------
create or replace function public.remove_field_from_card(p_card_id uuid, p_field_id uuid)
returns public.cards
language plpgsql
security invoker
as $$
declare v_card public.cards;
begin
  update public.cards
     set field_ids = array_remove(field_ids, p_field_id),
         values    = public.values_without_field(values, p_field_id)
   where id = p_card_id
   returning * into v_card;
  if not found then
    raise exception 'Card não encontrado';
  end if;
  return v_card;
end;
$$;

-- ----------------------------------------------------------------------------
-- remove_field_status_option(p_field_id, p_group_id, p_option_id): NOVA
-- assinatura. Limpa a opção da chave do grupo nos cards que a usam:
-- valor único → remove a chave; array (múltiplo) → tira o item.
-- Retorna quantos cards foram alterados.
-- ----------------------------------------------------------------------------
drop function if exists public.remove_field_status_option(uuid, text);

create or replace function public.remove_field_status_option(p_field_id uuid, p_group_id text, p_option_id text)
returns int
language plpgsql
security invoker
as $$
declare
  v_board uuid;
  v_key   text := p_field_id::text || ':status:' || p_group_id;
  v_n     int  := 0;
  r       record;
begin
  select board_id into v_board from public.fields where id = p_field_id;
  if v_board is null then return 0; end if;

  for r in
    select id, values -> v_key as v
      from public.cards
     where board_id = v_board and values ? v_key
  loop
    if jsonb_typeof(r.v) = 'array' then
      if r.v @> to_jsonb(array[p_option_id]) then
        update public.cards
           set values = values || jsonb_build_object(
             v_key,
             coalesce((select jsonb_agg(e) from jsonb_array_elements(r.v) e where e <> to_jsonb(p_option_id)), '[]'::jsonb)
           )
         where id = r.id;
        v_n := v_n + 1;
      end if;
    elsif r.v = to_jsonb(p_option_id) then
      update public.cards set values = values - v_key where id = r.id;
      v_n := v_n + 1;
    end if;
  end loop;
  return v_n;
end;
$$;
