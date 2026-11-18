-- ============================================================================
-- Lumix BM — 014: ajustes do Financeiro
--  1) fin_clients.logo_url: logo em imagem (bucket "client-logos", que já existe)
--  2) fin_clients.is_internal: a própria empresa (Lumix e Lumix REC) deixa de
--     ser "cliente" — some da tela Clientes e é editada em Configurações → Empresa
--  3) seed das duas entidades internas
-- paid_date continua nas tabelas; só deixou de ser usada pela tela.
-- Não altera policy. Idempotente: pode rodar de novo.
-- ============================================================================

alter table public.fin_clients
  add column if not exists logo_url text,
  add column if not exists is_internal boolean not null default false;

comment on column public.fin_clients.logo_url is
  'URL pública da logo (bucket "client-logos", path <client_id>/logo.<ext>). Null = inicial do nome sobre logo_bg.';
comment on column public.fin_clients.is_internal is
  'true = entidade da própria empresa (Lumix, Lumix REC). Com operation_type_id, as despesas entram direto no lucro daquele tipo; sem tipo, são custo geral rateado entre os tipos.';
comment on column public.fin_revenues.paid_date is
  'Legado: a tela usa só due_date ("Data"). "Marcar pago" muda apenas o status.';
comment on column public.fin_expenses.paid_date is
  'Legado: a tela usa só due_date ("Data"). "Marcar pago" muda apenas o status.';

-- Lumix REC já existe como cliente (com as despesas vinculadas): vira entidade
-- interna e mantém o tipo de operação que tiver (Recuperação).
update public.fin_clients
   set is_internal = true
 where name = 'Lumix REC'
   and not is_internal;

-- Lumix: custo geral (sem tipo de operação), rateado entre os tipos.
insert into public.fin_clients (name, stage, is_internal, operation_type_id, logo_bg)
select 'Lumix', 'active', true, null, '#8b6cf6'
 where not exists (select 1 from public.fin_clients where name = 'Lumix');
