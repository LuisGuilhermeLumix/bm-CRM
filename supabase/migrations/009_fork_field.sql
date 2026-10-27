-- ============================================================================
-- Lumix BM — 009: definição de campo por card ("Salvar" vs "Salvar para todos")
-- Editar um campo usado por vários cards passa a oferecer duas saídas:
--   * Salvar            -> fork: nova linha em fields só para este card
--   * Salvar para todos -> update in place (comportamento antigo)
-- Esta migration cria o fork. Idempotente (create or replace).
-- Todas as funções são security invoker: as políticas de RLS (crm_allowed)
-- continuam valendo para quem chama.
-- ============================================================================

comment on table public.fields is
  'Catálogo de definições de campo do board. Pode haver várias definições com o mesmo nome no board '
  '(forks criados por "Salvar" só neste card): para o usuário a identidade do campo é o nome (+ tipo); '
  'cada card aponta para uma definição específica via cards.field_ids.';

-- ----------------------------------------------------------------------------
-- identity_map: { "<id>": "<id>" } para cada id do array. Serve para passar a
-- remap_card_values um mapa que preserva todas as chaves (ela descarta chaves
-- cujo field_id não está no mapa).
-- ----------------------------------------------------------------------------
create or replace function public.identity_map(p_ids uuid[])
returns jsonb
language sql
immutable
as $$
  select coalesce(jsonb_object_agg(u.id::text, u.id::text), '{}'::jsonb)
    from unnest(coalesce(p_ids, '{}'::uuid[])) as u(id);
$$;

-- ----------------------------------------------------------------------------
-- fork_field_for_card: copia a definição do campo (com p_patch aplicado) para
-- uma nova linha em fields e faz SÓ este card apontar para ela, remapeando
-- cards.field_ids (mesma posição) e as chaves de cards.values
-- ("<old>" -> "<new>", "<old>:status:<g>" -> "<new>:status:<g>").
-- Os outros cards continuam na definição antiga, intacta.
--
-- p_patch aceita: name, icon, type, options, statuses, show_on_card, required,
-- is_deadline. Chaves ausentes mantêm o valor do original. Chaves fora dessa
-- lista são ignoradas. default_on_new_cards é sempre false no fork (um fork
-- não vira padrão de cards novos); position é a do original.
-- ----------------------------------------------------------------------------
create or replace function public.fork_field_for_card(p_card_id uuid, p_field_id uuid, p_patch jsonb default '{}'::jsonb)
returns public.fields
language plpgsql
security invoker
as $$
declare
  v_src   public.fields;
  v_card  public.cards;
  v_new   public.fields;
  v_patch jsonb := coalesce(p_patch, '{}'::jsonb);
begin
  if jsonb_typeof(v_patch) <> 'object' then
    raise exception 'Alterações inválidas';
  end if;

  select * into v_src from public.fields where id = p_field_id;
  if not found then
    raise exception 'Campo não encontrado';
  end if;

  select * into v_card from public.cards where id = p_card_id for update;
  if not found then
    raise exception 'Card não encontrado';
  end if;
  if v_card.board_id <> v_src.board_id then
    raise exception 'O card e o campo são de boards diferentes';
  end if;
  if not (p_field_id = any(coalesce(v_card.field_ids, '{}'::uuid[]))) then
    raise exception 'Este card não usa esse campo';
  end if;

  insert into public.fields (
    board_id, name, type, options, position, show_on_card, required,
    icon, status_enabled, status_label, status_options, statuses, default_on_new_cards, is_deadline
  )
  values (
    v_src.board_id,
    coalesce(nullif(trim(v_patch ->> 'name'), ''), v_src.name),
    coalesce(v_patch ->> 'type', v_src.type),
    case when v_patch ? 'options'  then coalesce(v_patch -> 'options',  '[]'::jsonb) else v_src.options  end,
    v_src.position,
    case when v_patch ? 'show_on_card' then coalesce((v_patch ->> 'show_on_card')::boolean, v_src.show_on_card) else v_src.show_on_card end,
    case when v_patch ? 'required'     then coalesce((v_patch ->> 'required')::boolean,     v_src.required)     else v_src.required     end,
    case when v_patch ? 'icon' then nullif(v_patch ->> 'icon', '') else v_src.icon end,
    v_src.status_enabled,
    v_src.status_label,
    v_src.status_options,
    case when v_patch ? 'statuses' then coalesce(v_patch -> 'statuses', '[]'::jsonb) else v_src.statuses end,
    false,
    case when v_patch ? 'is_deadline' then coalesce((v_patch ->> 'is_deadline')::boolean, v_src.is_deadline) else v_src.is_deadline end
  )
  returning * into v_new;

  -- só este card: troca o id na mesma posição e remapeia as chaves de values.
  -- identity_map(field_ids) mantém as chaves dos outros campos do card.
  update public.cards
     set field_ids = array_replace(field_ids, p_field_id, v_new.id),
         values    = public.remap_card_values(
                       values,
                       public.identity_map(field_ids) || jsonb_build_object(p_field_id::text, v_new.id::text)
                     )
   where id = p_card_id;

  insert into public.card_activity (card_id, user_id, type, payload)
  values (
    p_card_id, auth.uid(), 'updated',
    jsonb_build_object('field_forked', jsonb_build_object('from', p_field_id, 'to', v_new.id, 'name', v_new.name))
  );

  return v_new;
end;
$$;

-- Nota: preview_move_card e move_card_to_board (007/008) continuam escolhendo
-- o campo de destino por nome + tipo com "order by position, created_at limit 1",
-- ou seja, a primeira variação do board de destino. duplicate_board copia todas
-- as definições (forks inclusive) integralmente. Nada muda aqui.
