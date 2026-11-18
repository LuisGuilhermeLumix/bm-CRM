-- ============================================================================
-- Lumix BM — 015: Dashboard, Distribuição de Lucro e Relatórios
--  1) fin_profit_distributions: uma por mês + tipo de operação (era uma por mês)
--  2) fin_monthly_series(p_end_month, p_months): receita/despesa/lucro por mês
--  3) fin_by_category(p_from, p_to): receita e despesa realizadas por categoria
--  4) fin_profit_by_operation(p_month): lucro do mês por tipo de operação, com
--     o custo geral rateado
-- Em todas: só lançamentos com status 'Pago', pelo mês/período da Data
-- (due_date). stable, security invoker (vale a RLS), execute só para authenticated.
-- Não altera policy nem dado. Idempotente: pode rodar de novo.
-- ============================================================================

-- ---------- 1) registro da distribuição: única por (mês, tipo) -----------------
-- `month` continua 'YYYY-MM'. A unique antiga (só month) impedia registrar um
-- mês por tipo de operação.
alter table public.fin_profit_distributions
  drop constraint if exists fin_profit_distributions_month_key;

do $$
begin
  if not exists (
    select 1 from pg_constraint
     where conname = 'fin_profit_distributions_month_type_key'
       and conrelid = 'public.fin_profit_distributions'::regclass
  ) then
    alter table public.fin_profit_distributions
      add constraint fin_profit_distributions_month_type_key unique (month, operation_type_id);
  end if;
end $$;

-- ---------- 2) série mensal (gráficos do Dashboard) ----------------------------
-- p_months meses terminando no mês de p_end_month (null = mês atual de Brasília),
-- do mais antigo para o mais novo. Meses sem movimento vêm com zero.
create or replace function public.fin_monthly_series(
  p_end_month date default null,
  p_months int default 6
)
returns table (
  month_start date,
  revenue_paid numeric,
  expense_paid numeric,
  profit numeric
)
language sql
stable
security invoker
set search_path = public
as $$
  with m as (
    select (date_trunc('month', coalesce(p_end_month, (now() at time zone 'America/Sao_Paulo')::date)::timestamp)
            - make_interval(months => g.n))::date as d0
      from generate_series(0, least(greatest(coalesce(p_months, 6), 1), 36) - 1) as g(n)
  )
  select m.d0, r.amount, e.amount, r.amount - e.amount
    from m
    cross join lateral (
      select coalesce(sum(x.value), 0) as amount
        from public.fin_revenues x
       where x.status = 'Pago' and x.due_date >= m.d0 and x.due_date < (m.d0 + interval '1 month')::date
    ) r
    cross join lateral (
      select coalesce(sum(x.value), 0) as amount
        from public.fin_expenses x
       where x.status = 'Pago' and x.due_date >= m.d0 and x.due_date < (m.d0 + interval '1 month')::date
    ) e
   order by m.d0;
$$;

revoke all on function public.fin_monthly_series(date, int) from public, anon;
grant execute on function public.fin_monthly_series(date, int) to authenticated;

-- ---------- 3) realizado por categoria (Relatórios) ----------------------------
-- kind = 'revenue' | 'expense'. Lançamento sem categoria entra como "Sem categoria"
-- (category_id null). Limites do período inclusivos; null = sem limite.
create or replace function public.fin_by_category(
  p_from date default null,
  p_to date default null
)
returns table (
  kind text,
  category_id int,
  category_name text,
  total numeric,
  entries bigint
)
language sql
stable
security invoker
set search_path = public
as $$
  select 'revenue'::text, x.category_id, coalesce(c.name, 'Sem categoria'), sum(x.value), count(*)
    from public.fin_revenues x
    left join public.fin_revenue_categories c on c.id = x.category_id
   where x.status = 'Pago'
     and (p_from is null or x.due_date >= p_from)
     and (p_to is null or x.due_date <= p_to)
   group by x.category_id, c.name
  union all
  select 'expense'::text, x.category_id, coalesce(c.name, 'Sem categoria'), sum(x.value), count(*)
    from public.fin_expenses x
    left join public.fin_expense_categories c on c.id = x.category_id
   where x.status = 'Pago'
     and (p_from is null or x.due_date >= p_from)
     and (p_to is null or x.due_date <= p_to)
   group by x.category_id, c.name
   order by 1 desc, 4 desc, 3;  -- receitas primeiro; dentro de cada uma, maior total primeiro
$$;

revoke all on function public.fin_by_category(date, date) from public, anon;
grant execute on function public.fin_by_category(date, date) to authenticated;

-- ---------- 4) lucro do mês por tipo de operação --------------------------------
-- O tipo de um lançamento é o tipo de operação do cliente/entidade dele.
--   revenue_paid   receitas pagas do tipo
--   expense_direct despesas pagas de clientes/entidades com esse tipo
--                  (Lumix REC tem tipo Recuperação: entra direto lá)
--   expense_shared parte rateada do custo geral = despesas pagas de entidades
--                  internas SEM tipo (Lumix), proporcional à revenue_paid de
--                  cada tipo no mês; os centavos do arredondamento ficam no
--                  tipo de maior receita, então a soma bate com o custo geral
--   profit         revenue_paid - expense_direct - expense_shared
-- Linhas: todo tipo ativo (mesmo zerado) + tipo inativo que teve movimento no
-- mês + "Sem tipo" (operation_type_id null) quando houver receita/despesa de
-- cliente sem tipo ou sem cliente. Se nenhum tipo teve receita no mês, o custo
-- geral inteiro vai para "Sem tipo".
create or replace function public.fin_profit_by_operation(p_month date)
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
security invoker
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

revoke all on function public.fin_profit_by_operation(date) from public, anon;
grant execute on function public.fin_profit_by_operation(date) to authenticated;
