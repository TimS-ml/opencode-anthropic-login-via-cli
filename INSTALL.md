# Installation

## Prerequisites

- [Claude Code CLI](https://docs.anthropic.com/en/docs/claude-code) installed and logged in (`claude auth login`)
- [OpenCode](https://github.com/opencode-ai/opencode) installed
- [Bun](https://bun.sh/) installed
- A local checkout of this repository

## Install from local source

This is the only supported install method for this repo.

Do not use `npm install opencode-anthropic-login-via-cli` and do not add this package name to `opencode.json` - this package is not published to npm.

```bash
# In this repository
bun install
bun run build

# Link the built plugin into OpenCode's global plugin directory
mkdir -p ~/.config/opencode/plugins
ln -sf "$(pwd)/dist/index.js" ~/.config/opencode/plugins/opencode-anthropic-login-via-cli.js
```

OpenCode loads files in `~/.config/opencode/plugins/` automatically on startup, so no `opencode.json` entry is needed.

If you update this repo later, rebuild it:

```bash
bun run build
```

## Linux Setup

On Linux, Claude Code stores OAuth credentials in one of two locations:

1. **`~/.claude/.credentials.json`** (file-based, always works)
2. **libsecret / GNOME Keyring** (if `secret-tool` is available)

The plugin tries both automatically. If you run into issues:

### Ensure Claude Code is logged in

```bash
claude auth login
claude auth status
```

### Option A: File-based credentials (simplest)

If `~/.claude/.credentials.json` exists after login, no extra setup is needed. The plugin reads it directly.

Verify:

```bash
cat ~/.claude/.credentials.json | python3 -c "import sys,json; d=json.load(sys.stdin); print('OK' if d.get('claudeAiOauth',{}).get('accessToken') else 'MISSING')"
```

### Option B: libsecret / secret-tool

If Claude Code stores credentials in the system keyring (GNOME Keyring / KDE Wallet), install `secret-tool`:

```bash
# Debian/Ubuntu
sudo apt install libsecret-tools

# Fedora
sudo dnf install libsecret

# Arch
sudo pacman -S libsecret
```

Verify:

```bash
secret-tool lookup service "Claude Code-credentials"
```

### Manual one-time sync (fallback)

If the plugin still can't read credentials, you can manually sync once:

```bash
# Read token from Claude Code credentials
ACCESS=$(cat ~/.claude/.credentials.json | python3 -c "import sys,json; print(json.load(sys.stdin)['claudeAiOauth']['accessToken'])")
REFRESH=$(cat ~/.claude/.credentials.json | python3 -c "import sys,json; print(json.load(sys.stdin)['claudeAiOauth']['refreshToken'])")
EXPIRES=$(cat ~/.claude/.credentials.json | python3 -c "import sys,json; print(json.load(sys.stdin)['claudeAiOauth']['expiresAt'])")

# Write to OpenCode auth.json
AUTH_DIR="${XDG_DATA_HOME:-$HOME/.local/share}/opencode"
mkdir -p "$AUTH_DIR"
python3 -c "
import json, os
auth_file = '$AUTH_DIR/auth.json'
try:
    with open(auth_file) as f:
        auth = json.load(f)
except:
    auth = {}
auth['anthropic'] = {
    'type': 'oauth',
    'access': '$ACCESS',
    'refresh': '$REFRESH',
    'expires': $EXPIRES
}
with open(auth_file, 'w') as f:
    json.dump(auth, f, indent=2)
print('Synced to', auth_file)
"
```

Note: This is a one-time sync. The token will expire and need to be re-synced. The plugin handles this automatically when it can read the credentials.

## Troubleshooting

| Symptom | Cause | Fix |
|---------|-------|-----|
| Plugin returns `{}` silently | `claude` CLI not found or no credentials | Run `claude auth login` |
| Token works once then expires | Plugin can't read refreshed credentials | Install `libsecret-tools` or check `~/.claude/.credentials.json` is updated |
| `ENOENT` writing auth.json | OpenCode data directory doesn't exist | Fixed in v1.2.0+; or run `mkdir -p ~/.local/share/opencode` |
