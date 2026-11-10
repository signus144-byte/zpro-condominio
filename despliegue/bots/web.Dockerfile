# App web (la misma de las APK) y consola de Technical Digital TD, ya compiladas. Caddy solo las sirve (sin HTTPS:
# eso lo hace el Caddy de Alabanza delante).
FROM caddy:2-alpine
COPY web/app /srv/app
COPY web/consola /srv/consola
COPY Caddyfile.web /etc/caddy/Caddyfile
RUN chmod -R a+rX /srv
