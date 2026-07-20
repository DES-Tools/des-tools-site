# DES Tools

Public hub site linking DES install/troubleshooting tools, with login for
per-user preferences (e.g. theme). No customer data is ever stored here.

## Architecture

- **Site** (`index.html`, `assets/`): static, hosted free on GitHub Pages.
- **API** (`worker/`): a single Cloudflare Worker backed by D1, hit only for
  login/register/logout and preference saves — not on every page load, to
  stay comfortably inside Cloudflare's free tier.

## Setup

### 1. GitHub Pages
Repo Settings → Pages → Build and deployment → Source: **GitHub Actions**
(required so submodules like `stream-calculator/` get checked out —
`.github/workflows/pages.yml` handles the build). Public repo required on a
free org (private repo Pages needs a paid plan).

The `CNAME` file pins the custom domain to `tools.mydes.tech`. Point that
subdomain at `des-tools.github.io` via a CNAME record with your DNS
provider, then set it under Settings → Pages → Custom domain so GitHub
provisions HTTPS for it. The `github.io/des-tools-site/` URL keeps working
too — GitHub 301s it to the custom domain automatically.

### 2. Cloudflare Worker + D1
```
cd worker
npx wrangler d1 create des-tools
# copy the returned database_id into wrangler.toml
npx wrangler d1 execute des-tools --file=./schema.sql --remote
npx wrangler secret put RESEND_API_KEY
npx wrangler deploy
```
Set `ALLOWED_ORIGIN` in `wrangler.toml` to the site's custom domain
(`https://tools.mydes.tech`), and update `API` in `assets/app.js` and
`assets/prefs.js` to the deployed Worker URL
(`https://des-tools-auth.<subdomain>.workers.dev`).

### 3. Local dev
```
cd worker && npx wrangler dev
```
Serve `index.html` with any static server and point `API` at
`http://localhost:8787` while testing.

## Adding a tool card
Add a `.tool-card` link in `index.html` pointing at the tool's own GitHub
Pages URL (each tool stays its own repo).
