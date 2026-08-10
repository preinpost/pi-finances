I have a complete picture. Note: `plan.md` and `progress.md` do not exist in `/Users/ms/dev/pi/pi-finances` (only `DESIGN-DRAFT.md`), so the draft is the plan under review. Here is the grill.

---

# Review: pi-finances monorepo design (grilling DESIGN-DRAFT.md against pi-kis 0.2.1 + pi package mechanics)

## Q1. kis/toss split — is the broker_* fallback facade viable under option (a)?

**Finding 1 — MAJOR (the central decision): Option (a) "optionalDependency + 동적 import" as drafted is a trap. Ship option (b), but keep the `broker_*` tool *names*.**

Evidence from the code:
- The facade today is `src/roles/broker.ts:13-16`, which statically imports both `./market.ts` (KIS) and `./toss.ts` — fine in a monolith, impossible across package boundaries without a declared dependency.
- `pi-toss`'s published entry would be `export default registerExtension` (same pattern as `index.ts:27` / `extension.ts:17`) — it does **not** export `getPrices`/`getCandles`. Option (a) as drafted ("동적 import") has no import target: pi-kis would have to deep-import `pi-toss/src/roles/toss.ts` (fragile, and `roles/toss.ts:21` pulls `indicators.ts` and `core/toss/client.ts:23-24` pulls `../auth.ts` + `../secret.ts`, i.e., pi-toss's whole graph plus a key store).
- The docs (`packages.md`, "Dependencies") prescribe **bundling** resources via `bundledDependencies` + `node_modules/` paths — a different mechanism from a runtime code dependency. A plain `optionalDependencies` entry *does* resolve at runtime (jiti/node resolution walks up from pi-kis's dir to the shared `~/.pi/agent/npm/node_modules` root), so it is mechanically possible — but only with three unstated prerequisites:
  1. pi-toss must export a **library API** from its entry (e.g., named exports `getPrices`, `getCandles` alongside the default extension factory), not just the extension factory;
  2. version ranges must be aligned so npm dedupes in the shared root — otherwise npm installs a **nested copy** of pi-toss under `pi-kis/node_modules` (version skew: the facade runs old pi-toss while the agent's `toss_*` tools run the new top-level one; since there is no build step, API drift breaks the facade silently at runtime);
  3. keys must be read from a **shared store** (core), or the facade's key check diverges from what `/toss-key` wrote.
- Even with all three, every pi-kis install re-pulls pi-toss + its `@napi-rs/keyring` native binding — the exact re-coupling the split was meant to remove — and a future pi-toss 1.0 API rename breaks pi-kis's facade at runtime for existing users.

Recommendation: **option (b)**, but implemented as "(b2)": delete the cross-package facade module (`src/roles/broker.ts`), keep the two tool names `broker_price`/`broker_chart` registered in pi-kis as **KIS-first with agent-mediated fallback** — on missing KIS keys/empty data, return `{ ok:false, error, fallback: "toss_price ... (pi-toss 설치 시)" }` and let the model retry. This preserves the tool-name contract (`tools.ts:3-5` "이름 변경 불가"), keeps `timing/SKILL.md:14,21` references working, and has zero cross-package imports. Toss-only users get `toss_price`/`toss_chart` directly from pi-toss.

## Q2. Is pi-finance-core extraction premature, and what must actually move?

**Finding 2 — MAJOR: The draft's core scope is wrong on 2 of 4 items. Extract `indicators.ts` + the secret store only; keep `types` and `ratelimit` per-package.**

From the actual import graph:
- `src/roles/indicators.ts` — pure module, zero imports, used by `tools.ts:20`, `broker.ts:16`, `toss.ts:21`. Genuinely shared. Move: `Bar` type + `analyze`/`sma`/`ema`/`rsi` etc.
- `src/core/secret.ts` — shared storage (both KIS and toss tokens live in the same `TokenCache`, `secret.ts:55`; keyring `SERVICE = "pi-kis"`, `secret.ts:93-94`, incl. the LEGACY migration). Genuinely shared. Move (as a generic store API).
- `src/roles/types.ts:7-14` — imports `EnvArg`/`KisEnv` from `core/auth.ts` (KIS-specific); NOT generic. **Do not move.**
- `src/core/ratelimit.ts:18,28,52` — typed on `KisEnv`, KIS-flavored; toss already has its own `src/core/toss/ratelimit.ts`. "ratelimit" is already split — **do not move.**
- `src/core/auth.ts:58-59` — `loadKeys()` still reads `tossClientId`/`tossClientSecret`; after the split pi-toss needs its own thin key-loader over the core store.

Verdict: extraction is **not premature** for indicators+store (both are genuinely shared and nontrivial), but the draft's "공용 lib: types, ratelimit" is premature — those are KIS-coupled. Scope core to: `Bar` + indicator math + generic keyring/file store (+ shared key-merge semantics, see Finding 4).

**Finding 3 — MAJOR: `stock-html → pi-finance-core` is inconsistent and forces heavy machinery. Keep it in pi-kis.**

`packages.md` requires resource-sharing pi packages to be bundled (`dependencies` + `bundledDependencies` + `node_modules/` path references in the manifest). Putting a *skill* inside core turns core into a resource package that every consumer (pi-kis, pi-toss) must bundle-and-reference — heavy for one design-system skill. The draft already lists `pi-stock-html` as a future package (DESIGN-DRAFT.md 구조); that's where stock-html belongs. For 0.3.0, keep it in pi-kis. Core should be a **pure library with no `pi` manifest, no skills**.

## Q3. Skills ownership split — breakage for existing users at 0.3.0?

**Finding 4 — MAJOR: Keyring migration is missing; existing users' toss keys would be orphaned (or wiped by a non-merging save).**

Evidence: existing users' toss keys live in the **same** store as KIS keys (`secret.ts:46` `tossClientId`, `:55` `toss` token; file `~/.pi/agent/kis-keys.json`; keyring service `"pi-kis"`). Draft point 3 defines "각 패키지가 자체 키 스키마" but no migration path. If pi-toss writes to its own namespace and pi-kis 0.3.0 rewrites the shared file without merging, users re-enter keys or lose them. Fix: keep **one store namespace** with per-package fields and merge-on-write (like the existing `LEGACY_SERVICE` one-time migration, `secret.ts:94,397`), and add a pi-toss first-run migration from the old `pi-kis` store.

**Finding 5 — MAJOR: Three of four KIS skills reference `toss_*` tools; the draft only flags timing's conditional reference.**

- `skills/timing/SKILL.md:14,21` — references `broker_chart` (must be reworked under option (b)); `:39-42` references `toss_chart`.
- `skills/stock-research/SKILL.md:86-91` — instructs `toss_market`/`toss_balance` enrichment ("토스 키가 있으면").
- `skills/kis-trading/SKILL.md:58,63` — `toss_market kind:"warnings"`, OCO via toss.

Conditionality must change from "토스 키가 있으면" to "**pi-toss 패키지 설치 시**" (keys alone are insufficient after the split). Update all four skills, not just timing.

**Finding 6 — MINOR: `settings.json:17` has unpinned `"npm:pi-kis"` → `pi update --extensions` auto-moves existing users to 0.3.0 (breaking: toss_* tools, `/toss-key`, `broker_*` semantics gone).** Coordinate releases (publish pi-toss *first*), and ship a README migration section + release notes so existing users install `npm:pi-toss` explicitly. (Also: current published pi-kis is 0.2.1 — `npm view pi-kis versions` → `0.2.0, 0.2.1` — so 0.3.0 is the first split release; the "users at 0.3.0" scenario is exactly this upgrade path.)

## Q4. Release pipeline: extend custom bump-and-release vs changesets

**Finding 7 — BLOCKER: The current workflow, as-is, would publish broken tarballs in a pnpm workspace.**

Evidence: `.github/workflows/bump-and-release.yml:59` `npm ci`, `:95` `npm version`, `:99` single `git tag v${VERSION}`, `:108` `npm publish`. In a pnpm monorepo: (a) `npm ci` fails (no root `package-lock.json`; `pnpm-lock.yaml` instead); (b) a single repo-wide tag can't version 3 packages independently; (c) **`npm publish` does not understand `workspace:*`** — it would embed `"workspace:*"` in the published `package.json`, and `pi install npm:...` (which installs with npm) would fail to resolve it. `pnpm publish` rewrites `workspace:*` to real versions; `npm publish` does not. This is the "workspace:* + published tarball mismatch" trap.

Concrete recommendation — **extend the custom workflow, do NOT adopt changesets** (2-3 packages, solo maintainer; changesets adds per-PR ceremony and its own release flow for little gain):
1. CI: `pnpm/action-setup` + `pnpm install --frozen-lockfile` (or `pnpm deploy --filter` per package).
2. Change detection: `dorny/paths-filter` (or `git diff --name-only <tag>..HEAD` per `packages/*`) → changed packages.
3. Per-package version bump from the existing commit-message rule (keep the `BREAKING|feat|fix` detection, applied per package).
4. Per-package git tags (`pi-kis@0.3.0`, `pi-toss@0.1.0`, …) and one GitHub Release with combined notes.
5. Publish with `pnpm publish -r --filter ./packages/...` in **topological order** (core → toss → kis), never `npm publish`; add `publishConfig.access: public` to new packages.
6. Keep `NPM_TOKEN` secret; provenance (`--provenance`) optional as the current comment notes.

## Q5. What the draft missed

**Finding 8 — MAJOR: `pi install git:...` breaks for the monorepo.** `README.md:14` documents `pi install git:github.com/preinpost/pi-kis`. pi's `installGit` clones the repo **root** and loads it as the package (`package-manager.js`, clone → `npm install` at root; no subdirectory support in the git spec, per `packages.md` "git:" sources). In the monorepo the root is a private workspace root with no `pi` manifest → git installs load nothing. Must document **npm as the only install source** (update README lines 10-23) or provide a root-level forwarding manifest (hacky, module-root issues). Draft point 7 covers the author's local-path dev but not the README's advertised git path.

**Finding 9 — MINOR: watch.ts ownership is unstated.** `src/watch.ts` and `/kis-watch` (`commands.ts:251-253`) are KIS-WS-specific — they stay in pi-kis, but the draft's package lists omit them. Also re-state the tool counts per package (pi-kis: `kis_*` 10 + `broker_*` 2; pi-toss: `toss_*` 7) and note `/kis-key`,`/kis-status`,`/kis-watch` stay, `/toss-key` moves.

**Finding 10 — MINOR: the "400KB KIS configs" claim understates the payload.** `configs/` is 405KB but `src/core/generated/apis.json` is ~3.3MB (shipped via the `files: ["src"]` field, package.json:43-50). Toss-only users save **~3.7MB**, not 400KB. Also: pi-toss needs its own `peerDependencies` (`typebox`, `@earendil-works/pi-coding-agent` — `tools.ts:9-10` uses both), its own `pi` manifest, `publishConfig`, `files`, `.env.example` (TOSS_* vars move), and README; core needs **no** pi peers (pure lib).

**Finding 11 — MINOR/NIT: npm names are free.** `npm view pi-toss`, `pi-finance-core`, `pi-broker-fallback` → E404 (available). Unscoped is consistent with `pi-kis`. `engines: node >=18` vs `commands.ts:253` spawning `--experimental-transform-types` (needs Node ≥22.6) — pre-existing mismatch, cheap to fix while splitting.

---

## Verdict — what I would actually ship

Split **now** into `packages/pi-kis` (KIS-only: 10 `kis_*` tools + `broker_price`/`broker_chart` as KIS-first + agent-mediated fallback, `/kis-key` `/kis-status` `/kis-watch`, watch.ts, 4 skills with re-gated toss references) and `packages/pi-toss` (7 `toss_*` tools + `/toss-key`, own key schema over a shared store, no skills yet). Extract `packages/pi-finance-core` as a **pure library** containing exactly `Bar` + indicator math (`indicators.ts`) + the generic keyring/file store — not types, not ratelimit, not stock-html. Keep one shared secret-store namespace with merge-on-write (no key re-entry). Release with the extended custom workflow (pnpm + paths-filter + per-package tags + `pnpm publish` in topo order), publish pi-toss before pi-kis 0.3.0, document npm-only install (git installs of the monorepo root don't work), and update all four skills' conditionality to "pi-toss 설치 시".