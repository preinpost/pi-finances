/**
 * src/roles/wallet.ts — 지갑(Wallet) 조회 + 지갑 간 이동.
 *
 * Binance 지갑:
 *   SPOT     현물 지갑 (/api/v3/account)
 *   FUNDING  펀딩 지갑 (POST /sapi/v1/asset/get-funding-asset)
 *   EARN     Simple Earn 유연(Flexible) 예치 (/sapi/v1/simple-earn/flexible/position)
 *   FUTURES  USDⓈ-M 선물 지갑 (/fapi/v2/balance)
 *
 * 이동 경로:
 *   SPOT·FUNDING·FUTURES 상호 → POST /sapi/v1/asset/transfer (Universal Transfer, type=MAIN_FUNDING 등)
 *   EARN → SPOT/FUNDING        → POST /sapi/v1/simple-earn/flexible/redeem (destAccount=SPOT|FUND)
 *   SPOT/FUNDING → EARN        → POST /sapi/v1/simple-earn/flexible/subscribe (sourceAccount=SPOT|FUND)
 *   EARN ↔ FUTURES 는 직접 경로가 없다 (SPOT 경유 2단계).
 *
 * 키 권한: 범용 이체는 "Permits Universal Transfer", Earn 환매/예치는 "Enable Spot & Margin Trading".
 * 출금(외부 주소 송금)은 다루지 않는다. 수량은 부동소수 오차를 피하려 API 원문 문자열 그대로 쓴다.
 */
import { binanceRequest } from "../client.ts";
import type { BinanceEnv } from "../secret.ts";

export const WALLETS = ["SPOT", "FUNDING", "EARN", "FUTURES"] as const;
export type Wallet = (typeof WALLETS)[number];

export const WALLET_LABELS: Record<Wallet, string> = {
	SPOT: "현물(Spot) 지갑",
	FUNDING: "펀딩(Funding) 지갑",
	EARN: "Simple Earn 유연 예치",
	FUTURES: "USDⓈ-M 선물 지갑",
};

export interface WalletOpts {
	env?: BinanceEnv;
}

export interface WalletAsset {
	asset: string;
	/** 이동 가능한 수량 (API 원문 문자열). */
	free: string;
	locked?: string;
	/** EARN 전용 — 유연 상품 ID (환매에 필요). */
	productId?: string;
	/** EARN 전용 — 현재 연이율. */
	apr?: string;
	/** EARN 전용 — 환매 가능 여부. */
	canRedeem?: boolean;
	/** FUTURES 전용 — 지갑 잔고 (미실현 포함 전). */
	balance?: string;
}

function isPositive(v: unknown): boolean {
	const n = Number(v);
	return Number.isFinite(n) && n > 0;
}

function str(v: unknown): string {
	return v === undefined || v === null ? "" : String(v);
}

// ── 지갑별 조회 ──────────────────────────────────────────────────────────

export async function getSpotWallet(opts: WalletOpts = {}): Promise<WalletAsset[]> {
	const raw = await binanceRequest<Record<string, unknown>>("spot", "GET", "/api/v3/account", {
		signed: true,
		group: "ACCOUNT",
		env: opts.env,
		query: { omitZeroBalances: true },
	});
	const rows = Array.isArray(raw.balances) ? (raw.balances as Array<Record<string, unknown>>) : [];
	return rows
		// LD* 는 Earn 예치 영수증 토큰 — 이동 불가, EARN 지갑에서 원금으로 표시한다.
		.filter((r) => !str(r.asset).startsWith("LD"))
		.filter((r) => isPositive(r.free) || isPositive(r.locked))
		.map((r) => ({
			asset: str(r.asset),
			free: str(r.free),
			...(isPositive(r.locked) ? { locked: str(r.locked) } : {}),
		}));
}

export async function getFundingWallet(opts: WalletOpts = {}): Promise<WalletAsset[]> {
	const rows = await binanceRequest<Array<Record<string, unknown>>>("spot", "POST", "/sapi/v1/asset/get-funding-asset", {
		signed: true,
		group: "ACCOUNT",
		env: opts.env,
	});
	return (Array.isArray(rows) ? rows : [])
		.filter((r) => isPositive(r.free) || isPositive(r.locked) || isPositive(r.freeze))
		.map((r) => {
			const locked = Number(r.locked ?? 0) + Number(r.freeze ?? 0);
			return {
				asset: str(r.asset),
				free: str(r.free),
				...(locked > 0 ? { locked: String(locked) } : {}),
			};
		});
}

export async function getEarnWallet(opts: WalletOpts & { asset?: string } = {}): Promise<WalletAsset[]> {
	const raw = await binanceRequest<{ rows?: Array<Record<string, unknown>> }>(
		"spot",
		"GET",
		"/sapi/v1/simple-earn/flexible/position",
		{ signed: true, group: "ACCOUNT", env: opts.env, query: { asset: opts.asset, size: 100 } },
	);
	return (raw.rows ?? [])
		.filter((r) => isPositive(r.totalAmount))
		.map((r) => ({
			asset: str(r.asset),
			free: str(r.totalAmount),
			productId: str(r.productId),
			apr: str(r.latestAnnualPercentageRate),
			canRedeem: r.canRedeem !== false,
		}));
}

