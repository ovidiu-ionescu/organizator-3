# lib-hyper-organizator
A set of utilities to simplify creating web services using hyper

On crates.io: https://crates.io/crates/lib-hyper-organizator

The layers in the request processing:

1. generate numbered request id header
2. prometheus metrics
3. sensitive request layer (prevent logging authorization)
4. trace layer with spans
5. compression layer
6. propagate headers from request to response (request id)
7. swagger layer
8. authorisation layer
9. database layer

There are two ports used, one for external requests and one for metrics

