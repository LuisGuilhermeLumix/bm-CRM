-- ============================================================================
-- Lumix BM — 018: usuários, papéis e permissões
--  1) profiles.role ('admin' | 'member') + tabela crm_access (o que cada member vê)
--  2) helpers: crm_is_admin, crm_has_section, crm_can_board, crm_allowed_types,
--     crm_fin_visible_client
--  3) RLS do BM: member só nos boards liberados; boards só o admin cria/altera
--  4) RLS do Financeiro: member só lê, e só o que é dos tipos de operação liberados;
--     credenciais e anotações só admin
--  5) RPCs de finanças em security definer, com o filtro dentro delas
--  6) set_profile_allowed / crm_set_access / crm_profile_emails só para admin
--  7) crm_my_access(): o que o usuário logado pode ver (o app monta o menu com isso)
-- Esta migration SUBSTITUI as policies "*_all_allowed" das tabelas do BM e fin_*
-- (autorizado no PROMPT 09). profiles.allowed continua sendo a porta de entrada.
-- Idempotente: pode rodar de novo.
-- ============================================================================

-- ---------- 1) papel e permissões ---------------------------------------------
alter table public.profiles
  add column if not exists role text not null default 'member';

do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'profiles_role_check' and conrelid = 'public.profiles'::regclass) then
    alter table public.profiles add constraint profiles_role_check check (role in ('admin', 'member'));
  end if;
end $$;

-- allowed e role só mudam pelas funções de admin; o próprio usuário edita nome e foto.
-- Compara com funções security definer (e não com subselect em profiles) para a
-- policy não depender de si mesma.
create or replace function public.crm_my_role()
returns text
language sql stable security definer
set search_path = public
as $$
  select p.role from public.profiles p where p.id = auth.uid();
$$;
revoke all on function public.crm_my_role() from public, anon;
grant execute on function public.crm_my_role() to authenticated;

drop policy if exists "profiles_update_own" on public.profiles;
create policy "profiles_update_own" on public.profiles
  for update to authenticated
  using (id = (select auth.uid()))
  with check (
    id = (select auth.uid())
    and allowed = public.crm_allowed()
    and role = public.crm_my_role()
  );

update public.profiles p
   set role = 'admin'
  from auth.users u
 where u.id = p.id
   and u.email in ('luisguilherme.lumix@gmail.com', 'hercules.lumixcomercial@gmail.com')
   and p.role <> 'admin';

create table if not exists public.crm_access (
  profile_id uuid not null references public.profiles(id) on delete cascade,
  kind text not null check (kind in ('section', 'board', 'operation_type')),
  ref_key text,          -- section: boards|dashboard|clientes|financeiro|distribuicao|credenciais|anotacoes|relatorios|config
  ref_id uuid,           -- board: boards.id · operation_type: fin_operation_types.id
  created_at timestamptz not null default now()
);
create unique index if not exists crm_access_uidx on public.crm_access
  (profile_id, kind, coalesce(ref_key, ''), coalesce(ref_id, '00000000-0000-0000-0000-000000000000'));
create index if not exists crm_access_profile_idx on public.crm_access (profile_id);
comment on table public.crm_access is
  'Permissões de quem tem role = member: seções, boards e tipos de operação liberados. Admin não precisa de linhas aqui.';

-- ---------- 2) helpers -----------------------------------------------------------
create or replace function public.crm_is_admin()
returns boolean
language sql stable security definer
set search_path = public
as $$
  select coalesce((select p.allowed and p.role = 'admin' from public.profiles p where p.id = auth.uid()), false);
$$;

create or replace function public.crm_has_section(p_key text)
returns boolean
language sql stable security definer
set search_path = public
as $$
  select public.crm_is_admin()
      or (public.crm_allowed() and (
            exists (select 1 from public.crm_access a
                     where a.profile_id = auth.uid() and a.kind = 'section' and a.ref_key = p_key)
         or (p_key = 'boards' and exists (select 1 from public.crm_access a
                                           where a.profile_id = auth.uid() and a.kind = 'board'))
      ));
$$;

create or replace function public.crm_can_board(p_board_id uuid)
returns boolean
language sql stable security definer
set search_path = public
as $$
  select public.crm_is_admin()
      or (public.crm_allowed() and exists (
            select 1 from public.crm_access a
             where a.profile_id = auth.uid() and a.kind = 'board' and a.ref_id = p_board_id));
$$;

create or replace function public.crm_allowed_types()
returns uuid[]
language sql stable security definer
set search_path = public
as $$
  select case
    when public.crm_is_admin() then coalesce((select array_agg(t.id) from public.fin_operation_types t), '{}'::uuid[])
    when public.crm_allowed() then coalesce((select array_agg(a.ref_id) from public.crm_access a
                                              where a.profile_id = auth.uid() and a.kind = 'operation_type'), '{}'::uuid[])
    else '{}'::uuid[]
  end;
$$;

-- Lançamento/cliente visível: admin vê tudo; member só o que é de cliente/entidade
-- com tipo de operação liberado. Sem cliente (ou cliente sem tipo, como a Lumix) só admin.
create or replace function public.crm_fin_visible_client(p_client_id uuid)
returns boolean
language sql stable security definer
set search_path = public
as $$
  select public.crm_is_admin()
      or (p_client_id is not null and exists (
            select 1 from public.fin_clients c
             where c.id = p_client_id
               and c.operation_type_id is not null
               and c.operation_type_id = any(public.crm_allowed_types())));
