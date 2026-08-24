export type Messages = {
  // common / chrome
  connected: string;
  connecting: string;
  connectingHint: string;
  connectionLost: string;
  disconnected: string;
  settings: string;
  theme: string;
  themeSystem: string;
  themeLight: string;
  themeDark: string;
  language: string;

  // sessions
  sessions: string;
  newSession: string;
  emptySession: string;
  messageCount: string;
  noSavedSessions: string;
  sessionList: string;
  pinSidebar: string;
  unpinSidebar: string;
  closeSidebar: string;
  deleteSession: string;
  confirmDeleteSession: string;

  // composer
  sendMessage: string;
  streamingPlaceholder: string;
  attachImage: string;
  removeImage: string;
  send: string;
  steer: string;
  abort: string;

  // model
  selectModel: string;
  searchModels: string;
  clearSearch: string;
  noModelsAvailable: string;
  noSearchResults: string;

  // fork
  forkSession: string;
  forkSessionEllipsis: string;
  forkDescription: string;
  emptyMessage: string;
  noForkPoints: string;

  // extensions
  activeExtensions: string;
  activeExtensionsEllipsis: string;
  extensionsLoaded: string;
  extensionsLoading: string;
  loadFailures: string;
  noExtensionsLoaded: string;
  scopeUser: string;
  scopeProject: string;
  scopeTemporary: string;
  tools: string;
  commands: string;
  flags: string;
  events: string;

  save: string;
  saving: string;
  saved: string;
  cancel: string;

  // keys
  manageKeys: string;
  manageKeysEllipsis: string;
  keysGroupLlm: string;
  keysGroupBroker: string;
  keysGroupMarket: string;
  keysConfigured: string;
  keysMissing: string;
  keysKeepPlaceholder: string;
  keysPersistHint: string;
  keysMemoryHint: string;
  keysSaveHint: string;
  keysNothingToSave: string;

  manageProviders: string;
  manageProvidersEllipsis: string;
  manageProvidersHint: string;
  searchProviders: string;
  providerSignedIn: string;
  providerSignedOut: string;
  providerLoginOAuth: string;
  providerLoginKey: string;
  providerLogout: string;
  providerCancel: string;
  providerLoginDone: string;
  noProviders: string;

  // messages
  emptyPrompt: string;
  emptyTitle: string;
  emptySubtitle: string;
  suggest1: string;
  suggest2: string;
  suggest3: string;
  suggest4: string;
  thinking: string;
  noOutput: string;
  sendHint: string;
  copy: string;
  copied: string;
  retry: string;
  sources: string;
  attachedImage: string;
  imagePlaceholder: string;

  // auth
  loginTitle: string;
  loginSubtitle: string;
  loginUser: string;
  loginPassword: string;
  loginSubmit: string;
  loginSubmitting: string;
  loginFailed: string;
  loginTooMany: string;
  logout: string;
  appVersion: string;
};

export const en: Messages = {
  connected: "Connected",
  connecting: "Connecting…",
  connectingHint: "Connecting to AlphaFolio…",
  connectionLost: "Can't reach the server. Retrying…",
  disconnected: "Disconnected",
  settings: "Settings",
  theme: "Theme",
  themeSystem: "System",
  themeLight: "Light",
  themeDark: "Dark",
  language: "Language",

  sessions: "Sessions",
  newSession: "New session",
  emptySession: "(empty session)",
  messageCount: "{count} messages",
  noSavedSessions: "No saved sessions",
  sessionList: "Session list",
  pinSidebar: "Pin sidebar",
  unpinSidebar: "Unpin sidebar",
  closeSidebar: "Close sidebar",
  deleteSession: "Delete session",
  confirmDeleteSession: "Delete this session? This cannot be undone.",

  sendMessage: "Send a message",
  streamingPlaceholder: "Streaming… (send to steer)",
  attachImage: "Attach image",
  removeImage: "Remove image",
  send: "Send",
  steer: "Steer",
  abort: "Stop",

  selectModel: "Select model",
  searchModels: "Search models…",
  clearSearch: "Clear search",
  noModelsAvailable: "No models available",
  noSearchResults: "No results",

  forkSession: "Fork session",
  forkSessionEllipsis: "Fork session…",
  forkDescription:
    "Creates a new session up to the selected message. The message text is filled back into the composer.",
  emptyMessage: "(empty message)",
  noForkPoints: "No user messages to fork from",

  activeExtensions: "Active extensions",
  activeExtensionsEllipsis: "Active extensions…",
  extensionsLoaded: "{count} extensions loaded in this session.",
  extensionsLoading: "Loading extensions for this session…",
  loadFailures: "{count} load failures",
  noExtensionsLoaded: "No extensions loaded",
  scopeUser: "User",
  scopeProject: "Project",
  scopeTemporary: "Temporary",
  tools: "Tools",
  commands: "Commands",
  flags: "Flags",
  events: "Events",

  save: "Save",
  saving: "Saving…",
  saved: "Saved",
  cancel: "Cancel",

  manageKeys: "API keys",
  manageKeysEllipsis: "API keys…",
  keysGroupLlm: "LLM providers",
  keysGroupBroker: "Brokers",
  keysGroupMarket: "Market data",
  keysConfigured: "Set",
  keysMissing: "Missing",
  keysKeepPlaceholder: "Leave blank to keep",
  keysPersistHint: "Saved to the local .env file. Existing values stay hidden.",
  keysMemoryHint: "No .env file — keys apply to this process only.",
  keysSaveHint: "Only filled fields are written. Blank keeps the current value.",
  keysNothingToSave: "Enter at least one new value.",

  manageProviders: "Providers",
  manageProvidersEllipsis: "Providers…",
  manageProvidersHint: "Same as /login and /logout in pi. Keys go to ~/.pi/agent/auth.json.",
  searchProviders: "Search providers…",
  providerSignedIn: "Signed in",
  providerSignedOut: "Not signed in",
  providerLoginOAuth: "Subscribe / OAuth",
  providerLoginKey: "API key",
  providerLogout: "Log out",
  providerCancel: "Cancel login",
  providerLoginDone: "Signed in.",
  noProviders: "No providers",

  emptyPrompt: "How can I help?",
  emptyTitle: "What can I help you with?",
  emptySubtitle: "Ask AlphaFolio about markets, research, and analysis.",
  suggest1: "Samsung Electronics price today",
  suggest2: "Analyze the current KOSPI market",
  suggest3: "Screen top AI-sector stocks",
  suggest4: "Review my portfolio",
  thinking: "Thinking",
  noOutput: "(no output)",
  sendHint: "Enter to send · Shift+Enter for newline",
  copy: "Copy",
  copied: "Copied",
  retry: "Retry",
  sources: "{count} sources",
  attachedImage: "Attached image",
  imagePlaceholder: "[image]",

  loginTitle: "AlphaFolio",
  loginSubtitle: "Enter the password for this workspace.",
  loginUser: "Username",
  loginPassword: "Password",
  loginSubmit: "Continue",
  loginSubmitting: "Signing in…",
  loginFailed: "Wrong username or password.",
  loginTooMany: "Too many attempts. Try again in a few minutes.",
  logout: "Sign out",
  appVersion: "Version",
};
