# Lumix CRM — site estático servido pelo Nginx.
# O js/config.js não vai pro Git; ele é gerado na inicialização do container
# a partir das variáveis de ambiente SUPABASE_URL e SUPABASE_ANON_KEY.
FROM nginx:1.27-alpine

COPY nginx.conf /etc/nginx/conf.d/default.conf
COPY docker-entrypoint.sh /docker-entrypoint.d/40-config-js.sh
RUN chmod +x /docker-entrypoint.d/40-config-js.sh

WORKDIR /usr/share/nginx/html
COPY index.html ./
COPY css ./css
COPY js ./js

EXPOSE 80
