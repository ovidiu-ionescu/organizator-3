# Security

Security is implemented at different levels.

Authentication is done either using JWT tokens obtained from the identity service or using a client certificate.

Nginx handles the client certificate authentication and sets a couple of headers if it is successful.
This is standard Nginx configuration and is not specific to this project.

In case of successful client certificate authentication, the following headers are set:
- `X-SSL-Client-Verify: SUCCESS`
- `X-SSL-Client-S-DN: CN=${USERNAME}`

In case the request contains a cookie with a JWT token, Nginx will copy the jwt cookie 
to the `Authorization` header prefixed with `Bearer `.

```
Authorization: Bearer <jwt token>
```
