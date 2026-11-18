-- ============================================================================
-- Lumix BM — 019: admin edita nome e foto de outro usuário
-- Já aplicada no banco; este arquivo só versiona a definição (copiada do banco
-- com pg_get_functiondef). Usada em Configurações → Usuários → "Editar".
-- p_name vazio mantém o nome; p_clear_avatar = true zera a foto; senão
-- p_avatar_url (quando vier) troca a foto. Idempotente.
-- ============================================================================

create or replace function public.crm_admin_update_profile(
  p_id uuid,
  p_name text default null,
  p_avatar_url text default null,
  p_clear_avatar boolean default false
)
returns public.profiles
language plpgsql
security definer
set search_path to 'public'
as $function$
declare v_row public.profiles;
begin
  if not public.crm_caller_is_admin() then raise exception 'Só administradores editam outros perfis.' using errcode = '42501'; end if;
  update public.profiles
     set name = coalesce(nullif(trim(p_name), ''), name),
         avatar_url = case when p_clear_avatar then null else coalesce(p_avatar_url, avatar_url) end
   where id = p_id returning * into v_row;
  if not found then raise exception 'Usuário não encontrado.'; end if;
  return v_row;
end $function$;

revoke all on function public.crm_admin_update_profile(uuid, text, text, boolean) from public, anon;
grant execute on function public.crm_admin_update_profile(uuid, text, text, boolean) to authenticated, service_role;
