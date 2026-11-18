-- ============================================================================
-- Lumix BM — 012: e-mail dos usuários na tela Configurações → Usuários
-- `profiles` só guarda o nome; o e-mail fica em auth.users, que o app não lê.
-- crm_profile_emails() devolve id + e-mail de quem tem perfil, como security
-- definer, e só para quem já está liberado (crm_allowed()).
-- Não altera tabela nem policy. Idempotente: pode rodar de novo.
-- ============================================================================

create or replace function public.crm_profile_emails()
returns table (id uuid, email text)
language plpgsql
stable
security definer
set search_path = public
as $$
begin
  if not public.crm_allowed() then
    raise exception 'Sem permissão para ver os e-mails.' using errcode = '42501';
  end if;
  return query
    select u.id, u.email::text
      from auth.users u
      join public.profiles p on p.id = u.id;
end $$;

revoke all on function public.crm_profile_emails() from public, anon;
grant execute on function public.crm_profile_emails() to authenticated;
