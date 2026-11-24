# Online Image to Base64 Encoder
This little tool encodes your images to base64 so you can embed them easily in HTML images.   
Try it out at https://img2base64.swimburger.net/

The site is hosted with Cloudflare Workers Static Assets in Niels's personal
Cloudflare account. The build publishes an explicit allowlist of public files
instead of serving the repository root.

## Requirements

- [Node.js 26](https://nodejs.org/)
- [pnpm 12](https://pnpm.io/installation)

## Build and test

```bash
pnpm install --frozen-lockfile
pnpm test
```

## Deploy

First use `cf auth whoami` to confirm that the CLI is authenticated to the
intended personal Cloudflare account. Production deployment is an explicit
step and is not performed by CI:

```bash
pnpm run deploy
```
