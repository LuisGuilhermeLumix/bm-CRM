// Cliente Supabase + helpers de erro
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.49.4';
import { SUPABASE_URL, SUPABASE_ANON_KEY } from './config.js';

export const isConfigured =
  !!SUPABASE_URL && !!SUPABASE_ANON_KEY &&
  !SUPABASE_URL.includes('SEU-PROJETO') && SUPABASE_ANON_KEY !== 'SUA_ANON_KEY';

export const sb = isConfigured
  ? createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
      auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: true },
      realtime: { params: { eventsPerSecond: 20 } },
    })
  : null;

const MESSAGES = [
  [/Invalid login credentials/i, 'E-mail ou senha incorretos.'],
  [/Email not confirmed/i, 'E-mail ainda não confirmado.'],
  [/Failed to fetch|NetworkError|Load failed/i, 'Sem conexão com o servidor. Verifique sua internet.'],
  [/JWT expired|invalid JWT|refresh_token_not_found/i, 'Sua sessão expirou. Entre novamente.'],
  [/row-level security|permission denied/i, 'Sem permissão para essa ação.'],
  [/violates foreign key constraint "cards_column_id_fkey"/i, 'A coluna ainda tem cards. Mova-os antes de excluir.'],
  [/duplicate key/i, 'Esse registro já existe.'],
  [/Password should be at least/i, 'A senha precisa ter pelo menos 6 caracteres.'],
  [/rate limit|too many requests/i, 'Muitas tentativas. Aguarde um instante.'],
  [/For security purposes/i, 'Por segurança, aguarde alguns segundos antes de tentar de novo.'],
];

/** Traduz um erro do Supabase/rede para uma mensagem legível em português. */
export function friendlyError(err) {
  const raw = (err && (err.message || err.error_description || err.msg)) || String(err || '');
  for (const [re, msg] of MESSAGES) if (re.test(raw)) return msg;
  // Erros levantados pelas nossas funções RPC já vêm em português
  if (/[áéíóúãõç]/i.test(raw) && raw.length < 120) return raw;
  return raw ? `Erro: ${raw}` : 'Algo deu errado. Tente novamente.';
}

export class AppError extends Error {
  constructor(message, cause) {
    super(message);
    this.cause = cause;
  }
}

/**
 * Executa uma query/RPC do supabase-js e lança AppError com mensagem amigável
 * se vier `error`. Uso: const rows = await run(sb.from('boards').select('*'));
 */
export async function run(query) {
  const { data, error } = await query;
  if (error) throw new AppError(friendlyError(error), error);
  return data;
}
