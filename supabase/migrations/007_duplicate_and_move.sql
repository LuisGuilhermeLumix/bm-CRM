-- ============================================================================
-- Lumix BM — 007: duplicar card, duplicar board, mover card entre boards
-- Idempotente: pode rodar de novo (create or replace).
-- Todas as funções são security invoker: as políticas de RLS (crm_allowed)
-- continuam valendo para quem chama.
-- ============================================================================

-- ----------------------------------------------------------------------------
-- Helpers de remapeamento de ids de campo.
-- p_map é um jsonb { "<old_field_id>": "<new_field_id>" }.
-- ----------------------------------------------------------------------------

-- Troca o field_id no começo de cada chave de `values`:
--   "<field_id>"                    -> "<novo_id>"
--   "<field_id>:status:<group_id>"  -> "<novo_id>:status:<group_id>"
-- Chaves de campos que não estão no mapa são descartadas (seriam órfãs).
create or replace function public.remap_card_values(p_values jsonb, p_map jsonb)
returns jsonb
language sql
immutable
as $$
  select coalesce(
    jsonb_object_agg((p_map ->> left(e.k, 36)) || substr(e.k, 37), e.v),
    '{}'::jsonb
  )
  from jsonb_each(coalesce(p_values, '{}'::jsonb)) as e(k, v)
  where p_map ? left(e.k, 36);
$$;

-- Remapeia um array de ids preservando a ordem; ids fora do mapa saem.
-- Se dois ids antigos apontarem para o mesmo novo (ex.: dois campos homônimos
-- caindo no mesmo campo do destino), o novo aparece uma vez só.
create or replace function public.remap_uuid_array(p_ids uuid[], p_map jsonb)
returns uuid[]
language sql
immutable
as $$
  select coalesce(array_agg(s.new_id order by s.first_ord), '{}'::uuid[])
  from (
    select (p_map ->> u.id::text)::uuid as new_id, min(u.ord) as first_ord
      from unnest(coalesce(p_ids, '{}'::uuid[])) with ordinality as u(id, ord)
     where p_map ? u.id::text
     group by 1
  ) s;
$$;

-- ----------------------------------------------------------------------------
-- duplicate_card: cópia logo abaixo do original, na mesma coluna.
--   p_with_values = true  -> copia descrição e values (inclusive status)
--   p_with_values = false -> só a estrutura: field_ids e tags
-- Sempre copia título (+ " (cópia)"), field_ids e tags.
-- ----------------------------------------------------------------------------
create or replace function public.duplicate_card(p_card_id uuid, p_with_values boolean default true)
returns public.cards
language plpgsql
security invoker
as $$
declare
  v_src public.cards;
  v_new public.cards;
  v_pos int;
begin
  select * into v_src from public.cards where id = p_card_id;
  if not found then
    raise exception 'Card não encontrado';
  end if;

  -- trava a coluna e abre espaço logo abaixo do original
  perform 1 from public.cards where column_id = v_src.column_id and archived = false for update;
  v_pos := v_src.position + 1;
  update public.cards
     set position = position + 1
   where column_id = v_src.column_id
     and archived = false
     and position >= v_pos;

  insert into public.cards (board_id, column_id, title, description, position, values, field_ids, created_by, archived)
  values (
    v_src.board_id,
    v_src.column_id,
    v_src.title || ' (cópia)',
    case when p_with_values then v_src.description else null end,
    v_pos,
    case when p_with_values then coalesce(v_src.values, '{}'::jsonb) else '{}'::jsonb end,
    coalesce(v_src.field_ids, '{}'::uuid[]),
    auth.uid(),
    false
  )
  returning * into v_new;

  insert into public.card_tags (card_id, tag_id)
  select v_new.id, ct.tag_id from public.card_tags ct where ct.card_id = p_card_id
  on conflict do nothing;

  insert into public.card_activity (card_id, user_id, type, payload)
  values (v_new.id, auth.uid(), 'created', jsonb_build_object('duplicated_from', p_card_id));

  return v_new;
