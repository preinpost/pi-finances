/**
 * src/secret.ts — cross-platform secret storage for KIS credentials.
 *
 * Backend priority:
 *   1. OS keyring via @napi-rs/keyring — macOS Keychain, Windows Credential
 *      Manager, Linux Secret Service (libsecret) / kernel keyring. No
 *      plaintext files on disk.
 *   2. File fallback — ~/.pi/agent/kis-keys.json / kis-token.json (0600) for
 *      headless environments without a keyring daemon.
 *
 * Env controls:
 *   - KIS_SECRET_STORE=file  → force file mode (headless/containers)
 *   - KIS_SECRET_STORE=keyring → force keyring mode (errors if unavailable)
 *
 * @napi-rs/keyring is a package dependency (native bindings per platform).
 * pi installs deps automatically for npm/git sources; for local-path installs
 * run `npm install` in the package root once.
 */
import { createRequire } from "node:module";
import { existsSync, readFileSync, rmSync } from "node:fs";
import { chmod, mkdir, readFile, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

export interface KisKeys {
	appKey?: string;
	appSecret?: string;
	paperAppKey?: string;
	paperAppSecret?: string;
	htsId?: string;
	acctStock?: string;
	acctFuture?: string;
	paperStock?: string;
	paperFuture?: string;
}

export interface TokenCache {
	real?: { token: string; appKeyHash: string; expiresAt: number };
	paper?: { token: string; appKeyHash: string; expiresAt: number };
}

/** 웹소켓 접속키 캐시 (REST 토큰과 별개 — /oauth2/Approval 발급, 유효 24h). */
export interface ApprovalCache {
	real?: { approvalKey: string; appKeyHash: string; expiresAt: number };
	paper?: { approvalKey: string; appKeyHash: string; expiresAt: number };
}

type SecretBlob = Record<string, unknown> | null;

export interface SecretStore {
	readonly backend: "keyring" | "file";
	getKeys(): KisKeys;
	saveKeys(keys: KisKeys): Promise<void>;
	getTokenCache(): TokenCache;
	saveTokenCache(cache: TokenCache): Promise<void>;
	getApprovalCache(): ApprovalCache;
	saveApprovalCache(cache: ApprovalCache): Promise<void>;
}

interface KeyringEntry {
	getPassword(): string | null;
	setPassword(password: string): void;
	deleteCredential(): boolean;
}

interface KeyringLib {
	Entry: new (service: string, account: string) => KeyringEntry;
}

const agentDir = process.env.PI_CODING_AGENT_DIR ?? join(homedir(), ".pi", "agent");
export const keysPath = process.env.KIS_KEYS_FILE ?? join(agentDir, "kis-keys.json");
export const tokenPath = join(agentDir, "kis-token.json");
export const approvalPath = join(agentDir, "kis-approval.json");

const SERVICE = "pi-kis-trading";

function loadKeyring(): KeyringLib | null {
	if (process.env.KIS_SECRET_STORE === "file") return null;
	try {
		// Resolve from this package's own node_modules (pi loads packages with
		// separate module roots, so createRequire here sees our deps).
		const req = createRequire(import.meta.url);
		const k = req("@napi-rs/keyring") as { Entry?: unknown };
		if (k && typeof k.Entry === "function") return k as KeyringLib;
	} catch {
		/* not installed or native binding missing */
	}
	return null;
}

class KeyringStore implements SecretStore {
	readonly backend = "keyring" as const;
	constructor(private readonly lib: KeyringLib) {}

	private read(account: string): SecretBlob {
		try {
			const raw = new this.lib.Entry(SERVICE, account).getPassword();
			return raw ? (JSON.parse(raw) as SecretBlob) : null;
		} catch {
			return null;
		}
	}

	private write(account: string, data: SecretBlob): void {
		const entry = new this.lib.Entry(SERVICE, account);
		if (data == null) {
			try {
				entry.deleteCredential();
			} catch {
				/* nothing to delete */
			}
			return;
		}
		entry.setPassword(JSON.stringify(data));
	}

	getKeys(): KisKeys {
		return (this.read("keys") as KisKeys | null) ?? {};
	}

	async saveKeys(keys: KisKeys): Promise<void> {
		this.write("keys", keys as unknown as Record<string, unknown>);
	}

	getTokenCache(): TokenCache {
		return (this.read("token") as TokenCache | null) ?? {};
	}

	async saveTokenCache(cache: TokenCache): Promise<void> {
		this.write("token", cache as unknown as Record<string, unknown>);
	}

	getApprovalCache(): ApprovalCache {
		return (this.read("approval") as ApprovalCache | null) ?? {};
	}

	async saveApprovalCache(cache: ApprovalCache): Promise<void> {
		this.write("approval", cache as unknown as Record<string, unknown>);
	}
}

class FileStore implements SecretStore {
	readonly backend = "file" as const;

	private read(path: string): SecretBlob {
		try {
			return JSON.parse(readFileSync(path, "utf8")) as SecretBlob;
		} catch {
			return null;
		}
	}

	private async write(path: string, data: SecretBlob): Promise<void> {
		await mkdir(agentDir, { recursive: true });
		await writeFile(path, JSON.stringify(data ?? {}, null, 2) + "\n", "utf8");
		await chmod(path, 0o600); // same as ~/.pi/agent/auth.json
	}

	getKeys(): KisKeys {
		return (this.read(keysPath) as KisKeys | null) ?? {};
	}

	async saveKeys(keys: KisKeys): Promise<void> {
		await this.write(keysPath, keys as unknown as Record<string, unknown>);
	}

	getTokenCache(): TokenCache {
		return (this.read(tokenPath) as TokenCache | null) ?? {};
	}

	async saveTokenCache(cache: TokenCache): Promise<void> {
		await this.write(tokenPath, cache as unknown as Record<string, unknown>);
	}

	getApprovalCache(): ApprovalCache {
		return (this.read(approvalPath) as ApprovalCache | null) ?? {};
	}

	async saveApprovalCache(cache: ApprovalCache): Promise<void> {
		await this.write(approvalPath, cache as unknown as Record<string, unknown>);
	}
}

function initStore(): SecretStore {
	const forced = process.env.KIS_SECRET_STORE;
	const lib = loadKeyring();
	if (lib) {
		try {
			// Probe the backend — construction/get can throw when no keyring
			// daemon is available (e.g. headless Linux without Secret Service).
			new lib.Entry(SERVICE, "__probe__").getPassword();
			return new KeyringStore(lib);
		} catch {
			if (forced === "keyring") {
				throw new Error("KIS_SECRET_STORE=keyring but OS keyring is unavailable on this machine.");
			}
		}
	}
	if (forced === "keyring") {
		throw new Error("KIS_SECRET_STORE=keyring but @napi-rs/keyring is not installed. Run `npm install` in the package root.");
	}
	return new FileStore();
}

/** Active secret store (singleton). */
export const store: SecretStore = initStore();

function readJson(path: string): SecretBlob {
	try {
		return JSON.parse(readFileSync(path, "utf8")) as SecretBlob;
	} catch {
		return null;
	}
}

/**
 * Move plaintext files (~/.pi/agent/kis-keys.json, kis-token.json) into the
 * OS keyring when it is the active backend, then delete the files. Call once
 * at extension activation. No-op when the file backend is active.
 */
export async function migrateSecretsToKeyring(): Promise<void> {
	if (store.backend !== "keyring") return;
	let changed = false;

	const fileKeys = readJson(keysPath);
	const krKeys = store.getKeys();
	if (fileKeys && Object.keys(fileKeys).length > 0 && !krKeys.appKey) {
		await store.saveKeys(fileKeys as KisKeys);
		changed = true;
	}

	const fileTok = readJson(tokenPath);
	const krTok = store.getTokenCache();
	if (fileTok && Object.keys(fileTok).length > 0 && Object.keys(krTok).length === 0) {
		await store.saveTokenCache(fileTok as TokenCache);
		changed = true;
	}

	if (changed) {
		for (const p of [keysPath, tokenPath]) {
			try {
				rmSync(p, { force: true });
			} catch {
				/* ignore */
			}
		}
	}
}

/** True when the plaintext key/token files still exist (pre-migration). */
export function hasPlaintextFiles(): boolean {
	return existsSync(keysPath) || existsSync(tokenPath);
}
