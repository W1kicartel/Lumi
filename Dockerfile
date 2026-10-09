# Lumi in un contenitore: Node 24, nessuna dipendenza da installare, utente non root, i dati nel volume /dati.
#   docker build -t lumi .  ·  docker run -d --init -p 4380:4380 -v lumi-dati:/dati --name lumi lumi
# Per un VPS con HTTPS vedi docker-compose.yml e docs/INSTALLARE.md.
FROM node:24-slim
ENV NODE_ENV=production LUMI_DATI=/dati LUMI_PORTA=4380 LUMI_RETE=1
WORKDIR /app
COPY --chown=root:root package.json LICENSE ./
COPY --chown=root:root server ./server
COPY --chown=root:root web ./web
COPY --chown=root:root modelli ./modelli
RUN mkdir -p /dati && chown node:node /dati
USER node
VOLUME ["/dati"]
EXPOSE 4380
HEALTHCHECK --interval=30s --timeout=5s --start-period=15s --retries=3 \
  CMD ["node", "-e", "fetch('http://127.0.0.1:'+(process.env.LUMI_PORTA||4380)+'/api/stato').then(r=>process.exit(r.ok?0:1),()=>process.exit(1))"]
STOPSIGNAL SIGTERM
CMD ["node", "server/avvia.js"]
