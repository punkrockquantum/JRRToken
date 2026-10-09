#!/bin/sh
# Builds dist/ and publishes the static demo (no server, no /api) with one of the hosting CLIs via npx.
#
#   ./scripts/deploy-static.sh netlify      # npx netlify-cli deploy --prod --dir dist
#   ./scripts/deploy-static.sh vercel       # npx vercel deploy --prod
#   ./scripts/deploy-static.sh cloudflare   # npx wrangler pages deploy dist --project-name <name>
#   ./scripts/deploy-static.sh gh-pages     # prints the GitHub Pages steps (no git commands are run)
#
# Each CLI opens a browser login the first time. Nothing here stores credentials in the repo.
set -eu
cd "$(dirname "$0")/.."

TARGET="${1:-}"
PROJECT="${CF_PAGES_PROJECT:-token-quest}"

case "$TARGET" in
  netlify|vercel|cloudflare|gh-pages) ;;
  *)
    echo "usage: $0 <netlify|vercel|cloudflare|gh-pages>" >&2
    exit 2
    ;;
esac

if [ "$TARGET" = "gh-pages" ]; then
  exec sh scripts/deploy-gh-pages.sh
fi

npm run build:static

case "$TARGET" in
  netlify)
    # First time: `npx netlify-cli login` then `npx netlify-cli init` (or `link`) to pick/create the site.
    exec npx --yes netlify-cli deploy --prod --dir dist
    ;;
  vercel)
    # vercel.json carries the build command, output dir and headers. First time: `npx vercel login`.
    exec npx --yes vercel deploy --prod
    ;;
  cloudflare)
    # First time: `npx wrangler login` then `npx wrangler pages project create "$PROJECT"`.
    exec npx --yes wrangler pages deploy dist --project-name "$PROJECT"
    ;;
esac