$$;

do $$
declare f text;
begin
  foreach f in array array['crm_is_admin()', 'crm_has_section(text)', 'crm_can_board(uuid)',
                           'crm_allowed_types()', 'crm_fin_visible_client(uuid)'] loop
    execute format('revoke all on function public.%s from public, anon', f);
    execute format('grant execute on function public.%s to authenticated, service_role', f);
  end loop;
end $$;

-- crm_access: cada um lê as próprias linhas, o admin lê todas; só o admin grava
alter table public.crm_access enable row level security;
drop policy if exists crm_access_select on public.crm_access;
create policy crm_access_select on public.crm_access for select to authenticated
  using (public.crm_allowed() and (profile_id = (select auth.uid()) or public.crm_is_admin()));
drop policy if exists crm_access_write on public.crm_access;
create policy crm_access_write on public.crm_access for all to authenticated
  using (public.crm_is_admin()) with check (public.crm_is_admin());

-- ---------- 3) RLS do BM ------------------------------------------------------------
drop policy if exists boards_all_allowed on public.boards;
drop policy if exists boards_select on public.boards;
drop policy if exists boards_write on public.boards;
create policy boards_select on public.boards for select to authenticated
  using (public.crm_allowed() and (public.crm_is_admin() or public.crm_can_board(id)));
create policy boards_write on public.boards for all to authenticated
  using (public.crm_is_admin()) with check (public.crm_is_admin());

do $$
declare t text;
begin
  foreach t in array array['columns', 'fields', 'tags', 'cards'] loop
    execute format('drop policy if exists %I on public.%I', t || '_all_allowed', t);
    execute format('drop policy if exists %I on public.%I', t || '_select', t);
    execute format('drop policy if exists %I on public.%I', t || '_write', t);
    execute format('create policy %I on public.%I for select to authenticated using (public.crm_allowed() and (public.crm_is_admin() or public.crm_can_board(board_id)))', t || '_select', t);
    execute format('create policy %I on public.%I for all to authenticated using (public.crm_allowed() and (public.crm_is_admin() or public.crm_can_board(board_id))) with check (public.crm_allowed() and (public.crm_is_admin() or public.crm_can_board(board_id)))', t || '_write', t);
  end loop;
  foreach t in array array['card_tags', 'card_activity'] loop
    execute format('drop policy if exists %I on public.%I', t || '_all_allowed', t);
    execute format('drop policy if exists %I on public.%I', t || '_select', t);
    execute format('drop policy if exists %I on public.%I', t || '_write', t);
    execute format('create policy %I on public.%I for select to authenticated using (public.crm_allowed() and exists (select 1 from public.cards c where c.id = card_id and (public.crm_is_admin() or public.crm_can_board(c.board_id))))', t || '_select', t);
    execute format('create policy %I on public.%I for all to authenticated using (public.crm_allowed() and exists (select 1 from public.cards c where c.id = card_id and (public.crm_is_admin() or public.crm_can_board(c.board_id)))) with check (public.crm_allowed() and exists (select 1 from public.cards c where c.id = card_id and (public.crm_is_admin() or public.crm_can_board(c.board_id))))', t || '_write', t);
  end loop;
end $$;

-- ---------- 4) RLS do Financeiro ----------------------------------------------------
do $$
declare t text;
begin
  -- sai a policy antiga "faz tudo" de cada tabela fin_*
  foreach t in array array['fin_revenue_categories', 'fin_expense_categories', 'fin_cost_centers',
                           'fin_operation_types', 'fin_partners', 'fin_distribution_rules',
                           'fin_clients', 'fin_revenues', 'fin_expenses',
                           'fin_profit_distributions', 'fin_profit_distribution_partners',
                           'fin_credentials', 'fin_notes', 'fin_settings'] loop
    execute format('drop policy if exists %I on public.%I', t || '_all_allowed', t);
    execute format('drop policy if exists %I on public.%I', t || '_select', t);
    execute format('drop policy if exists %I on public.%I', t || '_write', t);
    execute format('create policy %I on public.%I for all to authenticated using (public.crm_is_admin()) with check (public.crm_is_admin())', t || '_write', t);
  end loop;

  -- cadastros de apoio: qualquer liberado lê
  foreach t in array array['fin_revenue_categories', 'fin_expense_categories', 'fin_cost_centers',
                           'fin_operation_types', 'fin_partners', 'fin_distribution_rules', 'fin_settings'] loop
    execute format('create policy %I on public.%I for select to authenticated using (public.crm_allowed())', t || '_select', t);
  end loop;
end $$;

create policy fin_clients_select on public.fin_clients for select to authenticated
  using (public.crm_allowed() and public.crm_fin_visible_client(id));
create policy fin_revenues_select on public.fin_revenues for select to authenticated
  using (public.crm_allowed() and public.crm_fin_visible_client(client_id));
create policy fin_expenses_select on public.fin_expenses for select to authenticated
  using (public.crm_allowed() and public.crm_fin_visible_client(client_id));
create policy fin_profit_distributions_select on public.fin_profit_distributions for select to authenticated
  using (public.crm_allowed() and (public.crm_is_admin() or operation_type_id = any(public.crm_allowed_types())));
