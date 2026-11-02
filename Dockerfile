ARG APP_VERSION=dev
ARG VCS_REF=unknown
ARG VCS_URL=https://github.com/marcelb/turtle-sketch

FROM node:22-alpine AS build
WORKDIR /app
COPY package*.json ./
RUN --mount=type=cache,target=/root/.npm npm ci
COPY client ./client
COPY server ./server
RUN npm run build

FROM node:22-alpine AS runtime
ARG APP_VERSION
ARG VCS_REF
ARG VCS_URL
LABEL org.opencontainers.image.title="turtle-sketch" \
      org.opencontainers.image.description="Collaborative whiteboard" \
      org.opencontainers.image.version="${APP_VERSION}" \
      org.opencontainers.image.revision="${VCS_REF}" \
      org.opencontainers.image.source="${VCS_URL}"
ENV NODE_ENV=production
WORKDIR /app
RUN addgroup -S app && adduser -S app -G app && mkdir -p /data && chown app:app /data
COPY --chown=app:app package*.json ./
RUN --mount=type=cache,target=/root/.npm npm ci --omit=dev
COPY --from=build --chown=app:app /app/client/dist ./client/dist
COPY --chown=app:app server ./server
USER app
EXPOSE 3000
VOLUME /data
HEALTHCHECK --interval=30s --timeout=5s --start-period=5s --retries=3 \
  CMD wget -q -O /dev/null http://127.0.0.1:3000/health || exit 1
CMD ["node", "server/index.js"]
