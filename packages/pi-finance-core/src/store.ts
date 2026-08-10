/**
 * pi-finance-core/src/store.ts — 범용 시크릿 스토어.
 *
 * pi-kis / pi-toss 가 **하나의 공유 네임스페이스**("pi-kis")를 사용한다:
 * 기존 사용자의 키체인 SERVICE·파일 경로가 그대로 유지되어 분리 시
 * 키 재입력/마이그레이션이 전혀 필요 없다. 각 패키지는 자체 타입드 뷰로
 * read/write(merge)만 한다.
 *
 * Backend priority:
 *   1. OS keyring via @napi-rs/keyring — macOS Keychain, Windows Credential
 *      Manager, Linux Secret Service (libsecret) / kernel keyring.
 *   2. File fallback — ~/.pi/agent/{namespace}-keys.json / -token.json (0600).
 *
 * Adaptive: keyring read/write 실패 시(SSH/헤드리스 등) file 백엔드로 영구
 * 전환(degrade)하고, 키체인에 있던 데이터를 파일로 이관한다.
 *
 * Env controls (공용): KIS_SECRET_STORE=file|keyring (기존 호환 유지),
 * KIS_KEYS_FILE=경로 (keys 파일 위치 오버라이드).
 *
 * @napi-rs/keyring은 core의 dependency (네이티브 바인딩). pi가 npm/git으로
 * 설치하면 자동 설치되고, 로컬 경로 설치는 패키지 루트에서 한 번 `npm install`.
 */
