FROM node:24-bookworm-slim@sha256:d6aa754f16b3197301076f047b5def2f02ea1dbbc2ca920407d46d7ec7f87b20
WORKDIR /opt/makeborne-publication-controller
COPY package.json package-lock.json ./
# Installation happens while producing the image, never at service startup.
# sharp's platform binaries arrive through locked optional dependencies.
RUN npm ci --omit=dev --ignore-scripts --no-audit --no-fund && npm cache clean --force
COPY controller.cjs build.json ./
ENV NODE_ENV=production
USER node
ENTRYPOINT ["node", "controller.cjs"]
