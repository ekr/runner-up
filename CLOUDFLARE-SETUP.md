# Cloudflare Setup

## 1. Create a Cloudflare account

Sign up at https://dash.cloudflare.com/sign-up

## 2. Install Wrangler and log in

```bash
npm install -g wrangler
wrangler login
```

This opens a browser to authorize the CLI.

## 3. Create the R2 bucket

```bash
wrangler r2 bucket create runnerup-gpx
```

## 4. Set production secrets

```bash
# Secret used to compute track IDs (HMAC)
openssl rand -hex 32 | wrangler secret put SHARE_SECRET

# Secret used to sign auth tokens (JWT)
openssl rand -hex 32 | wrangler secret put AUTH_SECRET

# Invite code users need to register
wrangler secret put INVITE_CODE
# (type your chosen code when prompted)
```

## 5. Deploy the worker

```bash
cd worker
npm install
wrangler deploy
```

This deploys to `runnerup-api.<your-account>.workers.dev`.

## 6. Set up a custom domain (optional)

If you want `api.runnerup.win` instead of the `.workers.dev` URL:

1. Add your domain to Cloudflare (Dashboard > Websites > Add a site)
2. Update your domain's nameservers to Cloudflare's (your registrar will have instructions)
3. In Dashboard > Workers & Pages > `runnerup-api` > Settings > Domains & Routes, add `api.runnerup.win`

## 7. Point the frontend at the API

The frontend (`static/storage.js`) uses `https://api.runnerup.win` in production. If using a different domain, update the `API_BASE` in that file.
