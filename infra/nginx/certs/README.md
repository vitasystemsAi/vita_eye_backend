# TLS certificates (not committed)

Nginx expects two PEM files here, mounted read-only into the container:

| File            | Contents                                   |
|-----------------|--------------------------------------------|
| `fullchain.pem` | Server certificate followed by the chain   |
| `privkey.pem`   | Private key (keep permissions at `600`)    |

Production: issue a certificate for `NGINX_SERVER_NAME` from your CA or Let's Encrypt
(the HTTP server block already serves `/.well-known/acme-challenge/` from `/var/www/certbot`).

Staging / evaluation only, a self-signed certificate:

```bash
docker run --rm -v "$PWD/infra/nginx/certs:/certs" alpine/openssl req -x509 -nodes -newkey rsa:2048 \
  -days 30 -subj "/CN=localhost" -keyout /certs/privkey.pem -out /certs/fullchain.pem
```

Browsers only grant webcam access (Live Monitoring) on HTTPS or `localhost`.
