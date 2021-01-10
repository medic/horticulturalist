FROM alpine:3.12.3

RUN apk add --update --no-cache \
  build-base \
  nodejs-current \
  curl \
  npm \
  bash \
  libxslt \
  jq

WORKDIR /app

COPY . ./horticulturalist

RUN cd horticulturalist && npm ci --verbose

ENTRYPOINT ["/bin/bash", "/app/horticulturalist/bin/docker-entrypoint.sh"]