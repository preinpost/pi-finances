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
 * Adaptive: keyring read/write가 실패하면(예: SSH/헤드리스에서 키체인 접근이
 * 'User interaction is not allowed' 등으로 거부) 자동으로 file 백엔드로 전환하고
 * 키체인에 이미 있던 데이터를 파일로 이관한다. macOS + SSH 세션은 기본적으로
 * file 백엔드를 선택한다.
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
	/** 실전 계좌 상품코드 (ACNT_PRDT_CD, 보통 "01") — "12345678-01" 입력 시 자동 분리. */
	acctStockPrdtCd?: string;
	acctFuture?: string;
	paperStock?: string;
	/** 모의 계좌 상품코드 (ACNT_PRDT_CD, 보통 "01"). */
	paperStockPrdtCd?: string;
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

// 키체인 서비스 이름. 구버전(pi-kis-trading)으로 저장된 항목은
// migrateSecretsToKeyring()에서 새 이름으로 1회 이관 후 삭제된다.
const SERVICE = "pi-kis";
const LEGACY_SERVICE = "pi-kis-trading";

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
		// 오류를 삼키지 않는다 — AdaptiveStore가 받아서 file 백엔드로 전환한다.
		const raw = new this.lib.Entry(SERVICE, account).getPassword();
		return raw ? (JSON.parse(raw) as SecretBlob) : null;
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

/**
 * 키체인에 실제로 쓸 수 있는지 왕복 검사(쓰기→읽기→삭제).
 * 읽기만 검사하면 SSH처럼 쓰기가 거부되는 환경(키체인 잠김 / errSecInteractionNotAllowed)을
 * 놓치므로, 실제 쓰기를 수행해 검증한다. 실패하면 키체인을 사용하지 않는다.
 */
function probeKeyring(lib: KeyringLib): boolean {
	const entry = new lib.Entry(SERVICE, "__probe__");
	try {
		entry.setPassword(JSON.stringify({ probe: true }));
		const ok = entry.getPassword() !== null;
		entry.deleteCredential();
		return ok;
	} catch {
		try {
			entry.deleteCredential(); // best-effort 정리
		} catch {
			/* ignore */
		}
		return false;
	}
}

/** SSH 세션 여부 (SSH_CONNECTION/SSH_TTY). */
function isSshSession(): boolean {
	return Boolean(process.env.SSH_CONNECTION || process.env.SSH_TTY);
}

/**
 * keyring을 시도하되, 어느 작업이든 실패하면 그 시점부터 file 백엔드로
 * 영구 전환(degrade)하는 적응형 스토어. 전환 시 키체인에 이미 저장돼 있던
 * 키/토큰 데이터를 파일로 이관한다(가능한 경우).
 */
class AdaptiveStore implements SecretStore {
	backend: "keyring" | "file";
	private keyring: KeyringStore | null;
	private readonly file: FileStore;

	constructor(keyring: KeyringStore | null) {
		this.keyring = keyring;
		this.file = new FileStore();
		this.backend = keyring ? "keyring" : "file";
	}

	private degrade(): FileStore {
		if (this.keyring) {
			this.keyring = null;
			this.backend = "file";
			console.warn(
				"[pi-kis] OS keyring 사용 불가 → file 백엔드로 전환 (" + +
					keysPath + ", 0600). SSH/헤드리스에서는 키체인 접근이 거부될 수 있습니다. " +
					"KIS_SECRET_STORE=file 로 강제 지정할 수도 있습니다.",
			);
		}
		return this.file;
	}

	/** 키체인에 이미 저장된 데이터를 파일로 이관 (best-effort). */
	private async carryOverFrom(k: KeyringStore): Promise<void> {
		try {
			const keys = k.getKeys();
			if (keys && Object.keys(keys).length > 0) await this.file.saveKeys(keys);
			const tok = k.getTokenCache();
			if (tok && Object.keys(tok).length > 0) await this.file.saveTokenCache(tok);
			const appr = k.getApprovalCache();
			if (appr && Object.keys(appr).length > 0) await this.file.saveApprovalCache(appr);
		} catch {
			/* best-effort */
		}
	}

	getKeys(): KisKeys {
		if (!this.keyring) return this.file.getKeys();
		try {
			return this.keyring.getKeys();
		} catch {
			return this.degrade().getKeys();
		}
	}

