import type { UserSettings } from "@/lib/settings-store";

const STORAGE_KEY = "gitrack:llm-settings";
const PROFILES_KEY = "gitrack:llm-provider-profiles";
const BOOKMARKS_KEY = "gitrack:repo-bookmarks";
const GITHUB_MCP_CONTEXT_KEY = "gitrack:github-mcp-review-context";

export type LlmSettings = Omit<UserSettings, "github_token">;
export type LlmProvider = "anthropic" | "groq" | "ollama" | "openai" | "vertex" | "vllm";
export type ProviderProfile = {
    id: string;
    name: string;
    provider: LlmProvider;
    settings: Partial<LlmSettings>;
};
export type ProviderProfiles = {
    profiles: ProviderProfile[];
    activeProfileId: string | null;
};

const PROVIDER_FIELDS: Record<LlmProvider, string[]> = {
    anthropic: ["anthropic_api_key", "anthropic_model"],
    groq: ["groq_api_key", "groq_model"],
    ollama: ["ollama_host", "ollama_model"],
    openai: ["openai_api_key", "openai_model"],
    vertex: ["vertex_project_id", "vertex_region", "vertex_model", "vertex_sa_key"],
    vllm: ["vllm_host", "vllm_model", "vllm_api_key"],
};

const REQUIRED_PROVIDER_FIELDS: Record<LlmProvider, string[]> = {
    anthropic: ["anthropic_api_key"],
    groq: ["groq_api_key"],
    ollama: ["ollama_host"],
    openai: ["openai_api_key"],
    vertex: ["vertex_project_id", "vertex_sa_key"],
    vllm: ["vllm_host"],
};

export type RepoBookmark = {
    owner: string;
    repo: string;
};

export function readLlmSettings(): { settings: LlmSettings; error: string | null } {
    if (typeof window === "undefined") return { settings: {}, error: null };
    try {
        const raw = localStorage.getItem(STORAGE_KEY);
        return { settings: raw ? (JSON.parse(raw) as LlmSettings) : {}, error: null };
    } catch {
        return { settings: {}, error: "Browser storage is unavailable; saved provider keys could not be read." };
    }
}

// ---- LLM Settings (localStorage) ----

export function loadLlmSettings(): LlmSettings {
    const { value } = readProviderProfiles();
    const active = value.profiles.find((profile) => profile.id === value.activeProfileId) ?? value.profiles[0];
    return active ? { ...active.settings, llm_provider: active.provider } as LlmSettings : {};
}

export function saveLlmSettings(settings: LlmSettings): void {
    if (typeof window === "undefined") return;
    localStorage.setItem(STORAGE_KEY, JSON.stringify(settings));
}

function migrateLegacySettings(legacy: LlmSettings): ProviderProfiles {
    const profiles: ProviderProfile[] = [];
    for (const [provider, fields] of Object.entries(PROVIDER_FIELDS) as [LlmProvider, string[]][]) {
        if (!REQUIRED_PROVIDER_FIELDS[provider].every((key) => Boolean(legacy[key as keyof LlmSettings]))) continue;
        const settings: Partial<LlmSettings> = {};
        for (const key of fields) {
            const value = legacy[key as keyof LlmSettings];
            if (typeof value === "string" && value.trim()) settings[key as keyof LlmSettings] = value;
        }
        const model = settings[`${provider}_model` as keyof LlmSettings];
        const endpoint = provider === "vllm" ? settings.vllm_host : provider === "ollama" ? settings.ollama_host : undefined;
        profiles.push({
            id: `legacy-${provider}`,
            name: `${provider === "vllm" ? "vLLM" : provider[0].toUpperCase() + provider.slice(1)}${model ? ` · ${model}` : endpoint ? ` · ${endpoint}` : ""}`,
            provider,
            settings,
        });
    }
    const activeProvider = legacy.llm_provider as LlmProvider | undefined;
    return {
        profiles,
        activeProfileId: profiles.find((profile) => profile.provider === activeProvider)?.id ?? profiles[0]?.id ?? null,
    };
}

export function readProviderProfiles(): { value: ProviderProfiles; error: string | null } {
    if (typeof window === "undefined") return { value: { profiles: [], activeProfileId: null }, error: null };
    try {
        const rawProfiles = localStorage.getItem(PROFILES_KEY);
        if (rawProfiles !== null) return { value: JSON.parse(rawProfiles) as ProviderProfiles, error: null };

        // Upgrade existing single-provider settings without discarding saved credentials.
        const rawLegacy = localStorage.getItem(STORAGE_KEY);
        const legacy = rawLegacy ? JSON.parse(rawLegacy) as LlmSettings : {};
        const value = migrateLegacySettings(legacy);
        localStorage.setItem(PROFILES_KEY, JSON.stringify(value));
        return { value, error: null };
    } catch {
        return { value: { profiles: [], activeProfileId: null }, error: "Browser storage is unavailable; saved provider profiles could not be read." };
    }
}

export function saveProviderProfiles(value: ProviderProfiles): void {
    if (typeof window === "undefined") return;
    localStorage.setItem(PROFILES_KEY, JSON.stringify(value));
}

export function activateProviderProfile(profileId: string): ProviderProfiles {
    const { value, error } = readProviderProfiles();
    if (error) throw new Error(error);
    if (!value.profiles.some((profile) => profile.id === profileId)) throw new Error("That provider profile is no longer available.");
    const next = { ...value, activeProfileId: profileId };
    saveProviderProfiles(next);
    return next;
}

