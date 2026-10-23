-- ============================================================================
-- Lumix CRM — 003: ícone por campo e status vinculado ao campo
-- Idempotente: pode rodar de novo. Não mexe em políticas de RLS.
-- ============================================================================

-- ----------------------------------------------------------------------------
-- fields: ícone Lucide próprio e status opcional com opções coloridas
-- ----------------------------------------------------------------------------
alter table public.fields
  add column if not exists icon text null;                                    -- nome Lucide; null = ícone padrão do tipo
alter table public.fields
  add column if not exists status_enabled boolean not null default false;     -- campo tem status próprio?
alter table public.fields
  add column if not exists status_label text not null default 'Status';       -- rótulo do chip/seletor
alter table public.fields
  add column if not exists status_options jsonb not null default '[]'::jsonb; -- [{ "id", "label", "color" }]

comment on column public.fields.icon is
  'Nome de ícone Lucide (ex: building-2, phone). Null = usa o ícone padrão do tipo.';
comment on column public.fields.status_enabled is
  'Quando true, cada card pode ter um status para este campo (ver convenção em cards.values).';
comment on column public.fields.status_options is
  'Opções do status, mesmo formato das opções de select: [{ "id": "uuid", "label": "Ativa", "color": "#22c55e" }].';

-- ----------------------------------------------------------------------------
-- Convenção do status em cards.values
-- ----------------------------------------------------------------------------
comment on table public.cards is
  'Cards do kanban. Os valores dos campos personalizados ficam em `values` (jsonb) '
  'com a chave = id do campo. O STATUS vinculado a um campo fica numa chave '
  'separada, "<field_id>:status", cujo valor é o id da opção em fields.status_options. '
  'Ex.: { "a1b2-...": "Oblivium", "a1b2-...:status": "op-7f3e" }. '
  'Chave separada (e não um objeto) para não quebrar os valores já existentes.';

comment on column public.cards.values is
  '{ "<field_id>": valor, "<field_id>:status": "<status_option_id>" }. '
  'select guarda o id da opção; multiselect array de ids; date "YYYY-MM-DD"; checkbox true; '
  'number/currency number; demais string.';

-- ----------------------------------------------------------------------------
-- strip_field_values: ao excluir um campo, remove também a chave do status
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
     set values = (values - v_key) - v_skey
   where board_id = v_board
     and (values ? v_key or values ? v_skey);
  get diagnostics v_n = row_count;
  return v_n;
end;
$$;

-- ----------------------------------------------------------------------------
-- remove_field_status_option: limpa "<field_id>:status" dos cards que usam a
-- opção removida. Retorna quantos cards foram alterados.
-- ----------------------------------------------------------------------------
create or replace function public.remove_field_status_option(p_field_id uuid, p_option_id text)
returns int
language plpgsql
security invoker
as $$
declare
  v_board uuid;
  v_skey  text := p_field_id::text || ':status';
  v_n     int;
begin
  select board_id into v_board from public.fields where id = p_field_id;
  if v_board is null then return 0; end if;
  update public.cards
     set values = values - v_skey
   where board_id = v_board
     and values ->> v_skey = p_option_id;
  get diagnostics v_n = row_count;
  return v_n;
end;
$$;

-- patch_card_values já é um merge de jsonb (|| + jsonb_strip_nulls), então
-- gravar { "<field_id>:status": "<id>" } ou null para limpar funciona sem mudança.
