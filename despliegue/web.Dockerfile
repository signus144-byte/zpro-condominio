# App de residentes + consola master, compiladas y servidas por Caddy.
# Construir desde condominio/: docker build -f despliegue/web.Dockerfile --build-arg VITE_API_URL=http://localhost:3000 .
FROM node:22-bookworm-slim AS construir
ARG VITE_API_URL=http://localhost:3000
ENV VITE_API_URL=$VITE_API_URL
WORKDIR /src
COPY compartido compartido
COPY app/package.json app/package-lock.json app/
RUN cd app && npm ci
COPY consola/package.json consola/package-lock.json consola/
RUN cd consola && npm ci
COPY app app
COPY consola consola
RUN cd app && npx vite build && cd ../consola && npx vite build

FROM caddy:2-alpine
COPY --from=construir /src/app/dist /srv/app
COPY --from=construir /src/consola/dist /srv/consola
COPY despliegue/local/Caddyfile /etc/caddy/Caddyfile
