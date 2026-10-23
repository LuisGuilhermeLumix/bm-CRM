-- ============================================================================
-- Lumix CRM — 002: lista de permitidos
-- O projeto Supabase é compartilhado com outros sistemas (SDR, Pharmazil...),
-- então "qualquer usuário autenticado" não serve: só quem tiver
-- profiles.allowed = true pode ler/escrever nas tabelas do CRM.
-- Idempotente: pode rodar de novo.
-- ============================================================================

alter table public.profiles
  add column if not exists allowed boolean not null default false;

-- Helper usado nas políticas. STABLE para o planner cachear por statement.
create or replace function public.crm_allowed()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select coalesce(
    (select p.allowed from public.profiles p where p.id = auth.uid()),
    false
  );
$$;

revoke all on function public.crm_allowed() from public;
grant execute on function public.crm_allowed() to authenticated;

-- Troca a política "authenticated faz tudo" por "allowed faz tudo"
do $$
declare t text;
begin
  foreach t in array array['boards','columns','fields','tags','cards','card_tags','card_activity'] loop
    execute format('drop policy if exists %I on public.%I', t || '_all_authenticated', t);
    execute format('drop policy if exists %I on public.%I', t || '_all_allowed', t);
    execute format(
      'create policy %I on public.%I for all to authenticated using (public.crm_allowed()) with check (public.crm_allowed())',
      t || '_all_allowed', t
    );
  end loop;
end $$;

-- profiles: só quem é allowed vê a lista de perfis (nomes/avatares dos colegas).
-- O próprio usuário sempre enxerga a própria linha, pra o app conseguir
-- descobrir que ele NÃO tem acesso e mostrar a mensagem certa.
drop policy if exists "profiles_select_authenticated" on public.profiles;
drop policy if exists "profiles_select_allowed" on public.profiles;
create policy "profiles_select_allowed" on public.profiles
  for select to authenticated
  using (id = (select auth.uid()) or public.crm_allowed());

-- `allowed` só muda pelo SQL Editor / service role, nunca pelo próprio usuário.
drop policy if exists "profiles_update_own" on public.profiles;
create policy "profiles_update_own" on public.profiles
  for update to authenticated
  using (id = (select auth.uid()))
  with check (id = (select auth.uid()) and allowed = (select p.allowed from public.profiles p where p.id = auth.uid()));

-- Liberação inicial: as duas contas da Lumix
update public.profiles p
   set allowed = true
  from auth.users u
 where u.id = p.id
   and u.email in ('luisguilherme.lumix@gmail.com', 'hercules.lumixcomercial@gmail.com');

-- Para liberar mais alguém depois:
--   update public.profiles set allowed = true
--    where id = (select id from auth.users where email = 'email@exemplo.com');