create policy fin_profit_distribution_partners_select on public.fin_profit_distribution_partners for select to authenticated
  using (public.crm_allowed() and exists (
    select 1 from public.fin_profit_distributions d
     where d.id = distribution_id
       and (public.crm_is_admin() or d.operation_type_id = any(public.crm_allowed_types()))));
-- fin_credentials e fin_notes ficam só com a policy de admin (fin_*_write, que vale também para leitura)


-- ---------- RPCs do BM que criam board ou mudam card de board -----------------------
-- (corpo igual ao da 008; só ganharam a checagem de permissão no começo)
create or replace function public.duplicate_board(p_board_id uuid, p_with_cards boolean default true)
returns public.boards
language plpgsql
security invoker
as $$
declare
  v_src       public.boards;
  v_new       public.boards;
  v_field_map jsonb;
begin
  if not public.crm_is_admin() then
    raise exception 'Só administradores criam ou duplicam boards.' using errcode = '42501';
  end if;
  select * into v_src from public.boards where id = p_board_id;
  if not found then
    raise exception 'Board não encontrado';
  end if;

  -- abre espaço logo abaixo do original na sidebar
  update public.boards set position = position + 1 where position > v_src.position;

  insert into public.boards (name, color, icon, position, created_by)
  values (v_src.name || ' (cópia)', v_src.color, v_src.icon, v_src.position + 1, auth.uid())
  returning * into v_new;

  -- mapas old_id -> new_id
  drop table if exists pg_temp._dup_column_map;
  drop table if exists pg_temp._dup_field_map;
  drop table if exists pg_temp._dup_tag_map;
  drop table if exists pg_temp._dup_card_map;
  create temp table _dup_column_map (old_id uuid primary key, new_id uuid not null) on commit drop;
  create temp table _dup_field_map  (old_id uuid primary key, new_id uuid not null) on commit drop;
  create temp table _dup_tag_map    (old_id uuid primary key, new_id uuid not null) on commit drop;
  create temp table _dup_card_map   (old_id uuid primary key, new_id uuid not null) on commit drop;

  -- colunas
  insert into _dup_column_map (old_id, new_id)
  select id, gen_random_uuid() from public.columns where board_id = p_board_id;

  insert into public.columns (id, board_id, name, color, position, wip_limit)
  select m.new_id, v_new.id, c.name, c.color, c.position, c.wip_limit
    from public.columns c
    join _dup_column_map m on m.old_id = c.id;

  -- campos (definição inteira: opções, ícone, grupos de status, flags)
  insert into _dup_field_map (old_id, new_id)
  select id, gen_random_uuid() from public.fields where board_id = p_board_id;

  insert into public.fields (
    id, board_id, name, type, options, position, show_on_card, required,
    icon, status_enabled, status_label, status_options, statuses, default_on_new_cards, is_deadline
  )
  select m.new_id, v_new.id, f.name, f.type, f.options, f.position, f.show_on_card, f.required,
         f.icon, f.status_enabled, f.status_label, f.status_options, f.statuses, f.default_on_new_cards, f.is_deadline
    from public.fields f
    join _dup_field_map m on m.old_id = f.id;

  -- tags
  insert into _dup_tag_map (old_id, new_id)
  select id, gen_random_uuid() from public.tags where board_id = p_board_id;

  insert into public.tags (id, board_id, name, color)
  select m.new_id, v_new.id, t.name, t.color
    from public.tags t
    join _dup_tag_map m on m.old_id = t.id;

  if p_with_cards then
    select coalesce(jsonb_object_agg(old_id::text, new_id::text), '{}'::jsonb)
      into v_field_map
      from _dup_field_map;

    insert into _dup_card_map (old_id, new_id)
    select id, gen_random_uuid() from public.cards where board_id = p_board_id;

    insert into public.cards (
      id, board_id, column_id, title, description, position, values, field_ids, created_by, archived
    )
    select cm.new_id, v_new.id, colm.new_id, c.title, c.description, c.position,
           public.remap_card_values(c.values, v_field_map),
           public.remap_uuid_array(c.field_ids, v_field_map),
           auth.uid(), c.archived
      from public.cards c
      join _dup_card_map   cm   on cm.old_id   = c.id
      join _dup_column_map colm on colm.old_id = c.column_id;

    insert into public.card_tags (card_id, tag_id)
    select cm.new_id, tm.new_id
      from public.card_tags ct
      join _dup_card_map cm on cm.old_id = ct.card_id
      join _dup_tag_map  tm on tm.old_id = ct.tag_id
    on conflict do nothing;

    insert into public.card_activity (card_id, user_id, type, payload)
    select cm.new_id, auth.uid(), 'created', jsonb_build_object('duplicated_from_board', p_board_id)
      from _dup_card_map cm;
  end if;

  return v_new;
end;
$$;

create or replace function public.move_card_to_board(p_card_id uuid, p_board_id uuid, p_column_id uuid)
returns public.cards
language plpgsql
security invoker
as $$
declare
  v_card     public.cards;
  v_from     public.boards;
  v_to       public.boards;
  v_map      jsonb := '{}'::jsonb;
  v_pos      int;
  v_dest_id  uuid;
  v_dest     public.fields;
  v_used     jsonb;
  v_opts     jsonb;
  v_groups   jsonb;
  v_dgroup   jsonb;
  v_tag      uuid;
  v_old_col  uuid;
  v_old_pos  int;
  r          record;
  g          jsonb;
  o          jsonb;
