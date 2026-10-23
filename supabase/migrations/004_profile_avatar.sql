-- ============================================================================
-- Lumix BM — 004: avatar personalizado no perfil
-- Idempotente: pode rodar de novo.
-- ============================================================================

-- ----------------------------------------------------------------------------
-- profiles.avatar_url: URL pública da foto do usuário (null = sem foto, usa
-- a inicial colorida como antes).
-- ----------------------------------------------------------------------------
alter table public.profiles
  add column if not exists avatar_url text null;

comment on column public.profiles.avatar_url is
  'URL pública da foto do avatar (bucket "avatars" no Supabase Storage). '
  'Null = sem foto; a UI mostra a inicial do nome sobre fundo avatar_color.';

-- ----------------------------------------------------------------------------
-- STORAGE: bucket "avatars"
-- ----------------------------------------------------------------------------
-- O bucket é criado pelo painel do Supabase (Storage → New bucket →
--   nome: avatars, Public: ligado). As políticas abaixo exigem que o bucket
--   já exista. Rodando com o bucket faltando, as políticas falham com um erro
--   claro e nada mais é alterado.
--
-- Convenção de caminho: cada arquivo mora em <user_id>/<nome>. Assim o guard
--   (storage.foldername(name))[1] = auth.uid()::text impede alguém de gravar
--   em pasta de outro.
-- ----------------------------------------------------------------------------

-- Leitura pública (o bucket já é "Public", mas a policy deixa isso explícito
-- caso alguém desligue o flag no painel).
drop policy if exists "avatars read public"       on storage.objects;
create policy "avatars read public" on storage.objects
  for select
  using (bucket_id = 'avatars');

-- Upload / substituição / remoção: só pelo próprio dono, só na sua pasta.
drop policy if exists "avatars insert own folder" on storage.objects;
create policy "avatars insert own folder" on storage.objects
  for insert to authenticated
  with check (
    bucket_id = 'avatars'
    and (storage.foldername(name))[1] = (select auth.uid())::text
  );

drop policy if exists "avatars update own folder" on storage.objects;
create policy "avatars update own folder" on storage.objects
  for update to authenticated
  using (
    bucket_id = 'avatars'
    and (storage.foldername(name))[1] = (select auth.uid())::text
  )
  with check (
    bucket_id = 'avatars'
    and (storage.foldername(name))[1] = (select auth.uid())::text
  );

drop policy if exists "avatars delete own folder" on storage.objects;
create policy "avatars delete own folder" on storage.objects
  for delete to authenticated
  using (
    bucket_id = 'avatars'
    and (storage.foldername(name))[1] = (select auth.uid())::text
  );
