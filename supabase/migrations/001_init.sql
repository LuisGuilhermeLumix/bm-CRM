-- ============================================================================
-- Lumix CRM — migration inicial
-- Rode este arquivo inteiro no SQL Editor do Supabase. É idempotente: pode
-- rodar de novo sem quebrar (usa IF NOT EXISTS / OR REPLACE / DROP IF EXISTS).
-- ============================================================================

create extension if not exists "pgcrypto";

-- ----------------------------------------------------------------------------
-- Função genérica para manter updated_at
-- ----------------------------------------------------------------------------
create or replace function public.set_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

-- ============================================================================
-- TABELAS
-- ============================================================================

-- profiles: 1 linha por usuário do auth.users (nome + cor do avatar)
create table if not exists public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  name text not null,
  avatar_color text not null default '#6366f1',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- boards: cada board é um "CRM" independente (Clientes, Leads do nicho X...)
create table if not exists public.boards (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  color text not null default '#6366f1',
  icon text,
  position int not null default 0,
  created_by uuid references public.profiles(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- columns: os status do kanban
create table if not exists public.columns (
  id uuid primary key default gen_random_uuid(),
  board_id uuid not null references public.boards(id) on delete cascade,
  name text not null,
  color text not null,
  position int not null default 0,
  wip_limit int null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- fields: campos personalizados do card, definidos por board
create table if not exists public.fields (
  id uuid primary key default gen_random_uuid(),
  board_id uuid not null references public.boards(id) on delete cascade,
  name text not null,
  type text not null check (type in (
    'text','textarea','number','currency','date','select','multiselect','checkbox','url','email','phone'
  )),
  -- para select/multiselect: [{ "id": "uuid", "label": "Ativo", "color": "#22c55e" }]
  options jsonb not null default '[]'::jsonb,
  position int not null default 0,
  show_on_card boolean not null default false,
  required boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- tags: etiquetas coloridas por board
create table if not exists public.tags (
  id uuid primary key default gen_random_uuid(),
  board_id uuid not null references public.boards(id) on delete cascade,
  name text not null,
  color text not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- cards: os registros (clientes/leads). Os valores dos campos personalizados
-- ficam em `values` como { "<field_id>": <valor> }:
--   select      -> id da opção (string)
--   multiselect -> array de ids de opção
--   date        -> 'YYYY-MM-DD'
--   checkbox    -> boolean
--   number/currency -> number
--   demais      -> string
create table if not exists public.cards (
  id uuid primary key default gen_random_uuid(),
  board_id uuid not null references public.boards(id) on delete cascade,
  column_id uuid not null references public.columns(id) on delete restrict,
  title text not null,
  description text,
  position int not null default 0,
  values jsonb not null default '{}'::jsonb,
  created_by uuid references public.profiles(id) on delete set null,
  archived boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.card_tags (
  card_id uuid not null references public.cards(id) on delete cascade,
  tag_id uuid not null references public.tags(id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (card_id, tag_id)
);

-- card_activity: histórico simples (created, moved, updated, comment)
create table if not exists public.card_activity (
  id uuid primary key default gen_random_uuid(),
  card_id uuid not null references public.cards(id) on delete cascade,
  user_id uuid references public.profiles(id) on delete set null,
  type text not null check (type in ('created','moved','updated','comment','archived','restored')),
  payload jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

-- ----------------------------------------------------------------------------
-- Índices
-- ----------------------------------------------------------------------------
create index if not exists cards_board_column_position_idx on public.cards (board_id, column_id, position);
create index if not exists cards_board_archived_idx on public.cards (board_id, archived);
create index if not exists columns_board_position_idx on public.columns (board_id, position);
create index if not exists fields_board_position_idx on public.fields (board_id, position);
create index if not exists tags_board_idx on public.tags (board_id);
create index if not exists card_tags_tag_idx on public.card_tags (tag_id);
create index if not exists card_activity_card_created_idx on public.card_activity (card_id, created_at desc);

-- ----------------------------------------------------------------------------
-- Triggers de updated_at
-- ----------------------------------------------------------------------------
drop trigger if exists profiles_set_updated_at on public.profiles;
create trigger profiles_set_updated_at before update on public.profiles
  for each row execute function public.set_updated_at();

drop trigger if exists boards_set_updated_at on public.boards;
create trigger boards_set_updated_at before update on public.boards
  for each row execute function public.set_updated_at();

drop trigger if exists columns_set_updated_at on public.columns;
create trigger columns_set_updated_at before update on public.columns
  for each row execute function public.set_updated_at();

drop trigger if exists fields_set_updated_at on public.fields;
create trigger fields_set_updated_at before update on public.fields
  for each row execute function public.set_updated_at();

drop trigger if exists tags_set_updated_at on public.tags;
create trigger tags_set_updated_at before update on public.tags
  for each row execute function public.set_updated_at();

-- Em cards, só atualiza updated_at quando muda conteúdo. Reindexar `position`
-- (que acontece em todo drag-and-drop) não conta como "atualização" do card,
-- senão o "há 3 dias" do rodapé mudaria toda vez que um vizinho fosse movido.
drop trigger if exists cards_set_updated_at on public.cards;
create trigger cards_set_updated_at
  before update of title, description, values, column_id, archived on public.cards
  for each row execute function public.set_updated_at();

-- ----------------------------------------------------------------------------
-- Novo usuário em auth.users -> cria profile
-- Nome vem de raw_user_meta_data->>'name'; fallback é a parte do e-mail antes do @.
-- ----------------------------------------------------------------------------
create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_name text;
  v_colors text[] := array['#ef4444','#f97316','#f59e0b','#22c55e','#10b981','#06b6d4','#3b82f6','#6366f1','#8b5cf6','#ec4899'];
begin
  v_name := coalesce(nullif(trim(new.raw_user_meta_data->>'name'), ''), split_part(new.email, '@', 1));
  insert into public.profiles (id, name, avatar_color)
  values (new.id, v_name, v_colors[1 + floor(random() * array_length(v_colors, 1))::int])
  on conflict (id) do nothing;
  return new;
end;
$$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();

-- Backfill: usuários criados antes desta migration também ganham profile
insert into public.profiles (id, name, avatar_color)
select
  u.id,
  coalesce(nullif(trim(u.raw_user_meta_data->>'name'), ''), split_part(u.email, '@', 1)),
  (array['#ef4444','#f97316','#f59e0b','#22c55e','#10b981','#06b6d4','#3b82f6','#6366f1','#8b5cf6','#ec4899'])[1 + floor(random() * 10)::int]
from auth.users u
where not exists (select 1 from public.profiles p where p.id = u.id);

-- ============================================================================
-- RLS — workspace compartilhado: qualquer usuário autenticado pode tudo.
-- Exceção: profiles só é editado pelo próprio dono.
-- ============================================================================
alter table public.profiles      enable row level security;
alter table public.boards        enable row level security;
alter table public.columns       enable row level security;
alter table public.fields        enable row level security;
alter table public.tags          enable row level security;
alter table public.cards         enable row level security;
alter table public.card_tags     enable row level security;
alter table public.card_activity enable row level security;

-- profiles
drop policy if exists "profiles_select_authenticated" on public.profiles;
create policy "profiles_select_authenticated" on public.profiles
  for select to authenticated using (true);

drop policy if exists "profiles_update_own" on public.profiles;
create policy "profiles_update_own" on public.profiles
  for update to authenticated using (id = (select auth.uid())) with check (id = (select auth.uid()));

-- demais tabelas: política única "authenticated faz tudo"
do $$
declare t text;
begin
  foreach t in array array['boards','columns','fields','tags','cards','card_tags','card_activity'] loop
    execute format('drop policy if exists %I on public.%I', t || '_all_authenticated', t);
    execute format(
      'create policy %I on public.%I for all to authenticated using (true) with check (true)',
      t || '_all_authenticated', t
    );
  end loop;
end $$;

-- ============================================================================
-- Realtime: publica as tabelas do board. REPLICA IDENTITY FULL é necessário
-- para que eventos de DELETE carreguem o board_id (usado no filtro do canal).
-- ============================================================================
alter table public.cards   replica identity full;
alter table public.columns replica identity full;
alter table public.fields  replica identity full;
alter table public.tags    replica identity full;
alter table public.boards  replica identity full;

do $$
declare t text;
begin
  if exists (select 1 from pg_publication where pubname = 'supabase_realtime') then
    foreach t in array array['boards','columns','fields','tags','cards','card_tags'] loop
      if not exists (
        select 1 from pg_publication_tables
        where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = t
      ) then
        execute format('alter publication supabase_realtime add table public.%I', t);
      end if;
    end loop;
  end if;
end $$;

-- ============================================================================
-- FUNÇÕES RPC
-- ============================================================================

-- move_card: move um card para (coluna, posição) e reindexa as posições das
-- colunas de origem e destino numa única transação. Também registra a
-- atividade "moved" quando a coluna muda. Retorna o card atualizado.
--
-- Estratégia:
--   1. trava os cards das duas colunas (for update) para evitar corrida entre
--      os dois usuários arrastando ao mesmo tempo;
--   2. no destino, numera os OUTROS cards de 0..n-1 e abre um "buraco" na
--      posição desejada (quem está em >= pos ganha +1);
--   3. coloca o card no buraco;
--   4. na origem (se for outra coluna), renumera 0..n-1 para não deixar lacunas.
create or replace function public.move_card(p_card_id uuid, p_new_column_id uuid, p_new_position int)
returns public.cards
language plpgsql
security invoker
as $$
declare
  v_card        public.cards;
  v_old_column  uuid;
  v_count       int;
  v_pos         int;
  v_from_name   text;
  v_to_name     text;
begin
  select * into v_card from public.cards where id = p_card_id for update;
  if not found then
    raise exception 'Card não encontrado';
  end if;
  v_old_column := v_card.column_id;

  if not exists (select 1 from public.columns where id = p_new_column_id and board_id = v_card.board_id) then
    raise exception 'Coluna de destino inválida';
  end if;

  -- trava as linhas das duas colunas
  perform 1 from public.cards
   where column_id in (v_old_column, p_new_column_id) and archived = false
   for update;

  select count(*) into v_count
    from public.cards
   where column_id = p_new_column_id and archived = false and id <> p_card_id;
  v_pos := greatest(0, least(coalesce(p_new_position, v_count), v_count));

  -- destino: renumera os outros cards abrindo espaço em v_pos
  with others as (
    select id, (row_number() over (order by position, created_at) - 1)::int as rn
      from public.cards
     where column_id = p_new_column_id and archived = false and id <> p_card_id
  )
  update public.cards c
     set position = case when o.rn >= v_pos then o.rn + 1 else o.rn end
    from others o
   where c.id = o.id
     and c.position is distinct from (case when o.rn >= v_pos then o.rn + 1 else o.rn end);

  update public.cards
     set column_id = p_new_column_id, position = v_pos
   where id = p_card_id
   returning * into v_card;

  if v_old_column <> p_new_column_id then
    -- origem: fecha a lacuna deixada pelo card
    with others as (
      select id, (row_number() over (order by position, created_at) - 1)::int as rn
        from public.cards
       where column_id = v_old_column and archived = false
    )
    update public.cards c
       set position = o.rn
      from others o
     where c.id = o.id and c.position <> o.rn;

    select name into v_from_name from public.columns where id = v_old_column;
    select name into v_to_name   from public.columns where id = p_new_column_id;

    insert into public.card_activity (card_id, user_id, type, payload)
    values (
      p_card_id, auth.uid(), 'moved',
      jsonb_build_object('from', v_old_column, 'to', p_new_column_id, 'from_name', v_from_name, 'to_name', v_to_name)
    );
  end if;

  return v_card;
end;
$$;

-- reorder_positions: recebe a lista ordenada de ids e grava position = índice.
-- Usada para colunas, campos e boards. Tabela restrita a uma whitelist.
create or replace function public.reorder_positions(p_table text, p_ids uuid[])
returns void
language plpgsql
security invoker
as $$
begin
  if p_table not in ('boards', 'columns', 'fields') then
    raise exception 'Tabela não permitida: %', p_table;
  end if;
  execute format(
    'update public.%I t set position = (x.ord - 1)::int
       from unnest($1) with ordinality as x(id, ord)
      where t.id = x.id and t.position is distinct from (x.ord - 1)::int',
    p_table
  ) using p_ids;
end;
$$;

-- patch_card_values: mescla um patch no jsonb `values` no servidor, para que
-- dois usuários editando campos diferentes do mesmo card não sobrescrevam um
-- ao outro. Chaves com null são removidas (= "limpar campo").
create or replace function public.patch_card_values(p_card_id uuid, p_patch jsonb)
returns public.cards
language plpgsql
security invoker
as $$
declare v_card public.cards;
begin
  update public.cards
     set values = jsonb_strip_nulls(coalesce(values, '{}'::jsonb) || coalesce(p_patch, '{}'::jsonb))
   where id = p_card_id
   returning * into v_card;
  if not found then
    raise exception 'Card não encontrado';
  end if;
  return v_card;
end;
$$;

-- strip_field_values: remove a chave de um campo de todos os cards do board
-- (chamada antes de excluir o campo, para não deixar lixo no jsonb).
create or replace function public.strip_field_values(p_field_id uuid)
returns int
language plpgsql
security invoker
as $$
declare v_board uuid; v_n int;
begin
  select board_id into v_board from public.fields where id = p_field_id;
  if v_board is null then return 0; end if;
  update public.cards
     set values = values - p_field_id::text
   where board_id = v_board and values ? p_field_id::text;
  get diagnostics v_n = row_count;
  return v_n;
end;
$$;

-- remove_field_option: tira uma opção (de select/multiselect) dos valores de
-- todos os cards que a usam. Retorna quantos cards foram alterados.
create or replace function public.remove_field_option(p_field_id uuid, p_option_id text)
returns int
language plpgsql
security invoker
as $$
declare
  v_board uuid;
  v_key   text := p_field_id::text;
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

-- Sem seed: o app cria o primeiro board ("Clientes") no primeiro acesso.