begin
  if not public.crm_can_board(p_board_id) then
    raise exception 'Sem acesso ao board de destino.' using errcode = '42501';
  end if;
  if not public.crm_can_board((select c.board_id from public.cards c where c.id = p_card_id)) then
    raise exception 'Sem acesso a este card.' using errcode = '42501';
  end if;
  select * into v_card from public.cards where id = p_card_id for update;
  if not found then
    raise exception 'Card não encontrado';
  end if;
  if v_card.board_id = p_board_id then
    raise exception 'O card já está nesse board';
  end if;

  select * into v_to from public.boards where id = p_board_id;
  if not found then
    raise exception 'Board de destino não encontrado';
  end if;
  if not exists (select 1 from public.columns where id = p_column_id and board_id = p_board_id) then
    raise exception 'Coluna de destino inválida';
  end if;
  select * into v_from from public.boards where id = v_card.board_id;
  v_old_col := v_card.column_id;
  v_old_pos := v_card.position;

  -- ---- campos ---------------------------------------------------------------
  for r in
    select f.*
      from unnest(coalesce(v_card.field_ids, '{}'::uuid[])) with ordinality as u(fid, ord)
      join public.fields f on f.id = u.fid
     order by u.ord
  loop
    select d.id into v_dest_id
      from public.fields d
     where d.board_id = p_board_id
       and lower(trim(d.name)) = lower(trim(r.name))
       and d.type = r.type
     order by d.position, d.created_at
     limit 1;

    if v_dest_id is null then
      insert into public.fields (
        board_id, name, type, options, position, show_on_card, required,
        icon, status_enabled, status_label, status_options, statuses, default_on_new_cards, is_deadline
      )
      values (
        p_board_id, r.name, r.type, r.options,
        (select coalesce(max(position), -1) + 1 from public.fields where board_id = p_board_id),
        r.show_on_card, r.required,
        r.icon, r.status_enabled, r.status_label, r.status_options, r.statuses, false, r.is_deadline
      )
      returning id into v_dest_id;
    else
      select * into v_dest from public.fields where id = v_dest_id for update;
      v_opts   := coalesce(v_dest.options, '[]'::jsonb);
      v_groups := coalesce(v_dest.statuses, '[]'::jsonb);

      -- select/multiselect: acrescenta opções usadas pelo card que faltam no destino
      if r.type in ('select', 'multiselect') and v_card.values ? r.id::text then
        v_used := v_card.values -> r.id::text;
        if jsonb_typeof(v_used) <> 'array' then v_used := jsonb_build_array(v_used); end if;
        for o in select x from jsonb_array_elements(coalesce(r.options, '[]'::jsonb)) x loop
          if v_used @> jsonb_build_array(o ->> 'id')
             and not exists (select 1 from jsonb_array_elements(v_opts) y where y ->> 'id' = o ->> 'id') then
            v_opts := v_opts || jsonb_build_array(o);
          end if;
        end loop;
      end if;

      -- grupos de status usados pelo card: grupo ausente entra inteiro; grupo
      -- presente (mesmo id) recebe as opções usadas que faltam
      for g in select x from jsonb_array_elements(coalesce(r.statuses, '[]'::jsonb)) x loop
        continue when not (v_card.values ? (r.id::text || ':status:' || (g ->> 'id')));
        v_used := v_card.values -> (r.id::text || ':status:' || (g ->> 'id'));
        if jsonb_typeof(v_used) <> 'array' then v_used := jsonb_build_array(v_used); end if;

        select x into v_dgroup from jsonb_array_elements(v_groups) x where x ->> 'id' = g ->> 'id' limit 1;
        if v_dgroup is null then
          v_groups := v_groups || jsonb_build_array(g);
        else
          for o in select x from jsonb_array_elements(coalesce(g -> 'options', '[]'::jsonb)) x loop
            if v_used @> jsonb_build_array(o ->> 'id')
               and not exists (select 1 from jsonb_array_elements(coalesce(v_dgroup -> 'options', '[]'::jsonb)) y where y ->> 'id' = o ->> 'id') then
              v_dgroup := jsonb_set(v_dgroup, '{options}', coalesce(v_dgroup -> 'options', '[]'::jsonb) || jsonb_build_array(o));
            end if;
          end loop;
          select coalesce(jsonb_agg(case when x ->> 'id' = g ->> 'id' then v_dgroup else x end), '[]'::jsonb)
            into v_groups
            from jsonb_array_elements(v_groups) x;
        end if;
      end loop;

      if v_opts is distinct from coalesce(v_dest.options, '[]'::jsonb)
         or v_groups is distinct from coalesce(v_dest.statuses, '[]'::jsonb) then
        update public.fields set options = v_opts, statuses = v_groups where id = v_dest_id;
      end if;
    end if;

    v_map := v_map || jsonb_build_object(r.id::text, v_dest_id::text);
  end loop;

  -- ---- tags -----------------------------------------------------------------
  for r in
    select t.* from public.card_tags ct join public.tags t on t.id = ct.tag_id where ct.card_id = p_card_id
  loop
    select d.id into v_tag
      from public.tags d
     where d.board_id = p_board_id and lower(trim(d.name)) = lower(trim(r.name))
     order by d.created_at
     limit 1;
    if v_tag is null then
      insert into public.tags (board_id, name, color) values (p_board_id, r.name, r.color) returning id into v_tag;
    end if;
    delete from public.card_tags where card_id = p_card_id and tag_id = r.id;
    insert into public.card_tags (card_id, tag_id) values (p_card_id, v_tag) on conflict do nothing;
  end loop;

  -- ---- o card ---------------------------------------------------------------
  perform 1 from public.cards where column_id = p_column_id and archived = false for update;
  select coalesce(max(position), -1) + 1 into v_pos
    from public.cards
   where column_id = p_column_id and archived = false;

  update public.cards
     set board_id  = p_board_id,
         column_id = p_column_id,
         position  = v_pos,
         field_ids = public.remap_uuid_array(field_ids, v_map),
         values    = public.remap_card_values(values, v_map)
   where id = p_card_id
   returning * into v_card;

  -- origem: fecha a lacuna deixada pelo card
  with others as (
    select id, (row_number() over (order by position, created_at) - 1)::int as rn
      from public.cards
     where column_id = v_old_col and archived = false
  )
  update public.cards c
     set position = o2.rn
    from others o2
   where c.id = o2.id and c.position <> o2.rn;

  insert into public.card_activity (card_id, user_id, type, payload)
  values (
    p_card_id, auth.uid(), 'moved',
    jsonb_build_object(
      'from_board', v_from.id, 'to_board', v_to.id,
      'from_board_name', v_from.name, 'to_board_name', v_to.name
    )
  );

  return v_card;
