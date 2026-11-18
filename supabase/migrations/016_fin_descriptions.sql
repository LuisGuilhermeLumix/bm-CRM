-- ============================================================================
-- Lumix BM — 016: sugestão de descrição nos lançamentos
-- fin_filter_options() passa a devolver também as descrições mais usadas:
--   revenue_descriptions / expense_descriptions = [{ "text": "...", "n": 12 }, …]
-- As 300 mais usadas de cada tipo, por n desc e depois text. O texto vem
-- normalizado (espaços simples, MAIÚSCULO), que é como a tela grava.
-- "tags" e "suppliers" continuam como antes.
-- Não altera tabela, dado nem policy. Idempotente: pode rodar de novo.
-- ============================================================================

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
    ), '[]'::json),
    'revenue_descriptions', coalesce((
      select json_agg(json_build_object('text', d.descr, 'n', d.n) order by d.n desc, d.descr)
        from (
          select upper(btrim(regexp_replace(r.description, '\s+', ' ', 'g'))) as descr, count(*) as n
            from public.fin_revenues r
           where btrim(r.description) <> ''
           group by 1
           order by 2 desc, 1
           limit 300
        ) d
    ), '[]'::json),
    'expense_descriptions', coalesce((
      select json_agg(json_build_object('text', d.descr, 'n', d.n) order by d.n desc, d.descr)
        from (
          select upper(btrim(regexp_replace(e.description, '\s+', ' ', 'g'))) as descr, count(*) as n
            from public.fin_expenses e
           where btrim(e.description) <> ''
           group by 1
           order by 2 desc, 1
           limit 300
        ) d
    ), '[]'::json)
  );
$$;

revoke all on function public.fin_filter_options() from public, anon;
grant execute on function public.fin_filter_options() to authenticated;
