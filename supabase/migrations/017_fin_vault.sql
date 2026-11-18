-- ============================================================================
-- Lumix BM — 017: Credenciais no Supabase Vault + realtime das Anotações
--  1) fin_credentials.vault_secret_id: aponta para o segredo em vault.secrets
--  2) fin_credential_set_secret / fin_credential_get_secret: única porta de
--     entrada e saída do segredo. security definer, só para crm_allowed().
--     O papel `authenticated` não enxerga o schema vault; só estas funções.
--  3) trigger: excluir a credencial apaga o segredo do Vault
--  4) fin_notes entra na publicação do realtime
--  5) fin_notes.body_format: marca as anotações antigas que vieram com HTML
-- Requer a extensão supabase_vault (já instalada). Não altera policy.
-- Idempotente: pode rodar de novo.
-- ============================================================================

-- ---------- 1) coluna ------------------------------------------------------------
alter table public.fin_credentials
  add column if not exists vault_secret_id uuid;

comment on column public.fin_credentials.vault_secret_id is
  'Id do segredo em vault.secrets (nome "fin_credential:<id>"). Null = sem segredo cadastrado.';
comment on column public.fin_credentials.secret_encrypted is
  'Legado do app antigo (AES-GCM no cliente, chave perdida): não dá para decifrar. É zerado quando um segredo novo é gravado no Vault.';

-- ---------- 2) gravar / apagar o segredo ---------------------------------------
-- p_secret vazio ou null apaga o segredo. Gravar um segredo novo limpa as duas
-- colunas legadas (secret_encrypted / secret_iv).
create or replace function public.fin_credential_set_secret(p_credential_id uuid, p_secret text)
returns void
language plpgsql
security definer
set search_path = public, vault
as $$
declare
  v_secret_id uuid;
  v_name text := 'fin_credential:' || p_credential_id;
begin
  if not public.crm_allowed() then
    raise exception 'Sem permissão para alterar credenciais.' using errcode = '42501';
  end if;

  select c.vault_secret_id into v_secret_id
    from public.fin_credentials c
   where c.id = p_credential_id
     for update;
  if not found then
    raise exception 'Credencial não encontrada.';
  end if;

  if p_secret is null or p_secret = '' then
    update public.fin_credentials set vault_secret_id = null
     where id = p_credential_id and vault_secret_id is not null;
    delete from vault.secrets s where s.id = v_secret_id or s.name = v_name;
    return;
  end if;

  if v_secret_id is not null and exists (select 1 from vault.secrets s where s.id = v_secret_id) then
    perform vault.update_secret(v_secret_id, p_secret);
  else
    -- o nome é único no Vault: remove sobra de uma tentativa anterior antes de criar
    delete from vault.secrets s where s.name = v_name;
    v_secret_id := vault.create_secret(p_secret, v_name, 'Segredo de uma credencial do Lumix (fin_credentials)');
  end if;

  update public.fin_credentials
     set vault_secret_id = v_secret_id,
         secret_encrypted = null,
         secret_iv = null
   where id = p_credential_id;
end $$;

revoke all on function public.fin_credential_set_secret(uuid, text) from public, anon;
grant execute on function public.fin_credential_set_secret(uuid, text) to authenticated;

-- ---------- ler o segredo --------------------------------------------------------
-- Devolve o segredo em texto puro, ou null se a credencial não tem segredo no Vault.
create or replace function public.fin_credential_get_secret(p_credential_id uuid)
returns text
language plpgsql
security definer
set search_path = public, vault
as $$
declare
  v_secret text;
begin
  if not public.crm_allowed() then
    raise exception 'Sem permissão para ver credenciais.' using errcode = '42501';
  end if;

  select d.decrypted_secret into v_secret
    from public.fin_credentials c
    join vault.decrypted_secrets d on d.id = c.vault_secret_id
   where c.id = p_credential_id;
  return v_secret;
end $$;

revoke all on function public.fin_credential_get_secret(uuid) from public, anon;
grant execute on function public.fin_credential_get_secret(uuid) to authenticated;

-- ---------- 3) excluir a credencial apaga o segredo ------------------------------
create or replace function public.fin_credentials_delete_secret()
returns trigger
language plpgsql
security definer
set search_path = public, vault
as $$
begin
  delete from vault.secrets s
   where s.id = old.vault_secret_id
      or s.name = 'fin_credential:' || old.id;
  return old;
end $$;

revoke all on function public.fin_credentials_delete_secret() from public, anon, authenticated;

drop trigger if exists fin_credentials_delete_secret on public.fin_credentials;
create trigger fin_credentials_delete_secret
  after delete on public.fin_credentials
  for each row execute function public.fin_credentials_delete_secret();

-- ---------- 5) anotações antigas com HTML ------------------------------------------
-- A tela guarda texto puro. As notas importadas vieram com HTML (<div>, <br>,
-- &nbsp;): ficam marcadas 'html' e a tela converte e grava como 'text' na
-- primeira vez que cada uma é aberta. Sem esta marca não daria para distinguir
-- HTML antigo de uma nota nova em que alguém digitou "<div>" de propósito.
-- A marcação só roda quando a coluna é criada (rodar a migration de novo não
-- remarca nada) e não mexe em updated_at.
do $$
begin
  if not exists (select 1 from information_schema.columns
                  where table_schema = 'public' and table_name = 'fin_notes' and column_name = 'body_format') then
    alter table public.fin_notes
      add column body_format text not null default 'text' check (body_format in ('text', 'html'));
    alter table public.fin_notes disable trigger fin_notes_set_updated_at;
    update public.fin_notes
       set body_format = 'html'
     where body ~* '</?(div|br|p|span|b|i|u|strong|em|ul|ol|li|a|font|h[1-6])[ />]|&nbsp;';
    alter table public.fin_notes enable trigger fin_notes_set_updated_at;
  end if;
end $$;

comment on column public.fin_notes.body_format is
  '''text'' = texto puro (padrão). ''html'' = nota importada do sistema antigo, ainda com HTML; a tela converte para texto ao abrir.';

-- ---------- 4) realtime das Anotações ---------------------------------------------
do $$
begin
  if exists (select 1 from pg_publication where pubname = 'supabase_realtime')
     and not exists (select 1 from pg_publication_tables
                      where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'fin_notes') then
    alter publication supabase_realtime add table public.fin_notes;
  end if;
end $$;