end;
$$;

-- ---------- cálculo completo do lucro por tipo (interno) -----------------------------
-- Mesmo corpo da 015, em security definer: enxerga todos os lançamentos, inclusive
-- o custo geral da Lumix, que a RLS esconderia de um member.
create or replace function public.fin_profit_by_operation_all(p_month date)
returns table (
  operation_type_id uuid,
  name text,
  slug text,
  color text,
  active boolean,
  revenue_paid numeric,
  expense_direct numeric,
  expense_shared numeric,
  profit numeric
)
language sql
stable
security definer
set search_path = public
as $$
  with b as (
    select date_trunc('month', p_month::timestamp)::date as d0,
           (date_trunc('month', p_month::timestamp) + interval '1 month')::date as d1
  ),
  rev as (
    select c.operation_type_id as type_id, sum(r.value) as amount
      from public.fin_revenues r
      left join public.fin_clients c on c.id = r.client_id
      cross join b
     where r.status = 'Pago' and r.due_date >= b.d0 and r.due_date < b.d1
     group by c.operation_type_id
  ),
  ex as (
    select c.operation_type_id as type_id,
           (coalesce(c.is_internal, false) and c.operation_type_id is null) as is_pool,
           sum(e.value) as amount
      from public.fin_expenses e
      left join public.fin_clients c on c.id = e.client_id
      cross join b
     where e.status = 'Pago' and e.due_date >= b.d0 and e.due_date < b.d1
     group by 1, 2
  ),
  pool as (
    select coalesce(sum(ex.amount), 0) as amount from ex where ex.is_pool
  ),
  typed as (
    select t.id as type_id, t.position as pos,
           coalesce((select rev.amount from rev where rev.type_id = t.id), 0) as revenue,
           coalesce((select ex.amount from ex where ex.type_id = t.id), 0) as direct
      from public.fin_operation_types t
     where t.active
        or exists (select 1 from rev where rev.type_id = t.id)
        or exists (select 1 from ex where ex.type_id = t.id)
  ),
  tot as (
    select coalesce(sum(typed.revenue), 0) as revenue from typed
  ),
  share as (
    select typed.type_id, typed.pos, typed.revenue, typed.direct,
           case when tot.revenue > 0 then round(pool.amount * typed.revenue / tot.revenue, 2) else 0 end as shared,
           row_number() over (order by typed.revenue desc, typed.pos, typed.type_id) as rn
      from typed cross join tot cross join pool
  ),
  fixed as (
    select share.type_id, share.pos, share.revenue, share.direct,
           share.shared + case when share.rn = 1 and tot.revenue > 0
                               then pool.amount - (select sum(s2.shared) from share s2)
                               else 0 end as shared
      from share cross join tot cross join pool
  ),
  untyped as (
    select coalesce((select rev.amount from rev where rev.type_id is null), 0) as revenue,
           coalesce((select ex.amount from ex where ex.type_id is null and not ex.is_pool), 0) as direct,
           case when tot.revenue > 0 then 0 else pool.amount end as shared
      from tot cross join pool
  )
  select o.type_id, o.type_name, o.type_slug, o.type_color, o.type_active,
         o.revenue, o.direct, o.shared, o.revenue - o.direct - o.shared
    from (
      select f.type_id, t.name as type_name, t.slug as type_slug, t.color as type_color, t.active as type_active,
             f.revenue, f.direct, f.shared, f.pos as sort_pos, 0 as sort_group
        from fixed f
        join public.fin_operation_types t on t.id = f.type_id
      union all
      select null::uuid, 'Sem tipo', null, null, true,
             u.revenue, u.direct, u.shared, 0, 1
        from untyped u
       where u.revenue <> 0 or u.direct <> 0 or u.shared <> 0
    ) o
   order by o.sort_group, o.sort_pos, o.type_name;