end;
$$;

-- ----------------------------------------------------------------------------
-- duplicate_board: novo board "<nome> (cópia)" logo abaixo do original.
--   p_with_cards = true  -> colunas, campos, tags, cards (values, status, tags, field_ids)
--   p_with_cards = false -> só colunas, campos e tags
-- Colunas, campos, tags e cards ganham ids novos; os mapas old -> new ficam em
-- tabelas temporárias (descartadas no fim da transação). Os ids das opções e
-- dos grupos de status ficam iguais: são escopados pelo campo.
-- ----------------------------------------------------------------------------
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
    icon, status_enabled, status_label, status_options, statuses, default_on_new_cards
  )
  select m.new_id, v_new.id, f.name, f.type, f.options, f.position, f.show_on_card, f.required,
         f.icon, f.status_enabled, f.status_label, f.status_options, f.statuses, f.default_on_new_cards
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

-- ----------------------------------------------------------------------------
-- preview_move_card: o que move_card_to_board criaria no board de destino.
-- Campo "existe" = mesmo nome (sem diferenciar maiúsculas/espaços nas pontas)
-- e mesmo tipo. Tag "existe" = mesmo nome.
-- Retorna { "fields_to_create": [nomes], "tags_to_create": [nomes] }.
-- ----------------------------------------------------------------------------
create or replace function public.preview_move_card(p_card_id uuid, p_board_id uuid)
returns jsonb
language plpgsql
stable
security invoker
as $$
declare
  v_card   public.cards;
  v_fields jsonb;
  v_tags   jsonb;
begin
  select * into v_card from public.cards where id = p_card_id;
  if not found then
    raise exception 'Card não encontrado';
  end if;

  select coalesce(jsonb_agg(f.name order by u.ord), '[]'::jsonb)
    into v_fields
    from unnest(coalesce(v_card.field_ids, '{}'::uuid[])) with ordinality as u(fid, ord)
    join public.fields f on f.id = u.fid
   where not exists (
     select 1 from public.fields d
      where d.board_id = p_board_id
        and lower(trim(d.name)) = lower(trim(f.name))
        and d.type = f.type
   );

  select coalesce(jsonb_agg(t.name order by t.name), '[]'::jsonb)
    into v_tags
    from public.card_tags ct
    join public.tags t on t.id = ct.tag_id
   where ct.card_id = p_card_id
     and not exists (
       select 1 from public.tags d
        where d.board_id = p_board_id
          and lower(trim(d.name)) = lower(trim(t.name))
     );

  return jsonb_build_object('fields_to_create', v_fields, 'tags_to_create', v_tags);
end;
$$;

-- ----------------------------------------------------------------------------
-- move_card_to_board: leva o card para outro board, no fim da coluna escolhida.
-- Para cada campo do card (field_ids), usa no destino o campo de mesmo nome e
-- tipo; se não houver, cria copiando a definição (ícone, opções, grupos de
-- status, show_on_card) com default_on_new_cards = false. As opções são
-- copiadas com os mesmos ids, então os valores continuam válidos.
-- Quando o campo do destino já existe mas não tem uma opção (ou grupo de
-- status) que o card usa, essa opção/grupo é acrescentada ao campo do destino,
-- para o valor não virar órfão.
-- Tags: mesma lógica, por nome.
-- ----------------------------------------------------------------------------
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
        icon, status_enabled, status_label, status_options, statuses, default_on_new_cards
      )
      values (
        p_board_id, r.name, r.type, r.options,
        (select coalesce(max(position), -1) + 1 from public.fields where board_id = p_board_id),
        r.show_on_card, r.required,
        r.icon, r.status_enabled, r.status_label, r.status_options, r.statuses, false
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

-- O trigger de updated_at de cards dispara em title/description/values/
-- column_id/archived; mover entre boards muda column_id, então o card fica
-- com updated_at novo e o realtime entrega o UPDATE com a linha completa.
