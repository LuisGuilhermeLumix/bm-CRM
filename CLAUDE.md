# Lumix BM — regras do projeto

## O que é
CRM interno da Lumix (Business Manager): kanban personalizável, HTML + CSS + JS vanilla (módulos ES, sem build), Supabase (projeto "SDR") e deploy como site estático via Dockerfile/Nginx no EasyPanel.

## Fluxo de trabalho
- Depois de qualquer alteração, **sempre commita e dá push na branch `main`** sem perguntar. Mensagem curta descrevendo a mudança. Um push = um deploy pronto no EasyPanel.
- **Nunca commite `js/config.js`** (está no `.gitignore`; em produção ele é gerado pelo `docker-entrypoint.sh` a partir de env vars).
- Não crie `package.json` com build step. O projeto é servido estático.

## Banco (Supabase)
- Mudanças de schema vão em `supabase/migrations/NNN_descricao.sql`, numerado em sequência, idempotente (`if not exists` / `create or replace`).
- **Não aplique migrations no banco.** Só escreva o arquivo e avise no fim. Quem aplica é o dono do projeto.
- Não altere políticas de RLS existentes sem pedir. Acesso ao CRM é por `profiles.allowed` (função `crm_allowed()`); o projeto Supabase é compartilhado com outros sistemas.
- Convenções em `cards.values`: `"<field_id>"` = valor; `"<field_id>:status:<group_id>"` = status (string ou array se o grupo for múltiplo).

## Front
- Cores só via tokens em `css/tokens.css`; nada hardcoded em `app.css`.
- Ícones: Lucide (versão fixada no `index.html`). Sem emoji na interface. Valide que todo nome de ícone existe.
- Textos em português do Brasil. Confirmações destrutivas em modal, nunca `window.confirm`.
- Popovers/menus usam `openPopover` de `js/ui/dialog.js`. Componentes de campo (editor, opções, ícone) têm fonte única em `js/ui/fieldEditor.js`, `fieldInputs.js`, `iconPicker.js`.
- Realtime: ao mudar o shape de `fields`, `cards` ou `boards`, atualize as chaves comparadas em `js/state.js`.

## Entrega
No fim de cada tarefa: liste o que foi feito, o que ficou de fora e por quê, e se há migration nova pra aplicar.