$$;

-- ---------- 5) RPCs de finanças: security definer + filtro por visibilidade ---------
-- Rodam como dono (ignoram a RLS) para o custo geral entrar no rateio; o que
-- cada pessoa pode ver é filtrado aqui dentro por crm_fin_visible_client.

create or replace function public.fin_totals(
  p_from date default null,
  p_to date default null,
  p_tags text[] default null
)
returns table (
  revenue_paid numeric, revenue_pending numeric, revenue_count bigint,
  expense_paid numeric, expense_pending numeric, expense_count bigint
)
language plpgsql stable security definer
set search_path = public
as $$
#variable_conflict use_column
begin
  if not public.crm_allowed() then
    raise exception 'Sem permissão.' using errcode = '42501';
  end if;
  return query
  select r.paid, r.pending, r.n, e.paid, e.pending, e.n
    from (
      select coalesce(sum(x.value) filter (where x.status = 'Pago'), 0) as paid,
             coalesce(sum(x.value) filter (where x.status in ('Pendente', 'Atrasado')), 0) as pending,
             count(*) as n
        from public.fin_revenues x
       where (p_from is null or x.due_date >= p_from)
         and (p_to is null or x.due_date <= p_to)
         and (coalesce(cardinality(p_tags), 0) = 0 or x.tags && p_tags)
         and public.crm_fin_visible_client(x.client_id)
    ) r
    cross join (
      select coalesce(sum(x.value) filter (where x.status = 'Pago'), 0) as paid,
             coalesce(sum(x.value) filter (where x.status in ('Pendente', 'Atrasado')), 0) as pending,
             count(*) as n
        from public.fin_expenses x
       where (p_from is null or x.due_date >= p_from)
         and (p_to is null or x.due_date <= p_to)
         and (coalesce(cardinality(p_tags), 0) = 0 or x.tags && p_tags)
         and public.crm_fin_visible_client(x.client_id)
    ) e;
end $$;

create or replace function public.fin_filter_options()
returns json
language plpgsql stable security definer
set search_path = public
as $$
begin
  if not public.crm_allowed() then
    raise exception 'Sem permissão.' using errcode = '42501';
  end if;
  return (
    with rv as (select * from public.fin_revenues r where public.crm_fin_visible_client(r.client_id)),
         ex as (select * from public.fin_expenses e where public.crm_fin_visible_client(e.client_id))
    select json_build_object(
      'tags', coalesce((
        select json_agg(t.tag order by t.tag)
          from (select unnest(rv.tags) as tag from rv union select unnest(ex.tags) from ex) t
         where nullif(trim(t.tag), '') is not null), '[]'::json),
      'suppliers', coalesce((
        select json_agg(s.supplier order by s.supplier)
          from (select distinct ex.supplier from ex where nullif(trim(ex.supplier), '') is not null) s), '[]'::json),
      'revenue_descriptions', coalesce((
        select json_agg(json_build_object('text', d.descr, 'n', d.n) order by d.n desc, d.descr)
          from (select upper(btrim(regexp_replace(rv.description, '\s+', ' ', 'g'))) as descr, count(*) as n
                  from rv where btrim(rv.description) <> '' group by 1 order by 2 desc, 1 limit 300) d), '[]'::json),
      'expense_descriptions', coalesce((
        select json_agg(json_build_object('text', d.descr, 'n', d.n) order by d.n desc, d.descr)
          from (select upper(btrim(regexp_replace(ex.description, '\s+', ' ', 'g'))) as descr, count(*) as n
                  from ex where btrim(ex.description) <> '' group by 1 order by 2 desc, 1 limit 300) d), '[]'::json)
    )
  );
end $$;

create or replace function public.fin_monthly_series(
  p_end_month date default null,
  p_months int default 6
)
returns table (month_start date, revenue_paid numeric, expense_paid numeric, profit numeric)
language plpgsql stable security definer
set search_path = public
as $$
#variable_conflict use_column
begin
  if not public.crm_allowed() then
    raise exception 'Sem permissão.' using errcode = '42501';
  end if;
  return query
  with m as (
    select (date_trunc('month', coalesce(p_end_month, (now() at time zone 'America/Sao_Paulo')::date)::timestamp)
            - make_interval(months => g.n))::date as d0
      from generate_series(0, least(greatest(coalesce(p_months, 6), 1), 36) - 1) as g(n)
  )
  select m.d0, r.amount, e.amount, r.amount - e.amount
    from m
    cross join lateral (
      select coalesce(sum(x.value), 0) as amount from public.fin_revenues x
       where x.status = 'Pago' and x.due_date >= m.d0 and x.due_date < (m.d0 + interval '1 month')::date
         and public.crm_fin_visible_client(x.client_id)
    ) r
    cross join lateral (
      select coalesce(sum(x.value), 0) as amount from public.fin_expenses x
       where x.status = 'Pago' and x.due_date >= m.d0 and x.due_date < (m.d0 + interval '1 month')::date
         and public.crm_fin_visible_client(x.client_id)
    ) e
   order by m.d0;
end $$;

