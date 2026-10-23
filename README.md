# Lumix BM

CRM interno da Lumix em formato kanban personalizável. Diferente de um CRM de nicho, aqui **você define os status (colunas), os campos de cada card e as tags**, cada um com nome e cor próprios. Serve para gerenciar clientes e leads de vários nichos, cada um no seu board.

- **Boards** independentes (ex.: Clientes, Leads Imobiliária, Parcerias), cada um com suas colunas, campos e tags
- **Kanban** com drag-and-drop de cards e de colunas, limite WIP opcional, busca e filtro por tag
- **Campos personalizados** por board: texto, texto longo, número, moeda (R$), data, seleção única, seleção múltipla, checkbox, URL, e-mail e telefone (com atalho para WhatsApp)
- **Modal do card** com salvamento automático, tags, observações e histórico de atividade com comentários
- **Realtime**: as duas pessoas veem as mudanças uma da outra sem recarregar
- **Tema escuro** por padrão, com tema claro
- Funciona no celular (sidebar vira drawer, kanban com scroll por coluna, drag-and-drop no toque)

Stack: HTML + CSS + JavaScript vanilla (módulos ES, sem build), [Supabase](https://supabase.com) (Postgres + Auth + Realtime), SortableJS e Lucide via CDN, fonte Inter.

---

## 1. Criar o projeto no Supabase

1. Acesse [supabase.com](https://supabase.com), crie um projeto (região South America se possível) e anote a senha do banco.
2. Espere o projeto subir e abra **SQL Editor** no menu lateral.
3. Abra o arquivo [`supabase/migrations/001_init.sql`](supabase/migrations/001_init.sql), copie todo o conteúdo, cole no editor e clique em **Run**.
   - O script é idempotente: pode rodar de novo sem quebrar nada.
   - Ele cria as tabelas, índices, triggers, políticas de RLS, publica as tabelas no Realtime e cria as funções `move_card`, `reorder_positions`, `patch_card_values`, `strip_field_values` e `remove_field_option`.
4. Rode, na ordem, os outros scripts da pasta `supabase/migrations/` do mesmo jeito (copiar, colar, **Run**). Todos são idempotentes:
   - [`002_access_allowlist.sql`](supabase/migrations/002_access_allowlist.sql) — cria a coluna `profiles.allowed` e troca as políticas de RLS para "só quem está liberado acessa". Útil quando o projeto Supabase é compartilhado com outros sistemas. Edite a lista de e-mails no fim do arquivo antes de rodar.
   - [`003_field_icon_status.sql`](supabase/migrations/003_field_icon_status.sql) — ícone por campo e status vinculado ao campo (colunas em `fields` + funções `remove_field_status_option` e `strip_field_values` atualizada).
5. Confirme em **Database → Replication** (ou **Realtime**) que as tabelas `cards`, `columns`, `fields`, `tags`, `card_tags` e `boards` estão publicadas em `supabase_realtime`. O script já faz isso; só confira se o Realtime está habilitado no projeto.

## 2. Criar os usuários e desabilitar o cadastro público

O app não tem tela de cadastro. Os usuários são criados manualmente:

1. **Authentication → Users → Add user → Create new user**.
2. Preencha **e-mail** e **senha** e marque **Auto Confirm User** (senão a pessoa precisaria confirmar por e-mail).
3. Em **User Metadata**, informe o nome que vai aparecer no CRM:
   ```json
   { "name": "Luis" }
   ```
   Se não informar, o nome vira a parte do e-mail antes do `@`. Um trigger cria automaticamente a linha em `profiles` com esse nome e uma cor de avatar aleatória.
4. Repita para a segunda pessoa.
5. Se rodou a migração 002, libere o acesso de cada conta (quem não estiver liberado vê a tela "Acesso não liberado" ao entrar):
   ```sql
   update public.profiles set allowed = true
    where id = (select id from auth.users where email = 'email@exemplo.com');
   ```

Para impedir que alguém crie conta por fora:

- **Authentication → Providers → Email**: desligue **Allow new users to sign up** (ou, em versões mais novas do painel, **Authentication → Sign In / Up → Allow new users to sign up**).
- Opcional: em **Authentication → URL Configuration**, coloque a URL onde o CRM vai ficar em **Site URL** e em **Redirect URLs**. Isso é necessário para o link de "Esqueci a senha" voltar para o app.

Para trocar o nome de alguém depois, edite `name` em **User Metadata** e também a coluna `name` na tabela `profiles` (Table Editor), ou só a tabela `profiles` — é ela que o app lê.

## 3. Preencher `js/config.js`

1. Copie `js/config.example.js` para `js/config.js`.
2. Em **Project Settings → API** (ou **Settings → Data API**), copie **Project URL** e a chave **anon / public** e cole:
   ```js
   export const SUPABASE_URL = 'https://xxxxxxxxxxxx.supabase.co';
   export const SUPABASE_ANON_KEY = 'eyJhbGciOi...';
   ```
3. `js/config.js` está no `.gitignore` e não sobe para o GitHub. A anon key é pública por natureza; quem protege os dados é o RLS (só usuários logados acessam).

## 4. Rodar localmente

Precisa ser servido por HTTP (módulos ES não funcionam abrindo o arquivo direto). Qualquer servidor estático serve:

```bash
npx serve .
```

e abra o endereço mostrado (normalmente `http://localhost:3000`). Alternativas: extensão **Live Server** do VS Code, `python -m http.server 8080`, etc.

## 5. Publicar como site estático (EasyPanel / VPS)

O projeto é só arquivos estáticos; não tem build.

**EasyPanel**

1. Suba o repositório no GitHub (sem o `js/config.js`).
2. No EasyPanel, crie um **App** apontando para o repositório, tipo **Static** (ou use a imagem `nginx:alpine` servindo a pasta do projeto).
3. Como `js/config.js` não está no Git, crie o arquivo no servidor de um destes jeitos:
   - **Mount / arquivo**: adicione um *file mount* em `/usr/share/nginx/html/js/config.js` (ou o caminho equivalente da sua imagem) com o conteúdo do config; ou
   - **Build command**: `printf "export const SUPABASE_URL='%s';\nexport const SUPABASE_ANON_KEY='%s';\n" "$SUPABASE_URL" "$SUPABASE_ANON_KEY" > js/config.js`, definindo as duas variáveis de ambiente no painel.
4. Aponte o domínio e ative HTTPS.

**Nginx manual (VPS)**

```nginx
server {
  listen 80;
  server_name crm.seudominio.com;
  root /var/www/lumix-crm;
  index index.html;
  location / { try_files $uri $uri/ /index.html; }
}
```

Copie os arquivos para `/var/www/lumix-crm`, crie o `js/config.js` lá e recarregue o Nginx. Depois, adicione a URL final em **Authentication → URL Configuration** no Supabase.

## 6. Estrutura do banco (resumo)

| Tabela | O que guarda |
|---|---|
| `profiles` | Nome e cor do avatar de cada usuário (1:1 com `auth.users`, criado por trigger) |
| `boards` | Boards (nome, cor, ícone, ordem) |
| `columns` | Colunas/status de cada board (nome, cor, ordem, limite WIP) |
| `fields` | Campos personalizados por board (nome, tipo, opções, ordem, mostrar no card, obrigatório) |
| `tags` | Tags por board (nome, cor) |
| `cards` | Cards: título, descrição, coluna, posição, `values` (jsonb), arquivado |
| `card_tags` | Vínculo card ↔ tag |
| `card_activity` | Histórico: `created`, `moved`, `updated`, `comment`, `archived`, `restored` |

**`cards.values`** é um jsonb `{ "<field_id>": valor }`. O formato do valor depende do tipo do campo:

| Tipo | Valor guardado |
|---|---|
| `select` | `id` da opção (string) |
| `multiselect` | array de ids de opção |
| `date` | `"YYYY-MM-DD"` |
| `checkbox` | `true` (ausente = não marcado) |
| `number` / `currency` | number |
| demais | string |

**Funções RPC**

- `move_card(p_card_id, p_new_column_id, p_new_position)` — move e reindexa as posições das colunas de origem e destino numa transação; registra a atividade `moved`.
- `reorder_positions(p_table, p_ids[])` — grava `position = índice` para `boards`, `columns` ou `fields`.
- `patch_card_values(p_card_id, p_patch)` — mescla um patch em `values` no servidor (chaves `null` são removidas).
- `strip_field_values(p_field_id)` / `remove_field_option(p_field_id, p_option_id)` — limpeza de valores ao excluir um campo ou uma opção.

**RLS**: qualquer usuário autenticado pode ler e escrever em tudo (workspace compartilhado). Em `profiles`, cada um só edita o próprio.

## Atalhos

| Tecla | Ação |
|---|---|
| `N` | Novo card no board atual |
| `/` | Foca na busca |
| `Esc` | Fecha modal / painel / menu |

## Estrutura de pastas

```
index.html                   app inteiro (SPA; troca de telas via JS)
css/tokens.css               variáveis de cor, tipografia e espaçamento (temas dark/light)
css/app.css                  estilos dos componentes
js/config.js                 URL + anon key (gitignored)
js/config.example.js         modelo do config
js/supabase.js               client + tradução de erros
js/auth.js                   login, logout, sessão, perfis
js/state.js                  estado em memória + pub/sub
js/boards.js  columns.js  fields.js  tags.js  cards.js   CRUD
js/realtime.js               assinatura das tabelas do board aberto
js/ui/kanban.js              render do board + drag-and-drop
js/ui/cardModal.js           modal do card (autosave, tags, atividade)
js/ui/boardSettings.js       painel Colunas / Campos / Tags / Board
js/ui/fieldEditor.js         popover de criar/editar campo (ícone, opções, status)
js/ui/iconPicker.js          seletor de ícones Lucide com busca
js/ui/sidebar.js  topbar.js  login.js  dialog.js  toast.js  fieldInputs.js  colorPicker.js …
js/main.js                   bootstrap
supabase/migrations/001_init.sql          schema, RLS, funções
supabase/migrations/002_access_allowlist.sql   lista de permitidos (profiles.allowed)
supabase/migrations/003_field_icon_status.sql  ícone por campo + status vinculado
```
