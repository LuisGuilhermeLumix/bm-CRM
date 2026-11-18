// Edge Function: admin-create-user
// Cria um usuário já liberado no Lumix (Configurações → Usuários → "Adicionar usuário").
// Só um admin do CRM pode chamar: o JWT de quem chamou é conferido com crm_is_admin().
//
// POST { email, password, name, role: 'admin'|'member', access: { sections, boards, operation_types } }
// 200  { id, email }
// 4xx  { error: "mensagem em português" }
//
// Variáveis (já existem no ambiente das Edge Functions): SUPABASE_URL,
// SUPABASE_ANON_KEY, SUPABASE_SERVICE_ROLE_KEY.
import { createClient } from 'npm:@supabase/supabase-js@2.49.4';

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};
const SECTIONS = ['boards', 'dashboard', 'clientes', 'financeiro', 'distribuicao', 'credenciais', 'anotacoes', 'relatorios', 'config'];
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const json = (status: number, body: unknown) =>
  new Response(JSON.stringify(body), { status, headers: { ...CORS, 'Content-Type': 'application/json' } });
const fail = (status: number, error: string) => json(status, { error });

/** Traduz os erros mais comuns do Auth para a tela. */
function friendly(message = ''): string {
  if (/already (been )?registered|already exists|duplicate/i.test(message)) return 'Já existe um usuário com este e-mail.';
  if (/password/i.test(message) && /(short|least|weak|characters)/i.test(message)) return 'A senha é fraca demais. Use pelo menos 8 caracteres.';
  if (/email/i.test(message) && /invalid/i.test(message)) return 'E-mail inválido.';
  return message ? `Não foi possível criar o usuário: ${message}` : 'Não foi possível criar o usuário.';
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS });
  if (req.method !== 'POST') return fail(405, 'Método não permitido.');

  const url = Deno.env.get('SUPABASE_URL');
  const anonKey = Deno.env.get('SUPABASE_ANON_KEY');
  const serviceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');
  if (!url || !anonKey || !serviceKey) return fail(500, 'Função sem configuração do Supabase.');

  // ---- quem está chamando precisa ser admin do CRM
  const authHeader = req.headers.get('Authorization') || '';
  if (!/^Bearer\s+\S+/i.test(authHeader)) return fail(401, 'Faça login de novo.');
  const caller = createClient(url, anonKey, {
    global: { headers: { Authorization: authHeader } },
    auth: { persistSession: false, autoRefreshToken: false },
  });
  const { data: who, error: whoErr } = await caller.auth.getUser();
  if (whoErr || !who?.user) return fail(401, 'Sessão inválida. Faça login de novo.');
  const { data: isAdmin, error: admErr } = await caller.rpc('crm_is_admin');
  if (admErr) return fail(500, 'Não foi possível conferir a permissão (a migration 018 foi aplicada?).');
  if (isAdmin !== true) return fail(403, 'Só administradores podem criar usuários.');

  // ---- dados do formulário
  let body: Record<string, unknown>;
  try { body = await req.json(); } catch { return fail(400, 'Corpo da requisição inválido.'); }
  const email = String(body.email || '').trim().toLowerCase();
  const password = String(body.password || '');
  const name = String(body.name || '').trim();
  const role = body.role === 'admin' ? 'admin' : body.role === 'member' ? 'member' : null;
  const raw = (body.access && typeof body.access === 'object' ? body.access : {}) as Record<string, unknown>;
  const list = (v: unknown) => (Array.isArray(v) ? v.map(String) : []);
  const access = {
    sections: list(raw.sections).filter((s) => SECTIONS.includes(s)),
    boards: list(raw.boards).filter((s) => UUID.test(s)),
    operation_types: list(raw.operation_types).filter((s) => UUID.test(s)),
  };

  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return fail(400, 'Informe um e-mail válido.');
  if (password.length < 8) return fail(400, 'A senha precisa ter pelo menos 8 caracteres.');
  if (!name) return fail(400, 'Informe o nome.');
  if (!role) return fail(400, 'Papel inválido.');

  // ---- cria com a service role
  const admin = createClient(url, serviceKey, { auth: { persistSession: false, autoRefreshToken: false } });
  const { data: created, error: createErr } = await admin.auth.admin.createUser({
    email, password, email_confirm: true, user_metadata: { name },
  });
  if (createErr || !created?.user) return fail(400, friendly(createErr?.message));
  const id = created.user.id;

  // o trigger handle_new_user cria o profile; garante nome e acesso liberado
  const { error: profErr } = await admin.from('profiles').upsert({ id, name, allowed: true, in_crm: true }, { onConflict: 'id' });
  if (profErr) return fail(500, `Usuário criado, mas não deu para liberar o acesso: ${profErr.message}`);

  // papel e permissões: chamado como o admin que pediu (crm_set_access confere isso)
  const { error: accErr } = await caller.rpc('crm_set_access', { p_profile_id: id, p_role: role, p_access: access });
  if (accErr) return fail(500, `Usuário criado, mas as permissões não foram gravadas: ${accErr.message}`);

  return json(200, { id, email });
});