import { createRequire } from "node:module";
import { existsSync, readFileSync, rmSync } from "node:fs";
import { chmod, mkdir, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import { join } from "node:path";

export type SecretBlob = Record<string, unknown>;

/**
 * pi-kis·pi-toss 공용 스토어 설정 (단일 네임스페이스 — 기존 사용자 데이터
 * 호환을 위해 namespace/env var 이름을 유지한다. 변경 시 키 무효화).
 */
export const FINANCE_STORE_OPTIONS = {
	namespace: "pi-kis",
	envVar: "KIS_SECRET_STORE",
	keysFileEnv: "KIS_KEYS_FILE",
} as const;

/** 스토어가 다루는 기본 account 이름. */
export const STORE_ACCOUNTS = ["keys", "token", "approval"] as const;

export interface SecretStore {
	readonly backend: "keyring" | "file";
	readonly namespace: string;
	/** account별 파일 경로 (file 백엔드 기준 — 표시용). */
	readonly files: { keys: string; token: string; approval: string };
	/** account("keys"|"token"|"approval")의 blob. 없으면 null. */
	read(account: string): SecretBlob | null;
	/** 전체 blob 교체 (merge는 mergeWrite 사용). null이면 삭제. */
	write(account: string, data: SecretBlob | null): Promise<void>;
	/** account 삭제. */
	clear(account: string): Promise<void>;
}

function filesFor(namespace: string, keysFileEnv: string | undefined): SecretStore["files"] {
	const env = keysFileEnv ? process.env[keysFileEnv] : undefined;
	return {
		keys: env ?? join(agentDir, `${namespace}-keys.json`),
		token: join(agentDir, `${namespace}-token.json`),
		approval: join(agentDir, `${namespace}-approval.json`),
	};
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

export interface SecretStoreOptions {
	/** keyring SERVICE + 파일 베이스명. */
	namespace: string;
	/** 백엔드 강제 env var (KIS_SECRET_STORE 등). */
	envVar: string;
	/** keys 파일 경로 env var (KIS_KEYS_FILE 등, 선택). */
	keysFileEnv?: string;
}

function loadKeyring(envVar: string): KeyringLib | null {
	if (process.env[envVar] === "file") return null;
	try {
		// 이 패키지(pi-finance-core) 자신의 node_modules에서 resolve — pi는
		// 패키지별 module root를 분리하므로 createRequire(import.meta.url)가
		// 우리 의존성을 본다.
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
	// getter로 지연 평가 (클래스 필드 초기화 시점엔 namespace가 아직 미할당)
	get files(): SecretStore["files"] {
		return filesFor(this.namespace, undefined);
	}
	constructor(
		private readonly lib: KeyringLib,
		readonly namespace: string,
	) {}

	private readRaw(account: string): SecretBlob | null {
		// 오류를 삼키지 않는다 — AdaptiveStore가 받아서 file 백엔드로 전환.
		const raw = new this.lib.Entry(this.namespace, account).getPassword();
		return raw ? (JSON.parse(raw) as SecretBlob) : null;
	}

	private writeRaw(account: string, data: SecretBlob | null): void {
		const entry = new this.lib.Entry(this.namespace, account);
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

	read(account: string): SecretBlob | null {
		return this.readRaw(account);
	}

	async write(account: string, data: SecretBlob | null): Promise<void> {
		this.writeRaw(account, data);
	}

	async clear(account: string): Promise<void> {
		this.writeRaw(account, null);
	}
}

class FileStore implements SecretStore {
	readonly backend = "file" as const;

	constructor(
		readonly namespace: string,
		private readonly keysFileEnv?: string,
	) {}

	get files(): SecretStore["files"] {
		return filesFor(this.namespace, this.keysFileEnv);
	}

	private readFile(path: string): SecretBlob | null {
		try {
			return JSON.parse(readFileSync(path, "utf8")) as SecretBlob;
		} catch {
			return null;
		}
	}

	private async writeFile(path: string, data: SecretBlob | null): Promise<void> {
		await mkdir(agentDir, { recursive: true });
		await writeFile(path, JSON.stringify(data ?? {}, null, 2) + "\n", "utf8");
		await chmod(path, 0o600); // same as ~/.pi/agent/auth.json
	}

	read(account: string): SecretBlob | null {
		return this.readFile(this.files[account as keyof typeof this.files] ?? join(agentDir, `${this.namespace}-${account}.json`));
	}

	async write(account: string, data: SecretBlob | null): Promise<void> {
		await this.writeFile(this.files[account as keyof typeof this.files] ?? join(agentDir, `${this.namespace}-${account}.json`), data);
	}

	async clear(account: string): Promise<void> {
		await this.write(account, null);
	}
}

/**
 * 키체인에 실제로 쓸 수 있는지 왕복 검사(쓰기→읽기→삭제).
 * 읽기만 검사하면 SSH처럼 쓰기가 거부되는 환경(키체인 잠김 /
 * errSecInteractionNotAllowed)을 놓치므로 실제 쓰기로 검증한다.
 */
function probeKeyring(lib: KeyringLib, namespace: string): boolean {
	const entry = new lib.Entry(namespace, "__probe__");
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

/** keyring 실패 시 file 백엔드로 영구 전환 + 데이터 이관하는 적응형 스토어. */
class AdaptiveStore implements SecretStore {
	backend: "keyring" | "file";
	readonly files: SecretStore["files"];
	private keyring: KeyringStore | null;
	private readonly file: FileStore;

	constructor(
		keyring: KeyringStore | null,
		file: FileStore,
		readonly namespace: string,
		private readonly envVar: string,
	) {
		this.keyring = keyring;
		this.file = file;
		this.files = file.files;
		this.backend = keyring ? "keyring" : "file";
	}

	private degrade(): FileStore {
		if (this.keyring) {
			this.keyring = null;
			this.backend = "file";
			console.warn(
				`[pi-finance-core] OS keyring 사용 불가 → file 백엔드로 전환 (${this.file.files.keys}, 0600). ` +
					`SSH/헤드리스에서는 키체인 접근이 거부될 수 있습니다. ${this.envVar}=file 로 강제 지정할 수도 있습니다.`,
			);
		}
		return this.file;
	}

	/** 키체인에 이미 저장된 데이터를 파일로 이관 (best-effort). */
	private async carryOverFrom(k: KeyringStore): Promise<void> {
		for (const account of STORE_ACCOUNTS) {
			try {
				const data = k.read(account);
				if (data && Object.keys(data).length > 0) await this.file.write(account, data);
			} catch {
				/* best-effort */
			}
		}
	}

	read(account: string): SecretBlob | null {
		if (!this.keyring) return this.file.read(account);
		try {
			return this.keyring.read(account);
		} catch {
			return this.degrade().read(account);
		}
	}

	async write(account: string, data: SecretBlob | null): Promise<void> {
		if (!this.keyring) return this.file.write(account, data);
		try {
			await this.keyring.write(account, data);
		} catch {
			const k = this.keyring;
			this.degrade();
			await this.carryOverFrom(k);
			await this.file.write(account, data);
		}
	}

	async clear(account: string): Promise<void> {
		await this.write(account, null);
	}
}

/** 네임스페이스 스코프 시크릿 스토어 생성 (싱글턴 — 모듈 최상단에서 1회). */
export function createSecretStore(opts: SecretStoreOptions): SecretStore {
	const { namespace, envVar, keysFileEnv } = opts;
	const forced = process.env[envVar];
	const lib = loadKeyring(envVar);
	if (lib) {
		const probeOk = probeKeyring(lib, namespace);
		if (probeOk && forced !== "file") {
			// macOS + SSH 세션: 키체인 쓰기가 GUI 승인 없이는 거부되므로 기본 file.
			// envVar=keyring 으로 명시 강제하면 키체인을 사용한다.
			if (forced === "keyring" || !(process.platform === "darwin" && isSshSession())) {
				return new AdaptiveStore(new KeyringStore(lib, namespace), new FileStore(namespace, keysFileEnv), namespace, envVar);
			}
		} else if (forced === "keyring") {
			throw new Error(
				`${envVar}=keyring but OS keyring is unavailable on this machine ` +
					"(keychain locked or no interactive GUI session, e.g. over SSH).",
			);
		}
	}
	if (forced === "keyring") {
		throw new Error(`${envVar}=keyring but @napi-rs/keyring is not installed. Run \`npm install\` in the package root.`);
	}
	return new AdaptiveStore(null, new FileStore(namespace, keysFileEnv), namespace, envVar);
}

/**
 * read-modify-write 병합 저장 — 공유 스토어에서 타 패키지가 쓴 필드를
 * 보존하기 위해 항상 현재 blob과 병합한다. (분리 후 필수: pi-kis가 키를
 * 저장할 때 toss 필드를 지우면 안 된다.)
 */
export async function mergeWrite(store: SecretStore, account: string, patch: SecretBlob): Promise<void> {
	const current = store.read(account) ?? {};
	await store.write(account, { ...current, ...patch });
}

/**
 * keyring 활성 시 plaintext 파일(key/token)을 keyring으로 이관 후 파일 삭제.
 * extension 활성화 시 1회 호출한다. file 백엔드면 no-op.
 *
 * entries: { path, account, pick } — pick(파일 blob, 현재 blob)이
 * non-null을 반환하면 그 값으로 저장한다 (조건부 이관용).
 */
export async function migrateFilesToKeyring(
	store: SecretStore,
	entries: { path: string; account: string; pick: (file: SecretBlob, current: SecretBlob) => SecretBlob | null }[],
): Promise<void> {
	if (store.backend !== "keyring") return;
	let changed = false;
	for (const { path, account, pick } of entries) {
		let file: SecretBlob | null = null;
		try {
			file = JSON.parse(readFileSync(path, "utf8")) as SecretBlob;
		} catch {
			continue;
		}
		const current = store.read(account) ?? {};
		const picked = pick(file, current);
		if (picked && Object.keys(picked).length > 0) {
			await store.write(account, { ...current, ...picked });
			changed = true;
		}
	}
	if (changed) {
		for (const { path } of entries) {
			try {
				rmSync(path, { force: true });
			} catch {
				/* ignore */
			}
		}
	}
}

/**
 * source 스토어의 account blob을 target으로 이관 (target이 비어있을 때만).
 * clearSource가 true면 성공 후 source에서 삭제 (전용 레거시 네임스페이스용 —
 * 공용 네임스페이스에서는 절대 true로 호출하지 말 것: 다른 필드가 함께
 * 지워질 수 있다).
 */
export async function migrateIfEmpty(
	from: SecretStore,
	to: SecretStore,
	account: string,
	opts?: { clearSource?: boolean },
): Promise<boolean> {
	const src = from.read(account);
	if (!src || Object.keys(src).length === 0) return false;
	const cur = to.read(account);
	if (cur && Object.keys(cur).length > 0) return false;
	await to.write(account, src);
	if (opts?.clearSource) await from.clear(account);
	return true;
}

/** plaintext 키/토큰 파일 존재 여부 (마이그레이션 전 상태 확인). */
export function hasPlaintextFiles(paths: string[]): boolean {
	return paths.some((p) => existsSync(p));
}
