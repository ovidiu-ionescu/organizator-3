FROM rust:slim AS builder
WORKDIR /usr/src/myapp
# maybe use --link
COPY . .
WORKDIR /usr/src/myapp/organizator-3
LABEL stage="builder"
RUN cargo build --release

### Identity
FROM debian:bullseye-slim
COPY --from=builder /usr/src/myapp/target/release/identity /usr/local/bin/identity
MAINTAINER Ovidiu Ionescu <ovidiu@ionescu.net>
LABEL maintainer="Ovidiu Ionescu <ovidiu@ionescu.net>" \
  version="0.1.0" \
  tag="identity:v0.1.0" \
  description="Identity service for the Organizator project" \
  repository="https://github.com/ovidiu-ionescu/organizator-3" \
  name="identity"\
  app="identity"

#ENTRYPOINT ["/usr/local/bin/hyper-organizator"]
EXPOSE 8080/tcp 8081/tcp

CMD ["identity"]

### Memo
FROM debian:bullseye-slim
COPY --from=builder /usr/src/myapp/target/release/hyper-organizator /usr/local/bin/hyper-organizator
MAINTAINER Ovidiu Ionescu <ovidiu@ionescu.net>
LABEL maintainer="Ovidiu Ionescu <ovidiu@ionescu.net>" \
  version="0.1.0" \
  tag="hyper-organizator:v0.1.0" \
  description="Memo service for the Organizator project" \
  repository="https://github.com/ovidiu-ionescu/organizator-3" \
  name="hyper-organizator"\
  app="hyper-organizator"

#ENTRYPOINT ["/usr/local/bin/hyper-organizator"]
EXPOSE 8080/tcp 8081/tcp

CMD ["hyper-organizator"]