create or replace function public.fin_by_category(
  p_from date default null,
  p_to date default null
)
returns table (kind text, category_id int, category_name text, total numeric, entries bigint)
language plpgsql stable security definer
set search_path = public
as $$
#variable_conflict use_column
begin
  if not public.crm_allowed() then
    raise exception 'Sem permissão.' using errcode = '42501';
  end if;
  return query
  select 'revenue'::text, x.category_id, coalesce(c.name, 'Sem categoria'), sum(x.value), count(*)
    from public.fin_revenues x
    left join public.fin_revenue_categories c on c.id = x.category_id
   where x.status = 'Pago'
     and (p_from is null or x.due_date >= p_from) and (p_to is null or x.due_date <= p_to)
     and public.crm_fin_visible_client(x.client_id)
   group by x.category_id, c.name
  union all
  select 'expense'::text, x.category_id, coalesce(c.name, 'Sem categoria'), sum(x.value), count(*)
    from public.fin_expenses x
    left join public.fin_expense_categories c on c.id = x.category_id
   where x.status = 'Pago'
     and (p_from is null or x.due_date >= p_from) and (p_to is null or x.due_date <= p_to)
     and public.crm_fin_visible_client(x.client_id)
   group by x.category_id, c.name
   order by 1 desc, 4 desc, 3;
end $$;

-- Lucro por tipo: a conta é sempre sobre TODOS os lançamentos (o custo geral da
-- Lumix entra no rateio mesmo para quem não o enxerga); no fim, cada pessoa
-- recebe só as linhas dos tipos liberados ("Sem tipo" só o admin).
create or replace function public.fin_profit_by_operation(p_month date)
returns table (
  operation_type_id uuid, name text, slug text, color text, active boolean,
  revenue_paid numeric, expense_direct numeric, expense_shared numeric, profit numeric
)
language plpgsql stable security definer
set search_path = public
as $$
#variable_conflict use_column
begin
  if not public.crm_allowed() then
    raise exception 'Sem permissão.' using errcode = '42501';
  end if;
  return query
  select a.*
    from public.fin_profit_by_operation_all(p_month) a
   where (a.operation_type_id is null and public.crm_is_admin())
      or a.operation_type_id = any(public.crm_allowed_types());
end $$;

do $$
declare f text;
begin
  foreach f in array array['fin_totals(date, date, text[])', 'fin_filter_options()', 'fin_monthly_series(date, int)',
                           'fin_by_category(date, date)', 'fin_profit_by_operation(date)'] loop
    execute format('revoke all on function public.%s from public, anon', f);
    execute format('grant execute on function public.%s to authenticated', f);
  end loop;
end $$;
-- o cálculo completo não é chamável de fora
revoke all on function public.fin_profit_by_operation_all(date) from public, anon, authenticated;

-- ---------- credenciais: só admin -------------------------------------------------
create or replace function public.fin_credential_set_secret(p_credential_id uuid, p_secret text)
returns void
language plpgsql security definer
set search_path = public, vault
as $$
declare
  v_secret_id uuid;
  v_name text := 'fin_credential:' || p_credential_id;
begin
  if not public.crm_is_admin() then
    raise exception 'Sem permissão para alterar credenciais.' using errcode = '42501';
  end if;
  select c.vault_secret_id into v_secret_id from public.fin_credentials c where c.id = p_credential_id for update;
  if not found then
    raise exception 'Credencial não encontrada.';
  end if;
  if p_secret is null or p_secret = '' then
    update public.fin_credentials set vault_secret_id = null where id = p_credential_id and vault_secret_id is not null;
    delete from vault.secrets s where s.id = v_secret_id or s.name = v_name;
    return;
  end if;
  if v_secret_id is not null and exists (select 1 from vault.secrets s where s.id = v_secret_id) then
    perform vault.update_secret(v_secret_id, p_secret);
  else
    delete from vault.secrets s where s.name = v_name;
    v_secret_id := vault.create_secret(p_secret, v_name, 'Segredo de uma credencial do Lumix (fin_credentials)');
  end if;
  update public.fin_credentials
     set vault_secret_id = v_secret_id, secret_encrypted = null, secret_iv = null
   where id = p_credential_id;
end $$;

create or replace function public.fin_credential_get_secret(p_credential_id uuid)
returns text
language plpgsql security definer
set search_path = public, vault
as $$
declare v_secret text;
begin
  if not public.crm_is_admin() then
    raise exception 'Sem permissão para ver credenciais.' using errcode = '42501';
  end if;
  select d.decrypted_secret into v_secret
    from public.fin_credentials c join vault.decrypted_secrets d on d.id = c.vault_secret_id
   where c.id = p_credential_id;
  return v_secret;
end $$;

revoke all on function public.fin_credential_set_secret(uuid, text) from public, anon;
grant execute on function public.fin_credential_set_secret(uuid, text) to authenticated;
revoke all on function public.fin_credential_get_secret(uuid) from public, anon;
grant execute on function public.fin_credential_get_secret(uuid) to authenticated;

-- ---------- 6) gestão de usuários: só admin ----------------------------------------
-- O service_role (Edge Function admin-create-user) também pode chamar.
create or replace function public.crm_caller_is_admin()
returns boolean
language sql stable security definer
set search_path = public
as $$
  select public.crm_is_admin() or coalesce(auth.jwt() ->> 'role', '') = 'service_role';
