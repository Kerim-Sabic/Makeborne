FROM node:24-bookworm-slim@sha256:d6aa754f16b3197301076f047b5def2f02ea1dbbc2ca920407d46d7ec7f87b20
WORKDIR /opt/makeborne
COPY toolchain/package.json toolchain/package-lock.json ./
RUN npm ci --ignore-scripts --no-audit --no-fund && npm cache clean --force
COPY build.mjs identity.mjs watchdog.mjs ./
USER node
ENTRYPOINT ["node", "/opt/makeborne/watchdog.mjs"]
