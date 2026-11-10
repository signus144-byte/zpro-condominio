# Servidor Vecinos ZPro ya compilado (dist/ viene armado en el paquete): en el VPS solo se instalan las dependencias
# de producción (binarios ya hechos de argon2 y sharp), sin compilar nada pesado al lado de los bots.
FROM node:22-bookworm-slim
ENV NODE_ENV=production
WORKDIR /app
COPY servidor/package.json servidor/package-lock.json ./
RUN npm ci --omit=dev --no-audit --no-fund && npm cache clean --force
COPY servidor/dist ./dist
RUN mkdir -p /datos/archivos && chmod -R a+rX /app && chown -R node:node /datos
USER node
EXPOSE 3000
HEALTHCHECK --interval=60s --timeout=5s --start-period=60s CMD node -e "fetch('http://localhost:3000/salud').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"
CMD ["node", "dist/servidor/src/index.js"]
