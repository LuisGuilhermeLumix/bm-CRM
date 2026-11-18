-- ============================================================================
-- Lumix BM — 011: configurações (Usuários + parâmetros do Financeiro)
--  1) set_profile_allowed(): liberar/bloquear o acesso de alguém pelo app.
--     A policy profiles_update_own (002) não deixa ninguém mexer em `allowed`;
--     esta função faz isso como security definer, só para quem já é liberado.
--  2) fin_settings: chave/valor com os parâmetros globais do Financeiro
--     (reinvest_pct e reserve_pct, abatidos do lucro antes de dividir).
-- Não altera nenhuma policy existente. Idempotente: pode rodar de novo.
-- ============================================================================

-- ---------- 1) liberar / bloquear usuário ------------------------------------
create or replace function public.set_profile_allowed(p_id uuid, p_allowed boolean)
returns public.profiles
language plpgsql
security definer
set search_path = public
as $$
declare
  v_row public.profiles;
begin
  if not public.crm_allowed() then
    raise exception 'Sem permissão para alterar acessos.' using errcode = '42501';
  end if;
  if p_id = auth.uid() and not coalesce(p_allowed, false) then
    raise exception 'Você não pode bloquear o seu próprio acesso.';
  end if;

  update public.profiles
     set allowed = coalesce(p_allowed, false)
   where id = p_id
  returning * into v_row;

  if not found then
    raise exception 'Usuário não encontrado.';
  end if;
  return v_row;
end $$;

revoke all on function public.set_profile_allowed(uuid, boolean) from public, anon;
grant execute on function public.set_profile_allowed(uuid, boolean) to authenticated;

-- ---------- 2) parâmetros do Financeiro --------------------------------------
create table if not exists public.fin_settings (
  key text primary key,
  value jsonb not null,
  updated_at timestamptz not null default now()
);
comment on table public.fin_settings is
  'Parâmetros globais do Financeiro. reinvest_pct / reserve_pct: % do lucro abatido antes da distribuição.';

insert into public.fin_settings (key, value)
values ('reinvest_pct', '0'), ('reserve_pct', '0')
on conflict (key) do nothing;

drop trigger if exists fin_settings_set_updated_at on public.fin_settings;
create trigger fin_settings_set_updated_at before update on public.fin_settings
  for each row execute function public.set_updated_at();

alter table public.fin_settings enable row level security;
drop policy if exists fin_settings_all_allowed on public.fin_settings;
create policy fin_settings_all_allowed on public.fin_settings
  for all to authenticated
  using (public.crm_allowed()) with check (public.crm_allowed());
