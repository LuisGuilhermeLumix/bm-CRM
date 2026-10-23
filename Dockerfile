# Lumix BM — site estático servido pelo Nginx.
# O js/config.js não vai pro Git; ele é gerado na inicialização do container
# a partir das variáveis de ambiente SUPABASE_URL e SUPABASE_ANON_KEY.
FROM nginx:1.27-alpine

COPY nginx.conf /etc/nginx/conf.d/default.conf
COPY docker-entrypoint.sh /docker-entrypoint.d/40-config-js.sh
RUN chmod +x /docker-entrypoint.d/40-config-js.sh

WORKDIR /usr/share/nginx/html
# Copia o projeto inteiro; o que não deve ir (git, node_modules, migrations,
# docs, config.js) está listado no .dockerignore. Assim pastas novas como
# assets/ entram sem precisar editar este arquivo.
COPY . .
RUN rm -f Dockerfile nginx.conf docker-entrypoint.sh .dockerignore .gitattributes .gitignore package.json package-lock.json CLAUDE.md

EXPOSE 80