	async saveKeys(keys: KisKeys): Promise<void> {
		if (!this.keyring) return this.file.saveKeys(keys);
		try {
			await this.keyring.saveKeys(keys);
		} catch {
			const k = this.keyring;
			this.degrade();
			await this.carryOverFrom(k);
			await this.file.saveKeys(keys);
		}
	}

	getTokenCache(): TokenCache {
		if (!this.keyring) return this.file.getTokenCache();
		try {
			return this.keyring.getTokenCache();
		} catch {
			return this.degrade().getTokenCache();
		}
	}

	async saveTokenCache(cache: TokenCache): Promise<void> {
		if (!this.keyring) return this.file.saveTokenCache(cache);
		try {
			await this.keyring.saveTokenCache(cache);
		} catch {
			const k = this.keyring;
			this.degrade();
			await this.carryOverFrom(k);
			await this.file.saveTokenCache(cache);
		}
	}

	getApprovalCache(): ApprovalCache {
		if (!this.keyring) return this.file.getApprovalCache();
		try {
			return this.keyring.getApprovalCache();
		} catch {
			return this.degrade().getApprovalCache();
		}
	}

	async saveApprovalCache(cache: ApprovalCache): Promise<void> {
		if (!this.keyring) return this.file.saveApprovalCache(cache);
		try {
			await this.keyring.saveApprovalCache(cache);
		} catch {
			const k = this.keyring;
			this.degrade();
			await this.carryOverFrom(k);
			await this.file.saveApprovalCache(cache);
		}
	}
}

function initStore(): SecretStore {
	const forced = process.env.KIS_SECRET_STORE;
	const lib = loadKeyring();
	if (lib) {
		const probeOk = probeKeyring(lib);
		if (probeOk && forced !== "file") {
			// macOS + SSH 세션: 키체인 쓰기가 GUI 승인 없이는 거부되므로 기본 file.
			// KIS_SECRET_STORE=keyring 으로 명시 강제하면 키체인을 사용한다.
			if (forced === "keyring" || !(process.platform === "darwin" && isSshSession())) {
				return new AdaptiveStore(new KeyringStore(lib));
			}
		} else if (forced === "keyring") {
			throw new Error(
				"KIS_SECRET_STORE=keyring but OS keyring is unavailable on this machine " +
					"(keychain locked or no interactive GUI session, e.g. over SSH).",
			);
		}
	}
	if (forced === "keyring") {
		throw new Error("KIS_SECRET_STORE=keyring but @napi-rs/keyring is not installed. Run `npm install` in the package root.");
	}
	return new AdaptiveStore(null);
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

	// ── 구 서비스명(pi-kis-trading) 키체인 항목 → 새 서비스명(pi-kis) 1회 이관 ──
	const lib = loadKeyring();
	if (lib) {
		const readLegacy = (account: string): SecretBlob => {
			try {
				const raw = new lib.Entry(LEGACY_SERVICE, account).getPassword();
				return raw ? (JSON.parse(raw) as SecretBlob) : null;
			} catch {
				return null;
			}
		};
		const hasData = (b: SecretBlob): boolean => !!b && Object.keys(b).length > 0;
		let legacyChanged = false;

		const legacyKeys = readLegacy("keys");
		if (hasData(legacyKeys) && !store.getKeys().appKey) {
			await store.saveKeys(legacyKeys as KisKeys);
			legacyChanged = true;
		}
		const legacyTok = readLegacy("token");
		if (hasData(legacyTok) && Object.keys(store.getTokenCache()).length === 0) {
			await store.saveTokenCache(legacyTok as TokenCache);
			legacyChanged = true;
		}
		const legacyAppr = readLegacy("approval");
		if (hasData(legacyAppr) && Object.keys(store.getApprovalCache()).length === 0) {
			await store.saveApprovalCache(legacyAppr as ApprovalCache);
			legacyChanged = true;
		}

		if (legacyChanged) {
			for (const acct of ["keys", "token", "approval", "__probe__"]) {
				try {
					new lib.Entry(LEGACY_SERVICE, acct).deleteCredential();
				} catch {
					/* ignore */
				}
			}
		}
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
