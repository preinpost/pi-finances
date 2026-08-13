export type SecretGroup = "llm" | "broker" | "market";

export interface SecretField {
  key: string;
  group: SecretGroup;
  label: string;
  hint?: string;
  secret?: boolean;
}

/** UI에서 다루는 env 키 — 화이트리스트. 그 외는 저장하지 않는다. */
export const SECRET_FIELDS: SecretField[] = [
  { key: "ANTHROPIC_API_KEY", group: "llm", label: "Anthropic", secret: true },
  { key: "OPENAI_API_KEY", group: "llm", label: "OpenAI", secret: true },
  { key: "OPENROUTER_API_KEY", group: "llm", label: "OpenRouter", secret: true },
  { key: "DEEPSEEK_API_KEY", group: "llm", label: "DeepSeek", secret: true },
  { key: "GEMINI_API_KEY", group: "llm", label: "Google Gemini", secret: true },
  { key: "XAI_API_KEY", group: "llm", label: "xAI (Grok)", secret: true },
  { key: "GROQ_API_KEY", group: "llm", label: "Groq", secret: true },
  { key: "MISTRAL_API_KEY", group: "llm", label: "Mistral", secret: true },
  { key: "KIS_APP_KEY", group: "broker", label: "KIS App Key", secret: true },
  { key: "KIS_APP_SECRET", group: "broker", label: "KIS App Secret", secret: true },
  { key: "KIS_ACCT_STOCK", group: "broker", label: "KIS 계좌번호" },
  { key: "KIS_PAPER_APP_KEY", group: "broker", label: "KIS Paper App Key", secret: true },
  { key: "KIS_PAPER_APP_SECRET", group: "broker", label: "KIS Paper App Secret", secret: true },
  { key: "KIS_PAPER_STOCK", group: "broker", label: "KIS 모의 계좌번호" },
  { key: "TOSS_CLIENT_ID", group: "broker", label: "Toss Client ID" },
  { key: "TOSS_CLIENT_SECRET", group: "broker", label: "Toss Client Secret", secret: true },
  { key: "TWELVE_API_KEY", group: "market", label: "Twelve Data", secret: true },
  { key: "FINNHUB_API_KEY", group: "market", label: "Finnhub", secret: true },
  { key: "COINGECKO_API_KEY", group: "market", label: "CoinGecko", secret: true },
  { key: "NAVER_CLIENT_ID", group: "market", label: "Naver Client ID" },
  { key: "NAVER_CLIENT_SECRET", group: "market", label: "Naver Client Secret", secret: true },
];

export const SECRET_GROUPS: { id: SecretGroup; labelKey: "keysGroupLlm" | "keysGroupBroker" | "keysGroupMarket" }[] = [
  { id: "llm", labelKey: "keysGroupLlm" },
  { id: "broker", labelKey: "keysGroupBroker" },
  { id: "market", labelKey: "keysGroupMarket" },
];

export const SECRET_KEY_SET = new Set(SECRET_FIELDS.map((f) => f.key));

export interface UISecretStatus {
  key: string;
  configured: boolean;
  source: "env" | "none";
}

export interface UISecretsResponse {
  fields: UISecretStatus[];
  persistable: boolean;
}

export interface UISecretsSaveRequest {
  values: Record<string, string>;
}

export interface UISecretsSaveResponse extends UISecretsResponse {
  warning?: string;
}

export interface ProviderPreset {
  key: string;
  label: string;
  baseUrl: string;
  api: "openai-completions" | "openai-responses" | "anthropic-messages" | "google-generative-ai";
  apiKeyEnv?: string;
  models: { id: string; name?: string; reasoning?: boolean }[];
}

export const PROVIDER_PRESETS: ProviderPreset[] = [
  {
    key: "ollama",
    label: "Ollama",
    baseUrl: "http://localhost:11434/v1",
    api: "openai-completions",
    apiKeyEnv: "",
    models: [{ id: "llama3.1", name: "Llama 3.1" }],
  },
  {
    key: "lmstudio",
    label: "LM Studio",
    baseUrl: "http://localhost:1234/v1",
    api: "openai-completions",
    models: [{ id: "local-model", name: "Local model" }],
  },
  {
    key: "openrouter-custom",
    label: "OpenRouter (custom)",
    baseUrl: "https://openrouter.ai/api/v1",
    api: "openai-completions",
    apiKeyEnv: "$OPENROUTER_API_KEY",
    models: [{ id: "anthropic/claude-sonnet-4", name: "Claude Sonnet 4" }],
  },
];
