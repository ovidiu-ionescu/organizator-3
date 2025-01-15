# DNS

In order to use different standalone servers rather than just docker containers, 
the [DNS Stub](https://github.com/ovidiu-ionescu/dns-stub) server is being used to 
associate the domain names with the IP addresses of the servers.

DNS Stub allows adding domain names and their corresponding IP addresses using a 
request of type 25. Type 25 that is no longer in use in the DNS standard. This way, every time a server is 
started, it can be associated with a domain name by just making a request to the
DNS Stub server.

resolvectl is used split the DNS queries between the DNS Stub server and the regular
DNS server. For the development servers, the suffix _.lab_ is used.
So the Postgres server will be _orgdb.lab_.
