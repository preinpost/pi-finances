#!/usr/bin/env node
/**
 * generate-apis.mjs — generates src/generated/apis.json from the official
 * koreainvestment/open-trading-api repo.
 *
 * Input (read-only):
 *   - configs/<category>.json        : API definitions (api_type, api_path, params)
 *   - <repo>/examples_llm/.../<api>/<api>.py : generated example code with tr_id,
 *                                             HTTP method and body/query param map
 * Output:
 *   - src/generated/apis.json : { "<category>.<api_type>": { ... } }
 *
 * Usage:
 *   KIS_REPO=/path/to/open-trading-api node scripts/generate-apis.mjs
 *   (KIS_REPO defaults to a sibling checkout of the repo)
 */
import { readFileSync, readdirSync, writeFileSync, existsSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const pkgRoot = resolve(here, "..");
const configDir = join(pkgRoot, "configs");
const outFile = join(pkgRoot, "src", "generated", "apis.json");
const repoRoot = process.env.KIS_REPO ?? resolve(pkgRoot, "..", "open-trading-api");

/** Parse a `params = { "KEY": var, ... }` dict literal from example code. */
function parseParamsDict(code) {
  const m = code.match(/params\s*=\s*\{([\s\S]*?)\n\s*\}/);
  if (!m) return [];
  const entries = [];
  for (const line of m[1].split("\n")) {
    // keys may be UPPER (overseas) or lower (domestic); allow trailing comments
    const e = line.match(/^\s*"([A-Za-z_][A-Za-z0-9_]*)"\s*:\s*([a-zA-Z_][a-zA-Z0-9_]*)\s*,?\s*(?:#.*)?$/);
    if (e) entries.push({ key: e[1], var: e[2] });
  }
  return entries;
}

function extractTrIds(code) {
  const ids = [];
  for (const m of code.matchAll(/tr_id\s*=\s*"([A-Z][A-Z0-9]+)"/g)) {
    if (!ids.includes(m[1])) ids.push(m[1]);
  }
  return ids;
}

const apis = {};
const missingExamples = [];
const parseErrors = [];

for (const cfgFile of readdirSync(configDir).filter((f) => f.endsWith(".json"))) {
  const category = cfgFile.replace(/\.json$/, "");
  if (category === "auth") continue; // token issuance handled natively by src/auth.ts
  const cfg = JSON.parse(readFileSync(join(configDir, cfgFile), "utf8"));
  if (!cfg.apis) continue;
  for (const [apiType, def] of Object.entries(cfg.apis)) {
    // github_url e.g. https://github.com/koreainvestment/open-trading-api/tree/main/examples_llm/overseas_stock/price
    const rel = def.github_url?.match(/examples_llm\/([^/]+)\/([^/]+)\/?$/);
    if (!rel) {
      parseErrors.push(`${category}.${apiType}: no examples_llm path in github_url`);
      continue;
    }
    const exPath = join(repoRoot, "examples_llm", rel[1], rel[2], `${rel[2]}.py`);
    if (!existsSync(exPath)) {
      missingExamples.push(`${category}.${apiType}`);
      continue;
    }
    const code = readFileSync(exPath, "utf8");
    const urlMatch = code.match(/API_URL\s*=\s*"([^"]+)"/);
    const body = parseParamsDict(code);
    if (!urlMatch || body.length === 0) {
      parseErrors.push(`${category}.${apiType}: could not parse API_URL or params dict`);
      continue;
    }
    const trIds = extractTrIds(code);
    if (trIds.length === 0) {
      parseErrors.push(`${category}.${apiType}: no tr_id found`);
      continue;
    }
    const required = Object.entries(def.params ?? {})
      .filter(([, p]) => p.required && !["auth", "env_dv", "tr_cont", "dataframe", "dataframe1", "dataframe2", "depth", "max_depth"].includes(p.name))
      .map(([name]) => name);
    apis[`${category}.${apiType}`] = {
      name: def.name,
      api_path: urlMatch[1],
      method: /postFlag\s*=\s*True/.test(code) ? "POST" : "GET",
      tr_ids: trIds,
      body,
      required,
      params: Object.fromEntries(
        Object.entries(def.params ?? {}).map(([n, p]) => [n, { required: !!p.required, default: p.default_value ?? null }]),
      ),
    };
  }
}

writeFileSync(outFile, JSON.stringify({ generated: new Date().toISOString(), source: "koreainvestment/open-trading-api (examples_llm)", apis }, null, 2) + "\n");
console.log(`wrote ${outFile}`);
console.log(`  apis: ${Object.keys(apis).length}`);
console.log(`  missing examples: ${missingExamples.length}`);
console.log(`  parse errors: ${parseErrors.length}`);
if (missingExamples.length) console.log(`  missing: ${missingExamples.slice(0, 20).join(", ")}`);
if (parseErrors.length) console.log(`  errors: ${parseErrors.slice(0, 20).join(", ")}`);