export async function getFuturesWallet(opts: WalletOpts = {}): Promise<WalletAsset[]> {
	const rows = await binanceRequest<Array<Record<string, unknown>>>("usdm", "GET", "/fapi/v2/balance", {
		signed: true,
		group: "ACCOUNT",
		env: opts.env,
	});
	return (Array.isArray(rows) ? rows : [])
		.filter((r) => isPositive(r.balance) || isPositive(r.maxWithdrawAmount))
		.map((r) => ({
			asset: str(r.asset),
			// 선물 → 다른 지갑으로 뺄 수 있는 최대치 = maxWithdrawAmount
			free: str(r.maxWithdrawAmount ?? r.availableBalance),
			balance: str(r.balance),
		}));
}

const WALLET_READERS: Record<Wallet, (opts: WalletOpts) => Promise<WalletAsset[]>> = {
	SPOT: getSpotWallet,
	FUNDING: getFundingWallet,
	EARN: getEarnWallet,
	FUTURES: getFuturesWallet,
};

export interface WalletOverview {
	wallet: Wallet;
	label: string;
	assets?: WalletAsset[];
	error?: string;
}

/** 지갑별 잔고 — 한 지갑이 실패해도(권한·선물 미개설 등) 나머지는 반환한다. */
export async function getWalletOverview(opts: WalletOpts & { wallets?: Wallet[]; asset?: string } = {}): Promise<WalletOverview[]> {
	const targets = opts.wallets && opts.wallets.length > 0 ? opts.wallets : [...WALLETS];
	const asset = opts.asset?.trim().toUpperCase();
	const out: WalletOverview[] = [];
	for (const wallet of targets) {
		try {
			let assets = await WALLET_READERS[wallet](opts);
			if (asset) assets = assets.filter((a) => a.asset === asset);
			out.push({ wallet, label: WALLET_LABELS[wallet], assets });
		} catch (e) {
			out.push({ wallet, label: WALLET_LABELS[wallet], error: (e as Error).message });
		}
	}
	return out;
}

// ── 이동 계획 ──────────────────────────────────────────────────────────

type TransferRoute =
	| { kind: "universal"; type: string; api: string }
	| { kind: "redeem"; destAccount: "SPOT" | "FUND"; api: string }
	| { kind: "subscribe"; sourceAccount: "SPOT" | "FUND"; api: string };

const UNIVERSAL_TYPES: Partial<Record<`${Wallet}>${Wallet}`, string>> = {
	"SPOT>FUNDING": "MAIN_FUNDING",
	"FUNDING>SPOT": "FUNDING_MAIN",
	"SPOT>FUTURES": "MAIN_UMFUTURE",
	"FUTURES>SPOT": "UMFUTURE_MAIN",
	"FUNDING>FUTURES": "FUNDING_UMFUTURE",
	"FUTURES>FUNDING": "UMFUTURE_FUNDING",
};

export function resolveRoute(from: Wallet, to: Wallet): TransferRoute {
	if (from === to) throw new Error("보내는 지갑과 받는 지갑이 같습니다.");
	const universal = UNIVERSAL_TYPES[`${from}>${to}`];
	if (universal) return { kind: "universal", type: universal, api: `POST /sapi/v1/asset/transfer (type=${universal})` };
	if (from === "EARN" && (to === "SPOT" || to === "FUNDING")) {
		const destAccount = to === "SPOT" ? "SPOT" : "FUND";
		return { kind: "redeem", destAccount, api: `POST /sapi/v1/simple-earn/flexible/redeem (destAccount=${destAccount})` };
	}
	if (to === "EARN" && (from === "SPOT" || from === "FUNDING")) {
		const sourceAccount = from === "SPOT" ? "SPOT" : "FUND";
		return { kind: "subscribe", sourceAccount, api: `POST /sapi/v1/simple-earn/flexible/subscribe (sourceAccount=${sourceAccount})` };
	}
	throw new Error(`${WALLET_LABELS[from]} → ${WALLET_LABELS[to]} 직접 이동 경로가 없습니다. 현물(SPOT) 지갑을 거쳐 두 번 나눠 옮기세요.`);
}

export interface TransferPlan {
	from: Wallet;
	to: Wallet;
	asset: string;
	/** 실제 이동 수량 (all이면 가용 전량). */
	amount: string;
	all: boolean;
	/** 보내는 지갑의 이동 가능 수량. */
	available: string;
	route: TransferRoute;
	/** EARN 환매·예치용 유연 상품 ID. */
	productId?: string;
	/** 예치(subscribe) 최소 수량. */
	minAmount?: string;
}

