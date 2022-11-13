FROM rust:slim AS builder
WORKDIR /usr/src/myapp
COPY . .
WORKDIR /usr/src/myapp/hyper-organizator
RUN cargo install --path .

FROM debian:buster-slim
COPY --from=builder /usr/local/cargo/bin/hyper-organizator /usr/local/bin/hyper-organizator
MAINTAINER Ovidiu Ionescu <ovidiu@ionescu.net>

#ENTRYPOINT ["/usr/local/bin/hyper-organizator"]
EXPOSE 8080/tcp 8081/tcp

CMD ["hyper-organizator"]