$$;
revoke all on function public.crm_caller_is_admin() from public, anon;
grant execute on function public.crm_caller_is_admin() to authenticated, service_role;

create or replace function public.set_profile_allowed(p_id uuid, p_allowed boolean)
returns public.profiles
language plpgsql security definer
set search_path = public
as $$
declare v_row public.profiles;
begin
  if not public.crm_caller_is_admin() then
    raise exception 'Só administradores alteram acessos.' using errcode = '42501';
  end if;
  if p_id = auth.uid() and not coalesce(p_allowed, false) then
    raise exception 'Você não pode bloquear o seu próprio acesso.';
  end if;
  update public.profiles set allowed = coalesce(p_allowed, false) where id = p_id returning * into v_row;
  if not found then
    raise exception 'Usuário não encontrado.';
  end if;
  return v_row;
end $$;
revoke all on function public.set_profile_allowed(uuid, boolean) from public, anon;
grant execute on function public.set_profile_allowed(uuid, boolean) to authenticated, service_role;

-- Troca o papel e TODAS as permissões do perfil.
-- p_access = { "sections": [...], "boards": [uuid...], "operation_types": [uuid...] }
create or replace function public.crm_set_access(p_profile_id uuid, p_role text, p_access jsonb)
returns void
language plpgsql security definer
set search_path = public
as $$
declare
  v_sections text[] := array['boards','dashboard','clientes','financeiro','distribuicao','credenciais','anotacoes','relatorios','config'];
  v_key text;
begin
  if not public.crm_caller_is_admin() then
    raise exception 'Só administradores alteram permissões.' using errcode = '42501';
  end if;
  if p_role not in ('admin', 'member') then
    raise exception 'Papel inválido: %', p_role;
  end if;
  if p_profile_id = auth.uid() and p_role <> 'admin' then
    raise exception 'Você não pode tirar o seu próprio papel de administrador.';
  end if;
  if not exists (select 1 from public.profiles where id = p_profile_id) then
    raise exception 'Usuário não encontrado.';
  end if;

  for v_key in select jsonb_array_elements_text(coalesce(p_access -> 'sections', '[]'::jsonb)) loop
    if not v_key = any(v_sections) then
      raise exception 'Seção inválida: %', v_key;
    end if;
  end loop;

  update public.profiles set role = p_role where id = p_profile_id and role is distinct from p_role;
  delete from public.crm_access where profile_id = p_profile_id;

  insert into public.crm_access (profile_id, kind, ref_key)
  select distinct p_profile_id, 'section', s
    from jsonb_array_elements_text(coalesce(p_access -> 'sections', '[]'::jsonb)) s;

  insert into public.crm_access (profile_id, kind, ref_id)
  select distinct p_profile_id, 'board', b::uuid
    from jsonb_array_elements_text(coalesce(p_access -> 'boards', '[]'::jsonb)) b
   where exists (select 1 from public.boards x where x.id = b::uuid);

  insert into public.crm_access (profile_id, kind, ref_id)
  select distinct p_profile_id, 'operation_type', t::uuid
    from jsonb_array_elements_text(coalesce(p_access -> 'operation_types', '[]'::jsonb)) t
   where exists (select 1 from public.fin_operation_types x where x.id = t::uuid);
end $$;
revoke all on function public.crm_set_access(uuid, text, jsonb) from public, anon;
grant execute on function public.crm_set_access(uuid, text, jsonb) to authenticated, service_role;

create or replace function public.crm_profile_emails()
returns table (id uuid, email text)
language plpgsql stable security definer
set search_path = public
as $$
#variable_conflict use_column
begin
  if not public.crm_is_admin() then
    raise exception 'Sem permissão para ver os e-mails.' using errcode = '42501';
  end if;
  return query select u.id, u.email::text from auth.users u join public.profiles p on p.id = u.id;
end $$;
revoke all on function public.crm_profile_emails() from public, anon;
grant execute on function public.crm_profile_emails() to authenticated;

-- ---------- 7) o que o usuário logado pode ver ----------------------------------------
-- { role, allowed, sections: [...], boards: [uuid...], operation_types: [uuid...] }
-- Para o admin: todas as seções, e boards/operation_types vazios (ele vê tudo).
create or replace function public.crm_my_access()
returns jsonb
language sql stable security definer
set search_path = public
as $$
  select jsonb_build_object(
    'role', coalesce(p.role, 'member'),
    'allowed', coalesce(p.allowed, false),
    'sections', case when p.allowed and p.role = 'admin'
      then '["boards","dashboard","clientes","financeiro","distribuicao","credenciais","anotacoes","relatorios","config"]'::jsonb
      else coalesce((select jsonb_agg(distinct a.ref_key) from public.crm_access a
                      where a.profile_id = p.id and a.kind = 'section'), '[]'::jsonb) end,
    'boards', coalesce((select jsonb_agg(a.ref_id) from public.crm_access a where a.profile_id = p.id and a.kind = 'board'), '[]'::jsonb),
    'operation_types', coalesce((select jsonb_agg(a.ref_id) from public.crm_access a where a.profile_id = p.id and a.kind = 'operation_type'), '[]'::jsonb)
  )
  from public.profiles p
  where p.id = auth.uid();
$$;
revoke all on function public.crm_my_access() from public, anon;
grant execute on function public.crm_my_access() to authenticated;
