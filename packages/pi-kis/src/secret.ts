/**
 * src/secret.ts — KIS 시크릿 스토어 (pi-finance-core의 공용 스토어 위 래퍼).
 *
 * 실제 keyring/file 백엔드·적응형 전환은 pi-finance-core/src/store.ts가 담당한다.
 * pi-kis와 pi-toss는 **하나의 공유 네임스페이스**("pi-kis")를 쓰므로 기존
 * 사용자 키가 그대로 유효하다 — 저장은 반드시 mergeWrite (타 패키지 필드 보존).
 *
 * Env controls (공용): KIS_SECRET_STORE=file|keyring, KIS_KEYS_FILE=경로.
 */
import {
	createSecretStore,
	hasPlaintextFiles as coreHasPlaintextFiles,
	mergeWrite,
	migrateFilesToKeyring,
	migrateIfEmpty,
	type SecretBlob,
} from "pi-finance-core";

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

/** 공용 스토어 (pi-toss와 공유 — 네임스페이스/설정 변경 시 키 무효화). */
export const store = createSecretStore({
	namespace: "pi-kis",
	envVar: "KIS_SECRET_STORE",
	keysFileEnv: "KIS_KEYS_FILE",
});

export const keysPath = store.files.keys;
export const tokenPath = store.files.token;
export const approvalPath = store.files.approval;

// ── 타입드 뷰 ──────────────────────────────────────────────────────────────

export function getKeys(): KisKeys {
	return (store.read("keys") ?? {}) as KisKeys;
}

export async function saveKeys(keys: KisKeys): Promise<void> {
	await mergeWrite(store, "keys", keys as SecretBlob);
}

export function getTokenCache(): TokenCache {
	return (store.read("token") ?? {}) as TokenCache;
}

export async function saveTokenCache(cache: TokenCache): Promise<void> {
	await mergeWrite(store, "token", cache as SecretBlob);
}

export function getApprovalCache(): ApprovalCache {
	return (store.read("approval") ?? {}) as ApprovalCache;
}

export async function saveApprovalCache(cache: ApprovalCache): Promise<void> {
	await mergeWrite(store, "approval", cache as SecretBlob);
}

// ── 마이그레이션 (pi-kis 전용) ─────────────────────────────────────────────

/**
 * 1) plaintext 파일(~/.pi/agent/kis-keys.json, kis-token.json) → keyring 이관
 *    후 파일 삭제. 2) 구 서비스명(pi-kis-trading) keyring 항목 → pi-kis 이관.
 * extension 활성화 시 1회 호출. file 백엔드면 1)은 no-op.
 */
export async function migrateSecretsToKeyring(): Promise<void> {
	// ── plaintext 파일 → keyring ──
	await migrateFilesToKeyring(store, [
		{
			path: keysPath,
			account: "keys",
			pick: (file, current) => (!(current as KisKeys).appKey && Object.keys(file).length > 0 ? file : null),
		},
		{
			path: tokenPath,
			account: "token",
			pick: (file, current) => (Object.keys(current).length === 0 ? file : null),
		},
	]);

	// ── 구 서비스명(pi-kis-trading) 키체인 항목 → 새 서비스명(pi-kis) 1회 이관 ──
	const legacy = createSecretStore({ namespace: "pi-kis-trading", envVar: "KIS_SECRET_STORE" });
	await migrateIfEmpty(legacy, store, "keys", { clearSource: true });
	await migrateIfEmpty(legacy, store, "token", { clearSource: true });
	await migrateIfEmpty(legacy, store, "approval", { clearSource: true });
}

/** True when the plaintext key/token files still exist (pre-migration). */
export function hasPlaintextFiles(): boolean {
	return coreHasPlaintextFiles([keysPath, tokenPath]);
}
