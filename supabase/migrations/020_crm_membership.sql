-- ============================================================================
-- Lumix BM — 020: quem faz parte do CRM (profiles.in_crm) + remover/readicionar
-- Já aplicada no banco; este arquivo só versiona. O projeto Supabase é
-- compartilhado: perfis de outros sistemas ficam com in_crm = false e não
-- aparecem para ninguém do CRM (a policy de select filtra).
-- ============================================================================

alter table public.profiles add column if not exists in_crm boolean not null default false;
comment on column public.profiles.in_crm is 'true = faz parte do Lumix OP (aparece em Configurações → Usuários). O projeto Supabase é compartilhado: perfis de outros sistemas ficam false.';
update public.profiles set in_crm = true where allowed = true and not in_crm;

create or replace function public.crm_remove_from_crm(p_id uuid)
returns void language plpgsql security definer set search_path = public as $$
begin
  if not public.crm_caller_is_admin() then raise exception 'Só administradores removem usuários.' using errcode = '42501'; end if;
  if p_id = auth.uid() then raise exception 'Você não pode remover a si mesmo.'; end if;
  update public.profiles set in_crm = false, allowed = false where id = p_id;
  delete from public.crm_access where profile_id = p_id;
end $$;
revoke all on function public.crm_remove_from_crm(uuid) from public, anon;
grant execute on function public.crm_remove_from_crm(uuid) to authenticated, service_role;

create or replace function public.crm_add_to_crm(p_id uuid)
returns void language plpgsql security definer set search_path = public as $$
begin
  if not public.crm_caller_is_admin() then raise exception 'Só administradores.' using errcode = '42501'; end if;
  update public.profiles set in_crm = true, allowed = true where id = p_id;
end $$;
revoke all on function public.crm_add_to_crm(uuid) from public, anon;
grant execute on function public.crm_add_to_crm(uuid) to authenticated, service_role;

alter policy "profiles_select_allowed" on public.profiles using (id = (select auth.uid()) or (public.crm_allowed() and in_crm));