async function findFlexibleProduct(asset: string, opts: WalletOpts): Promise<{ productId: string; minAmount?: string }> {
	const raw = await binanceRequest<{ rows?: Array<Record<string, unknown>> }>("spot", "GET", "/sapi/v1/simple-earn/flexible/list", {
		signed: true,
		group: "ACCOUNT",
		env: opts.env,
		query: { asset, size: 100 },
	});
	const row = (raw.rows ?? []).find((r) => str(r.asset) === asset && r.canPurchase !== false && r.isSoldOut !== true);
	if (!row) throw new Error(`${asset} 유연(Flexible) 예치 상품이 없거나 현재 예치할 수 없습니다.`);
	return { productId: str(row.productId), minAmount: str(row.minPurchaseAmount) || undefined };
}

/**
 * 이동 계획 — 실행 전 가용 수량·상품 ID를 조회해 검증한다 (서명 GET/조회만, 이동 없음).
 */
export async function planTransfer(req: {
	from: Wallet;
	to: Wallet;
	asset: string;
	amount?: string;
	all?: boolean;
	env?: BinanceEnv;
}): Promise<TransferPlan> {
	const asset = req.asset.trim().toUpperCase();
	if (!asset) throw new Error("asset이 필요합니다 (예: USDT).");
	const all = req.all === true;
	const amountIn = req.amount?.trim();
	if (!all && !amountIn) throw new Error("amount 또는 all=true 가 필요합니다.");
	if (!all && !isPositive(amountIn)) throw new Error(`amount가 올바르지 않습니다: ${amountIn}`);

	const route = resolveRoute(req.from, req.to);
	const holdings = await WALLET_READERS[req.from]({ env: req.env });
	const holding = holdings.find((h) => h.asset === asset);
	const available = holding?.free ?? "0";
	if (!isPositive(available)) throw new Error(`${WALLET_LABELS[req.from]}에 이동 가능한 ${asset}이(가) 없습니다.`);
	const amount = all ? available : amountIn!;
	if (Number(amount) > Number(available)) {
		throw new Error(`${WALLET_LABELS[req.from]}의 이동 가능 ${asset}은(는) ${available} 입니다 (요청 ${amount}).`);
	}

	const plan: TransferPlan = { from: req.from, to: req.to, asset, amount, all, available, route };
	if (route.kind === "redeem") {
		if (!holding?.productId) throw new Error(`${asset} Earn 상품 ID를 찾지 못했습니다.`);
		if (holding.canRedeem === false) throw new Error(`${asset} Earn 예치분이 현재 환매 불가 상태입니다.`);
		plan.productId = holding.productId;
	} else if (route.kind === "subscribe") {
		const product = await findFlexibleProduct(asset, { env: req.env });
		plan.productId = product.productId;
		plan.minAmount = product.minAmount;
		if (product.minAmount && Number(amount) < Number(product.minAmount)) {
			throw new Error(`${asset} 유연 예치 최소 수량은 ${product.minAmount} 입니다.`);
		}
	}
	return plan;
}

/** 확인 카드 본문 (title/message). */
export function describePlan(plan: TransferPlan): { title: string; message: string } {
	return {
		title: `바이낸스 지갑 이동: ${plan.asset} ${plan.all ? "전량" : plan.amount}`,
		message: [
			`보내는 지갑: ${WALLET_LABELS[plan.from]}`,
			`받는 지갑: ${WALLET_LABELS[plan.to]}`,
			`자산: ${plan.asset}`,
			`수량: ${plan.amount}${plan.all ? " (전량)" : ""}`,
			`이동 가능: ${plan.available}`,
			...(plan.productId ? [`Earn 상품: ${plan.productId}`] : []),
			`API: ${plan.route.api}`,
			"같은 계정 안의 지갑 간 이동이며 외부 출금이 아닙니다.",
		].join("\n"),
	};
}

/** 이동 실행 — 반드시 사용자 확인 후에만 호출한다. POST라 자동 재시도하지 않는다. */
export async function executeTransfer(plan: TransferPlan, opts: WalletOpts = {}): Promise<Record<string, unknown>> {
	const route = plan.route;
	if (route.kind === "universal") {
		const raw = await binanceRequest<Record<string, unknown>>("spot", "POST", "/sapi/v1/asset/transfer", {
			signed: true,
			group: "ORDER",
			env: opts.env,
			query: { type: route.type, asset: plan.asset, amount: plan.amount },
		});
		return { tranId: raw.tranId };
	}
	if (route.kind === "redeem") {
		const raw = await binanceRequest<Record<string, unknown>>("spot", "POST", "/sapi/v1/simple-earn/flexible/redeem", {
			signed: true,
			group: "ORDER",
			env: opts.env,
			query: {
				productId: plan.productId,
				...(plan.all ? { redeemAll: true } : { amount: plan.amount }),
				destAccount: route.destAccount,
			},
		});
		return { redeemId: raw.redeemId, success: raw.success };
	}
	const raw = await binanceRequest<Record<string, unknown>>("spot", "POST", "/sapi/v1/simple-earn/flexible/subscribe", {
		signed: true,
		group: "ORDER",
		env: opts.env,
		query: { productId: plan.productId, amount: plan.amount, sourceAccount: route.sourceAccount },
	});
	return { purchaseId: raw.purchaseId, success: raw.success };
}
