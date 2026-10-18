/**
 * GET /staff: the page staff open (team password) to see who played and to download the data.
 * Rendered on request from the D1 rows, 8-bit styled like the login page, inline CSS only, no
 * scripts, nothing cached. Names and email addresses appear here only because the caller is
 * logged in; the same Content-Security-Policy and X-Robots-Tag as the login page apply.
 */
import { escapeHtml } from "./gate.mjs"
import { formatScore, formatTime } from "./markdown.mjs"

function plural(count, word) {
  return `${count} ${word}${count === 1 ? "" : "s"}`
}

/** "3 players · 5 games · updated 2026-10-17 18:30 UTC" */
export function countLine({ players, attempts, now }) {
  return `${plural(players, "player")} · ${plural(attempts, "game")} · updated ${formatTime(new Date(now).toISOString())} UTC`
}

function row(player) {
  return `<tr><td class="n">${player.rank}</td><td>${escapeHtml(player.name)}</td><td class="mail">${escapeHtml(player.email)}</td><td class="n">${player.attempts}</td><td class="n">${escapeHtml(formatScore(player.best))}</td><td class="n">${escapeHtml(formatScore(player.latest))}</td><td class="t">${escapeHtml(formatTime(player.lastPlayedAt))}</td></tr>`
}

/**
 * @param {object} options
 * @param {Array} options.players   aggregatePlayers() output (with emails), already ranked
 * @param {number} options.attempts total games on file
 * @param {Date|number|string} options.now
 * @param {boolean} [options.gate]  whether the team password is on (shows the log-out link)
 */
export function staffPage({ players, attempts, now, gate = true }) {
  const rows = players.map(row).join("\n          ")
  const empty = players.length ? "" : `<p class="empty">No games yet. The first finished game, on any laptop or browser, shows up here.</p>`
  return `<!DOCTYPE html>
<html lang="en-GB">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <meta name="robots" content="noindex, nofollow" />
    <title>Token Quest — staff</title>
    <style>
      :root { color-scheme: dark; }
      * { box-sizing: border-box; }
      body { margin: 0; min-height: 100vh; padding: 24px 16px 40px; background: #0b0b17; color: #f8d038; font-family: "Press Start 2P", ui-monospace, Menlo, Consolas, "Courier New", monospace; letter-spacing: 0.04em; }
      main { max-width: 1100px; margin: 0 auto; padding: 24px 22px 22px; background: #15152a; border: 4px solid #f8d038; box-shadow: 8px 8px 0 #000, inset 0 0 0 4px #0b0b17; }
      h1 { margin: 0 0 10px; font-size: 20px; line-height: 1.4; text-transform: uppercase; text-shadow: 3px 3px 0 #000; }
      h1 span { color: #fff; }
      .count { margin: 0 0 18px; font-size: 11px; line-height: 1.8; color: #9fd0ff; text-transform: uppercase; }
      .buttons { display: flex; flex-wrap: wrap; gap: 12px; margin: 0 0 22px; }
      .button { display: inline-block; padding: 12px 16px; font: inherit; font-size: 11px; text-transform: uppercase; text-decoration: none; color: #0b0b17; background: #f8d038; border: 0; box-shadow: 4px 4px 0 #000; }
      .button:hover { background: #fff; }
      .button:active { transform: translate(4px, 4px); box-shadow: none; }
      .button.quiet { color: #f8d038; background: #0b0b17; border: 2px solid #f8d038; }
      table { width: 100%; border-collapse: collapse; font-size: 10px; line-height: 1.6; }
      th, td { padding: 8px 8px; border-bottom: 2px solid #0b0b17; text-align: left; vertical-align: top; }
      th { color: #9fd0ff; text-transform: uppercase; font-weight: 400; }
      td { color: #fff; }
      td.mail { color: #9fd0ff; text-transform: none; word-break: break-all; }
      td.n, th.n { text-align: right; font-variant-numeric: tabular-nums; }
      td.t { white-space: nowrap; }
      tr:nth-child(even) td { background: #11112200; }
      .empty { font-size: 11px; line-height: 1.8; color: #9fd0ff; }
      .fine { margin: 22px 0 0; font-size: 9px; line-height: 1.9; color: #6f7a9c; }
      .fine a { color: #9fd0ff; }
      .fine code { font: inherit; color: #f8d038; }
    </style>
  </head>
  <body>
    <main>
      <h1>Token <span>Quest</span> · staff</h1>
      <p class="count">${escapeHtml(countLine({ players: players.length, attempts, now }))}</p>
      <p class="buttons">
        <a class="button" href="/api/export.csv" download>Download CSV</a>
        <a class="button" href="/api/export.md" download="PLAYERS.md">Download PLAYERS.md</a>
        <a class="button quiet" href="/api/players.json">players.json</a>
        <a class="button quiet" href="/">Play</a>
      </p>
      ${empty}<table>
        <thead>
          <tr><th class="n">#</th><th>Name</th><th>Email</th><th class="n">Attempts</th><th class="n">Best</th><th class="n">Latest</th><th>Last played (UTC)</th></tr>
        </thead>
        <tbody>
          ${rows}
        </tbody>
      </table>
      <p class="fine">Every finished game from every laptop and browser is in this one database (Cloudflare D1, table <code>attempts</code>); the CSV opens in Excel. Nothing can be deleted from here: to clear the table after the event see HOSTING.md, “Scores database (D1)”.${gate ? ' · <a href="/logout">log out</a>' : ""}</p>
    </main>
  </body>
</html>
`
}
