# Development Setup

Setting up local development is a bit tedious as you need to run several
services. While the production app will be run either with Kubernetes or
with Docker swarm, developing locally involves easily modifying any of
the components.

The development environment tries to mimic production as much as possible.
This is achieved using split DNS, a stub DNS server and a self generated
certificate authority. The used extension for local servers will be: _.lab_

In order to setup various parts the tool [just](https://github.com/casey/just) was used. 
Most directories contain a _justfile_ that contains the command to set up that part of the
system.

