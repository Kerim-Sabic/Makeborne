FROM node:24-bookworm-slim@sha256:d6aa754f16b3197301076f047b5def2f02ea1dbbc2ca920407d46d7ec7f87b20
ENV NODE_ENV=production PLAYWRIGHT_BROWSERS_PATH=/opt/ms-playwright
WORKDIR /opt/makeborne
COPY package.json package-lock.json ./
RUN npm ci --omit=dev --ignore-scripts --no-audit --no-fund \
    && ./node_modules/.bin/playwright install --with-deps chromium \
    && npm cache clean --force \
    && rm -rf /var/lib/apt/lists/* \
    && chmod -R a+rX /opt/ms-playwright
COPY runtime/ ./
COPY customer-sites/ /opt/customer-sites/
RUN mkdir -p /vercel/sandbox && chown node:node /vercel/sandbox && chmod 0700 /vercel/sandbox
USER node
WORKDIR /tmp
# Sandbox ignores ENTRYPOINT. The controller explicitly runs this same command.
ENTRYPOINT ["node", "/opt/makeborne/vercel-publication-render-watchdog.mjs"]
