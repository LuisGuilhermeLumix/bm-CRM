-- ============================================================================
-- Lumix BM — 013: Financeiro (totais do período, opções de filtro e receitas
-- recorrentes). No plano original era a 012; a 012 virou profile_emails.
--  1) fin_revenues.recurring_day / recurring_parent_id
--  2) fin_totals(p_from, p_to, p_tags): cards da tela, somados no banco
--  3) fin_filter_options(): tags e fornecedores já usados
--  4) fin_generate_recurring(): cria a cobrança do mês das receitas recorrentes
--  5) pg_cron: roda a geração todo dia às 06:00 UTC (03:00 de Brasília)
-- Não altera policy nem dado existente. Idempotente: pode rodar de novo.
-- ============================================================================

-- ---------- 1) colunas da recorrência ----------------------------------------
-- recurring_day: dia do mês da cobrança ("todo dia N"); null = dia da própria data.
-- recurring_parent_id: nas cobranças geradas, aponta para a receita recorrente.
alter table public.fin_revenues
  add column if not exists recurring_day int
    check (recurring_day is null or recurring_day between 1 and 31),
  add column if not exists recurring_parent_id uuid
    references public.fin_revenues(id) on delete set null;

comment on column public.fin_revenues.recurring_day is
  'Dia do mês da cobrança recorrente (1-31; mês mais curto usa o último dia). Null = mesmo dia de due_date.';
comment on column public.fin_revenues.recurring_parent_id is
  'Receita recorrente que gerou esta cobrança (fin_generate_recurring). Null = lançamento manual.';

-- Trava contra duplicidade: no máximo uma cobrança gerada por receita por mês.
create unique index if not exists fin_revenues_recurring_month_uidx
  on public.fin_revenues (recurring_parent_id, (date_trunc('month', due_date::timestamp)))
  where recurring_parent_id is not null;

-- ---------- 2) totais do período ----------------------------------------------
-- O período filtra pela Data do lançamento (due_date). p_tags: qualquer uma
-- das tags. "A receber"/"A pagar" = Pendente (e o legado Atrasado); Cancelado
-- fica fora das somas. Security invoker: vale a RLS (crm_allowed).
create or replace function public.fin_totals(
  p_from date default null,
  p_to date default null,
  p_tags text[] default null
)
returns table (
  revenue_paid numeric,
  revenue_pending numeric,
  revenue_count bigint,
  expense_paid numeric,
  expense_pending numeric,
  expense_count bigint
)
language sql
stable
set search_path = public
as $$
  select r.paid, r.pending, r.n, e.paid, e.pending, e.n
    from (
      select coalesce(sum(x.value) filter (where x.status = 'Pago'), 0) as paid,
             coalesce(sum(x.value) filter (where x.status in ('Pendente', 'Atrasado')), 0) as pending,
             count(*) as n
        from public.fin_revenues x
       where (p_from is null or x.due_date >= p_from)
         and (p_to is null or x.due_date <= p_to)
         and (coalesce(cardinality(p_tags), 0) = 0 or x.tags && p_tags)
    ) r
    cross join (
      select coalesce(sum(x.value) filter (where x.status = 'Pago'), 0) as paid,
             coalesce(sum(x.value) filter (where x.status in ('Pendente', 'Atrasado')), 0) as pending,
             count(*) as n
        from public.fin_expenses x
       where (p_from is null or x.due_date >= p_from)
         and (p_to is null or x.due_date <= p_to)
         and (coalesce(cardinality(p_tags), 0) = 0 or x.tags && p_tags)
    ) e;
$$;

revoke all on function public.fin_totals(date, date, text[]) from public, anon;
grant execute on function public.fin_totals(date, date, text[]) to authenticated;

-- ---------- 3) opções de filtro / sugestões -----------------------------------
-- { "tags": [...], "suppliers": [...] } — o que já foi usado nos lançamentos.
create or replace function public.fin_filter_options()
returns json
language sql
stable
set search_path = public
as $$
  select json_build_object(
    'tags', coalesce((
      select json_agg(t.tag order by t.tag)
        from (
          select unnest(r.tags) as tag from public.fin_revenues r
          union
          select unnest(e.tags) from public.fin_expenses e
        ) t
       where nullif(trim(t.tag), '') is not null
    ), '[]'::json),
    'suppliers', coalesce((
      select json_agg(s.supplier order by s.supplier)
        from (
          select distinct e.supplier from public.fin_expenses e
           where nullif(trim(e.supplier), '') is not null
        ) s
    ), '[]'::json)
  );
$$;

revoke all on function public.fin_filter_options() from public, anon;
grant execute on function public.fin_filter_options() to authenticated;

-- ---------- 4) geração das cobranças recorrentes -------------------------------
-- Para cada receita com recurring = true (e que não é ela mesma uma cobrança
-- gerada), cria a cobrança do mês corrente se ainda não existir: mesma
-- descrição, cliente, categoria, valor e tags; status Pendente; dia =
-- recurring_day (ou o dia da receita), limitado ao último dia do mês.
-- A receita original já vale pelo mês dela, então só gera para meses seguintes.
-- "Mês corrente" é o de Brasília. Devolve quantas cobranças criou.
create or replace function public.fin_generate_recurring()
returns int
language plpgsql
set search_path = public
as $$
declare
  v_today date := (now() at time zone 'America/Sao_Paulo')::date;
  v_month date := date_trunc('month', v_today::timestamp)::date;
  v_next  date := (v_month + interval '1 month')::date;
  v_last  int  := (v_next - v_month);            -- dias no mês corrente
  v_count int;
begin
  insert into public.fin_revenues
    (client_id, description, category_id, value, due_date, method, status,
     recurring, recurring_day, recurring_parent_id, tags)
  select r.client_id, r.description, r.category_id, r.value,
         v_month + (least(coalesce(r.recurring_day, extract(day from r.due_date)::int), v_last) - 1),
         r.method, 'Pendente',
         false, r.recurring_day, r.id, r.tags
    from public.fin_revenues r
   where r.recurring
     and r.recurring_parent_id is null
     and r.due_date is not null
     and r.due_date < v_month
     and not exists (
       select 1
         from public.fin_revenues c
        where c.recurring_parent_id = r.id
          and c.due_date >= v_month
          and c.due_date < v_next
     )
  on conflict do nothing;

  get diagnostics v_count = row_count;
  return v_count;
end $$;

revoke all on function public.fin_generate_recurring() from public, anon;
grant execute on function public.fin_generate_recurring() to authenticated, service_role;

-- ---------- 5) agendamento diário (pg_cron) ------------------------------------
create extension if not exists pg_cron with schema pg_catalog;

do $$
begin
  if exists (select 1 from cron.job where jobname = 'fin_generate_recurring') then
    perform cron.unschedule('fin_generate_recurring');
  end if;
  perform cron.schedule('fin_generate_recurring', '0 6 * * *', 'select public.fin_generate_recurring()');
end $$;
