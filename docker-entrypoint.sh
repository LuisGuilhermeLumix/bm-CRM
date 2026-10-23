#!/bin/sh
# Gera js/config.js a partir das variáveis de ambiente do container.
# Roda automaticamente antes do Nginx subir (pasta /docker-entrypoint.d).
set -e

if [ -z "$SUPABASE_URL" ] || [ -z "$SUPABASE_ANON_KEY" ]; then
  echo "[lumix-crm] AVISO: SUPABASE_URL e/ou SUPABASE_ANON_KEY não definidas. O app vai abrir sem conexão."
fi

cat > /usr/share/nginx/html/js/config.js <<EOF
// Gerado automaticamente pelo container a partir das variáveis de ambiente.
export const SUPABASE_URL = '${SUPABASE_URL:-https://SEU-PROJETO.supabase.co}';
export const SUPABASE_ANON_KEY = '${SUPABASE_ANON_KEY:-SUA_ANON_KEY}';
EOF

echo "[lumix-crm] js/config.js gerado."
