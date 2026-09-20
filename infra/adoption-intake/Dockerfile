FROM node:24-alpine

WORKDIR /app
COPY handler.mjs sqlite-store.mjs server.mjs ./

RUN addgroup -S adoption && adduser -S -G adoption adoption \
  && mkdir -p /data && chown adoption:adoption /data

USER adoption
ENV ADOPTION_DB_PATH=/data/adoption-intake.sqlite
EXPOSE 8787
CMD ["node", "server.mjs"]
