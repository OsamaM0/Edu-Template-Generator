# ============================================================================
# EduWebTemplateGenerator — one image, whole product
# ----------------------------------------------------------------------------
# The project has no build step and no npm dependencies, so the image is just
# Node + the source tree. Same server serves the static site and the render API.
#
#   docker build -t edu-templates .
#   docker run -p 8138:8138 edu-templates
# ============================================================================
FROM node:22-alpine

# Small init so Ctrl-C / docker stop reaches Node instead of PID 1 ignoring it.
RUN apk add --no-cache tini

ENV NODE_ENV=production \
    EDU_HOST=0.0.0.0 \
    PORT=8138

WORKDIR /app

# No dependencies to install — package.json is copied first anyway so the layer
# stays cached if one is ever added.
COPY package.json ./

COPY config.js index.html embed.html ./
COPY assets/ ./assets/
COPY data/ ./data/
COPY server/ ./server/
COPY tools/ ./tools/
COPY examples/ ./examples/

# The three directories the server WRITES to, created here and owned by the
# runtime user. compose mounts a named volume over each; Docker gives a fresh
# volume the ownership of the path it covers, so without this they would arrive
# root-owned and every write from the unprivileged user below would fail.
RUN mkdir -p data/cache data/assignments data/output \
 && chown -R node:node data

# node:* images ship an unprivileged "node" user; nothing here needs root.
USER node

EXPOSE 8138

HEALTHCHECK --interval=30s --timeout=3s --start-period=5s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:'+(process.env.PORT||8138)+'/api/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"

ENTRYPOINT ["/sbin/tini", "--"]
CMD ["node", "server/server.mjs"]
