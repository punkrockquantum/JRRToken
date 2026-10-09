#!/bin/sh
# Prints what to do to publish the static demo on GitHub Pages. Deliberately runs no git or gh
# command: pushing and enabling Pages are decisions for a person, so this is instructions only.
set -eu
cd "$(dirname "$0")/.."

REMOTE="$(git remote get-url origin 2>/dev/null || echo 'https://github.com/<owner>/<repo>.git')"
SLUG="$(printf '%s' "$REMOTE" | sed -E 's#\.git$##; s#/$##; s#^.*[:/]([^/]+)/([^/]+)$#\1/\2#')"
OWNER="${SLUG%%/*}"
REPO="${SLUG##*/}"
BRANCH="$(git branch --show-current 2>/dev/null || echo '<branch>')"

cat <<EOF
GitHub Pages: static demo of Token Quest (no server, no /api; scores stay in each browser)

The workflow .github/workflows/pages.yml builds dist/ and deploys it with actions/deploy-pages.
It runs on every push to main and from the Actions tab once it is on main.

1. Build locally first to be sure it is green:
     BASE_PATH=/$REPO npm run build:static && BASE_PATH=/$REPO npm run serve:static
     (open http://127.0.0.1:8099/$REPO/ then Ctrl+C)

2. Get the workflow onto main:
     push your branch ($BRANCH) and merge it, or
     push main directly if you are already on it.

3. One-time repo setting (owner/admin):
     https://github.com/$SLUG/settings/pages  ->  Build and deployment  ->  Source: "GitHub Actions"
   Private repos need GitHub Pro/Team for Pages; public repos get it free. The site itself is always public.

4. Run it:
     automatic on the next push to main, or
     https://github.com/$SLUG/actions/workflows/pages.yml  ->  Run workflow
     (gh CLI, once logged in: gh workflow run pages.yml --ref main && gh run watch)

5. Play:
     https://$OWNER.github.io/$REPO/
   GitHub caches files for about 10 minutes (Cache-Control: max-age=600); hard-refresh after a deploy.

Nothing is collected server-side on this path. Staff can still export the browser's own league as
JSON/CSV from the staff panel on the kiosk that played the games.
EOF
