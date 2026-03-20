import type { Plugin } from "@opencode-ai/plugin";
import { readFile, writeFile, mkdir } from "node:fs/promises";
import { join, dirname } from "node:path";
import { homedir, platform } from "node:os";
import { execFile } from "node:child_process";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);

type ClaudeCredentials = {
  claudeAiOauth?: {
    accessToken?: string;
    refreshToken?: string;
    expiresAt?: string | number;
    subscriptionType?: string;
  };
};

type OpenCodeAuth = Record<
  string,
  { type: string; key?: string; access?: string; refresh?: string; expires?: number; [k: string]: unknown }
>;

function credentialsPath(): string {
  return join(homedir(), ".claude", ".credentials.json");
}

function authJsonPath(): string {
  const data = process.env.XDG_DATA_HOME || join(homedir(), ".local", "share");
  return join(data, "opencode", "auth.json");
}

async function readJson<T>(p: string): Promise<T | undefined> {
  try {
    return JSON.parse(await readFile(p, "utf-8")) as T;
  } catch {
    return undefined;
  }
}

/** macOS: read from Keychain via `security` CLI */
async function readCredentialsFromKeychain(): Promise<ClaudeCredentials | undefined> {
  try {
    const { stdout } = await execFileAsync("security", [
      "find-generic-password",
      "-s",
      "Claude Code-credentials",
      "-w",
    ]);
    return JSON.parse(stdout.trim()) as ClaudeCredentials;
  } catch {
    return undefined;
  }
}

/** Linux: read from libsecret via `secret-tool` CLI */
async function readCredentialsFromSecretTool(): Promise<ClaudeCredentials | undefined> {
  try {
    const { stdout } = await execFileAsync("secret-tool", [
      "lookup",
      "service",
      "Claude Code-credentials",
    ], { timeout: 5_000 });
    if (!stdout.trim()) return undefined;
    return JSON.parse(stdout.trim()) as ClaudeCredentials;
  } catch {
    return undefined;
  }
}

async function readCredentials(): Promise<ClaudeCredentials | undefined> {
  if (platform() === "darwin") {
    // macOS: prefer Keychain, fall back to credentials file
    const keychainCreds = await readCredentialsFromKeychain();
    if (keychainCreds) return keychainCreds;
  } else if (platform() === "linux") {
    // Linux: prefer libsecret (secret-tool), fall back to credentials file
    const secretToolCreds = await readCredentialsFromSecretTool();
    if (secretToolCreds) return secretToolCreds;
  }
  return readJson<ClaudeCredentials>(credentialsPath());
}

async function hasClaude(): Promise<boolean> {
  try {
    await execFileAsync("which", ["claude"]);
    return true;
  } catch {
    return false;
  }
}

async function refreshViaCli(): Promise<void> {
  try {
    await execFileAsync(
      "claude",
      ["-p", ".", "--model", "claude-haiku-4-5-20250514"],
      { timeout: 60_000, env: { ...process.env, TERM: "dumb" } },
    );
  } catch {}
}

/** Ensure parent directory of a path exists */
async function ensureDir(filePath: string): Promise<void> {
  await mkdir(dirname(filePath), { recursive: true });
}

const REFRESH_THRESHOLD_MS = 30 * 60 * 1000;

const plugin: Plugin = async () => {
  const cli = await hasClaude();

  if (!cli) {
    return {};
  }

  let cachedToken: string | undefined;
  let cachedExpiresAt: number | undefined;
  let syncPromise: Promise<void> | null = null;

  async function doSync(): Promise<void> {
    const creds = await readCredentials();
    let access = creds?.claudeAiOauth?.accessToken;
    let exp = creds?.claudeAiOauth?.expiresAt;

    if (!access) {
      // No credentials found at all — try a CLI refresh to trigger login/token renewal
      await refreshViaCli();
      const fresh = await readCredentials();
      access = fresh?.claudeAiOauth?.accessToken;
      exp = fresh?.claudeAiOauth?.expiresAt;
      if (!access) return;
    }

    const remaining = exp ? Number(exp) - Date.now() : Infinity;

    if (remaining < 5 * 60 * 1000) {
      await refreshViaCli();
      const fresh = await readCredentials();
      if (fresh?.claudeAiOauth?.accessToken) {
        access = fresh.claudeAiOauth.accessToken;
        exp = fresh.claudeAiOauth.expiresAt;
      }
    }

    cachedToken = access;
    cachedExpiresAt = exp ? Number(exp) : undefined;

    try {
      const authPath = authJsonPath();
      await ensureDir(authPath);
      const auth = (await readJson<OpenCodeAuth>(authPath)) ?? {};
      const refreshToken = creds?.claudeAiOauth?.refreshToken;
      if (auth.anthropic?.access !== cachedToken) {
        auth.anthropic = {
          ...(auth.anthropic ?? {}),
          type: "oauth",
          access: cachedToken!,
          ...(refreshToken ? { refresh: refreshToken } : {}),
          ...(cachedExpiresAt ? { expires: cachedExpiresAt } : {}),
        };
        await writeFile(authPath, JSON.stringify(auth, null, 2), "utf-8");
      }
    } catch {}
  }

  function ensureSync(): Promise<void> {
    if (!syncPromise) {
      syncPromise = doSync().finally(() => {
        syncPromise = null;
      });
    }
    return syncPromise;
  }

  // Eagerly sync on plugin load so auth.json is populated before
  // OpenCode tries to read it (don't wait only for session.created)
  try {
    await doSync();
  } catch {}

  return {
    config: async (config: any): Promise<void> => {
      const providers = config.provider ?? {};
      if (!providers.anthropic) {
        providers.anthropic = { options: { apiKey: "cli-managed" } };
        config.provider = providers;
      }
    },

    "session.created": async (): Promise<void> => {
      try {
        await ensureSync();
      } catch {}
    },

    "chat.headers": async (input: any, output: any): Promise<void> => {
      try {
        if (input?.model?.providerID !== "anthropic") return;

        const now = Date.now();

        if (cachedToken && cachedExpiresAt && cachedExpiresAt > now) {
          output.headers["x-api-key"] = cachedToken;
          if (cachedExpiresAt - now < REFRESH_THRESHOLD_MS && !syncPromise) {
            ensureSync();
          }
          return;
        }

        // Token missing or expired — always try to re-sync
        await ensureSync();
        if (cachedToken) {
          output.headers["x-api-key"] = cachedToken;
        }
      } catch {}
    },
  };
};

export default plugin;