export function clearLlmSettings(): void {
    if (typeof window === "undefined") return;
    localStorage.removeItem(STORAGE_KEY);
    localStorage.removeItem(PROFILES_KEY);
}

const COMMENT_HEADING_KEY = "gitrack:review-comment-heading";

/** Default true. When false, GitHub comments are posted without the [Severity] Title line. */
export function loadReviewCommentHeading(): boolean {
    if (typeof window === "undefined") return true;
    try {
        return localStorage.getItem(COMMENT_HEADING_KEY) !== "false";
    } catch {
        return true;
    }
}

export function saveReviewCommentHeading(include: boolean): void {
    if (typeof window === "undefined") return;
    localStorage.setItem(COMMENT_HEADING_KEY, String(include));
}

export function loadGithubMcpReviewContext(): boolean {
    if (typeof window === "undefined") return false;
    try {
        return localStorage.getItem(GITHUB_MCP_CONTEXT_KEY) === "true";
    } catch {
        return false;
    }
}

export function saveGithubMcpReviewContext(enabled: boolean): void {
    if (typeof window === "undefined") return;
    localStorage.setItem(GITHUB_MCP_CONTEXT_KEY, String(enabled));
}

export function buildLlmHeaders(): Record<string, string> {
    const settings = loadLlmSettings();
    const filled = Object.fromEntries(
        Object.entries(settings).filter(([, v]) => typeof v === "string" && v.trim()),
    );
    if (Object.keys(filled).length === 0) return {};
    return { "X-LLM-Settings": btoa(unescape(encodeURIComponent(JSON.stringify(filled)))) };
}

// ---- Repo Bookmarks (localStorage) ----

export function loadBookmarks(): RepoBookmark[] {
    if (typeof window === "undefined") return [];
    try {
        const raw = localStorage.getItem(BOOKMARKS_KEY);
        return raw ? (JSON.parse(raw) as RepoBookmark[]) : [];
    } catch {
        return [];
    }
}

export function saveBookmark(owner: string, repo: string): RepoBookmark[] {
    const bookmarks = loadBookmarks();
    const exists = bookmarks.some(
        (b) => b.owner.toLowerCase() === owner.toLowerCase() && b.repo.toLowerCase() === repo.toLowerCase(),
    );
    if (!exists) {
        bookmarks.push({ owner, repo });
        localStorage.setItem(BOOKMARKS_KEY, JSON.stringify(bookmarks));
    }
    return bookmarks;
}

export function removeBookmark(owner: string, repo: string): RepoBookmark[] {
    const bookmarks = loadBookmarks().filter(
        (b) => !(b.owner.toLowerCase() === owner.toLowerCase() && b.repo.toLowerCase() === repo.toLowerCase()),
    );
    localStorage.setItem(BOOKMARKS_KEY, JSON.stringify(bookmarks));
    return bookmarks;
}

// ---- Review Rules (localStorage, per-repo) ----

const RULES_KEY = "gitrack:review-rules";

export type SavedRule = {
    name: string;
    prompt: string;
};

type RulesStore = Record<string, SavedRule[]>;

function repoKey(owner: string, repo: string): string {
    return `${owner.toLowerCase()}/${repo.toLowerCase()}`;
}

function loadRulesStore(): RulesStore {
    if (typeof window === "undefined") return {};
    try {
        const raw = localStorage.getItem(RULES_KEY);
        return raw ? (JSON.parse(raw) as RulesStore) : {};
    } catch {
        return {};
    }
}

function saveRulesStore(store: RulesStore): void {
    if (typeof window === "undefined") return;
    localStorage.setItem(RULES_KEY, JSON.stringify(store));
}

export function loadReviewRules(owner: string, repo: string): SavedRule[] {
    return loadRulesStore()[repoKey(owner, repo)] ?? [];
}

export function saveReviewRule(owner: string, repo: string, name: string, prompt: string): SavedRule[] {
    const store = loadRulesStore();
    const key = repoKey(owner, repo);
    const existing = store[key] ?? [];
    const idx = existing.findIndex((r) => r.name === name);
    const rule: SavedRule = { name, prompt };
    if (idx >= 0) existing[idx] = rule;
    else existing.push(rule);
    store[key] = existing;
    saveRulesStore(store);
    return existing;
}

export function deleteReviewRule(owner: string, repo: string, name: string): SavedRule[] {
    const store = loadRulesStore();
    const key = repoKey(owner, repo);
    const existing = store[key] ?? [];
    store[key] = existing.filter((r) => r.name !== name);
    saveRulesStore(store);
    return store[key];
}

// ---- Repo URL parsing ----

export function parseRepoInput(input: string): { owner: string; repo: string } | null {
    const trimmed = input.trim().replace(/\/+$/, "");
    if (!trimmed) return null;

    // https://github.com/owner/repo or github.com/owner/repo
    const urlMatch = trimmed.match(
        /^(?:https?:\/\/)?github\.com\/([^/\s]+)\/([^/\s#?]+)/,
    );
    if (urlMatch) {
        return { owner: urlMatch[1], repo: urlMatch[2].replace(/\.git$/, "") };
    }

    // owner/repo
    const slashMatch = trimmed.match(/^([^/\s]+)\/([^/\s]+)$/);
    if (slashMatch) {
        return { owner: slashMatch[1], repo: slashMatch[2].replace(/\.git$/, "") };
    }

    return null;
}
