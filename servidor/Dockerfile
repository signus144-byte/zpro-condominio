# Servidor ZPro Condominio (construir desde la carpeta condominio/: docker build -f servidor/Dockerfile .)
FROM node:22-bookworm-slim AS construir
WORKDIR /src
COPY servidor/package.json servidor/package-lock.json servidor/
RUN cd servidor && npm ci
COPY compartido compartido
COPY servidor servidor
RUN cd servidor && npx tsc -p tsconfig.build.json && npm prune --omit=dev

FROM node:22-bookworm-slim
ENV NODE_ENV=production
WORKDIR /app
COPY --from=construir /src/servidor/node_modules ./node_modules
COPY --from=construir /src/servidor/dist ./dist
COPY --from=construir /src/servidor/package.json ./package.json
# Las migraciones SQL viajan junto al código compilado (migrar.ts las busca en ../../db).
COPY servidor/db ./dist/servidor/db
RUN mkdir -p /datos/archivos && chown -R node:node /datos /app
USER node
EXPOSE 3000
HEALTHCHECK --interval=30s --timeout=5s CMD node -e "fetch('http://localhost:3000/salud').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"
CMD ["node", "dist/servidor/src/index.js"]
