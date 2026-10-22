# Running the Mini App inside Telegram

The Mini App must be served over **HTTPS** and be reachable from your phone, so use a tunnel in development:

```bash
ngrok http 5173   # or: cloudflared tunnel --url http://localhost:5173
```

Then set `WEBAPP_URL` (bot) and `VITE_API_URL` (web) to the tunnel URL(s) and restart `pnpm dev`. See
[`apps/web/README.md`](../apps/web/README.md) for the API URL details.

The board also works in a normal browser: sign in with the Telegram Login Widget, which needs `VITE_BOT_USERNAME` and
`/setdomain` in BotFather (see [Configuration](configuration.md#botfather-setup)).

## Launch-point cheat sheet (learned the hard way)

| Where | Button type | Requirement |
|-------|-------------|-------------|
| **Private chat** (DM with the bot) | `web_app` inline button / chat menu button | HTTPS URL only. Works without BotFather setup |
| **Group** (task card) | `url` button → `t.me/<bot>?startapp=…` | Needs a **Main Mini App** configured in BotFather |

- `web_app` inline buttons are **private-chat only**. Using one in a group returns `BUTTON_TYPE_INVALID`.
- A `t.me/<bot>?startapp=` button is rejected until the bot has a Main Mini App. The bot detects this via
  `getMe().has_main_web_app` and only shows the group "Open in App" button when it is configured.
- **To enable the group button:** @BotFather → `/mybots` → your bot → **Bot Settings → Configure Mini App** → set the
  URL to your HTTPS `WEBAPP_URL`, then restart the bot.
- **ngrok free** shows a browser interstitial. XHR calls bypass it via the `ngrok-skip-browser-warning` header, but the
  top-level page load may show "Visit Site". `cloudflared` has no interstitial.
