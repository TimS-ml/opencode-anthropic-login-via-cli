# opencode-anthropic-login-via-cli

Use Anthropic models in [OpenCode](https://github.com/sst/opencode) with your **Claude Pro/Max subscription** — no API key needed.

Just log into Claude CLI once, and Anthropic models work in OpenCode automatically.

## How it works

```
Claude CLI (OAuth token)  -->  Plugin  -->  OpenCode
     macOS Keychain                     x-api-key header
     or ~/.claude/.credentials.json     + auth.json sync
```

- Reads your Claude CLI OAuth token on startup
- On **macOS**: reads from the system Keychain (`Claude Code-credentials`)
- On **Linux**: reads from `~/.claude/.credentials.json`
- Injects the token into every Anthropic API call
- Auto-refreshes when the token is about to expire
- Syncs credentials to `~/.local/share/opencode/auth.json`

## Prerequisites

- [OpenCode](https://github.com/sst/opencode)
- [Claude CLI](https://github.com/anthropics/claude-code) logged in (`claude auth status`)
- Claude Pro or Max subscription

## Install

This package is not published to npm.

Build it locally, then link the built plugin into OpenCode's global plugin directory:

```bash
bun install
bun run build
mkdir -p ~/.config/opencode/plugins
ln -sf "$(pwd)/dist/index.js" ~/.config/opencode/plugins/opencode-anthropic-login-via-cli.js
```

OpenCode loads files from `~/.config/opencode/plugins/` automatically on startup. Do not add this package name to `opencode.json`.

That's it. No API key, no provider config needed.

## License

MIT
