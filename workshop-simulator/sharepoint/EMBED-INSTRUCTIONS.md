# Hosting the simulator on SharePoint for a workshop

## 1. Upload (once)

Upload these three files to a document library on your SharePoint site
(Site contents -> Site Assets is the usual place):

- `ai-infra-simulator.aspx`  — the entire app, self-contained
- `ai-infra-simulator.html`  — identical copy (use if your tenant renders .html)
- `workshop-launcher.aspx`   — a landing card with both launch options

After uploading, copy the real URL of each file (select the file ->
Copy link). It will look like:

    https://<tenant>.sharepoint.com/sites/<site>/SiteAssets/ai-infra-simulator.aspx

## 2. Embed in a SharePoint page

Edit your workshop page, add an **Embed** web part, and paste one of these
(replace the path with the URL you copied):

Embed the full simulator directly in the page:

    <iframe src="https://<tenant>.sharepoint.com/sites/<site>/SiteAssets/ai-infra-simulator.aspx"
            width="100%" height="900" frameborder="0"
            title="AI Infrastructure Simulator"></iframe>

Or embed the smaller workshop launcher card:

    <iframe src="https://<tenant>.sharepoint.com/sites/<site>/SiteAssets/workshop-launcher.aspx"
            width="100%" height="520" frameborder="0"
            title="AI Infrastructure Simulator - Workshop launcher"></iframe>

Same-origin iframes (SharePoint page framing a file on the same SharePoint
site) are always allowed, so no admin configuration is needed.

## 3. The localhost link — read before the workshop

The launcher's second button points to `http://localhost:5181`, your local
dev server. Two things to know:

- **It only works on the presenter's machine.** For attendees, localhost is
  their own computer, so give them the hosted (.aspx) link instead.
- **It must be a link, not an iframe.** Browsers block an https SharePoint
  page from *embedding* http://localhost (mixed content), which is why the
  launcher opens it in a new tab.

To have the dev server running on workshop day, start it on your laptop:

    cd ~/ai-infra-simulator
    export PATH="$HOME/.local/node-dist/node-v22.22.0-darwin-arm64/bin:$PATH"
    npm run dev -- --port 5181 --strictPort

The hosted .aspx copy is identical to the dev version at the time it was
built, so the safest workshop plan is: present from the hosted copy, keep
localhost as your editable backup.

## Troubleshooting

- `.html` downloads instead of rendering -> use the `.aspx` copies.
- Blank page inside the Embed web part -> your site may have custom scripts
  disabled (`DenyAddAndCustomizePages`). Ask your SharePoint admin, or host
  the same files on any internal static web server; they have no
  dependencies.
