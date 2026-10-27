"use client";

import { useCallback, useEffect, useState } from "react";
import { useAuth } from "@/components/AuthContext";
import { activateProviderProfile, readProviderProfiles, saveProviderProfiles, clearLlmSettings, loadReviewCommentHeading, saveReviewCommentHeading, loadGithubMcpReviewContext, saveGithubMcpReviewContext, type LlmProvider, type ProviderProfile } from "@/lib/client-settings";
import Link from "next/link";

type FieldConfig = {
    key: string;
    label: string;
    placeholder: string;
    sensitive: boolean;
    multiline?: boolean;
    provider?: string;
};

const FIELDS: FieldConfig[] = [
    { key: "anthropic_api_key", label: "Anthropic API Key", placeholder: "sk-ant-...", sensitive: true, provider: "anthropic" },
    { key: "anthropic_model", label: "Anthropic Model", placeholder: "claude-3-5-sonnet-20241022", sensitive: false, provider: "anthropic" },
    { key: "groq_api_key", label: "Groq API Key", placeholder: "gsk_...", sensitive: true, provider: "groq" },
    { key: "groq_model", label: "Groq Model", placeholder: "llama3-70b-8192", sensitive: false, provider: "groq" },
    { key: "ollama_host", label: "Ollama Host", placeholder: "http://localhost:11434", sensitive: false, provider: "ollama" },
    { key: "ollama_model", label: "Ollama Model", placeholder: "llama3", sensitive: false, provider: "ollama" },
    { key: "openai_api_key", label: "OpenAI API Key", placeholder: "sk-...", sensitive: true, provider: "openai" },
    { key: "openai_model", label: "OpenAI Model", placeholder: "gpt-5.6-luna", sensitive: false, provider: "openai" },
    { key: "vertex_project_id", label: "Vertex Project ID", placeholder: "my-gcp-project", sensitive: false, provider: "vertex" },
    { key: "vertex_region", label: "Vertex Region", placeholder: "us-east5", sensitive: false, provider: "vertex" },
    { key: "vertex_model", label: "Vertex Model", placeholder: "claude-sonnet-4@20250514", sensitive: false, provider: "vertex" },
    { key: "vertex_sa_key", label: "Vertex SA Key (JSON)", placeholder: "Paste your service account key JSON here", sensitive: true, multiline: true, provider: "vertex" },
    { key: "vllm_host", label: "vLLM Host", placeholder: "http://localhost:8000", sensitive: false, provider: "vllm" },
    { key: "vllm_model", label: "vLLM Model", placeholder: "Model name served by vLLM", sensitive: false, provider: "vllm" },
    { key: "vllm_api_key", label: "vLLM API Key (optional)", placeholder: "API key if auth is enabled", sensitive: true, provider: "vllm" },
];

const PROVIDERS = [
    { value: "anthropic", label: "Anthropic", required: ["anthropic_api_key"] },
    { value: "groq", label: "Groq", required: ["groq_api_key"] },
    { value: "ollama", label: "Ollama", required: ["ollama_host"] },
    { value: "openai", label: "OpenAI", required: ["openai_api_key"] },
    { value: "vertex", label: "Vertex AI", required: ["vertex_project_id", "vertex_sa_key"] },
    { value: "vllm", label: "vLLM", required: ["vllm_host"] },
] as const;

const PR_SIZES = ["XS", "S", "M", "L", "XL", "XXL"] as const;
type PrSizeLabel = (typeof PR_SIZES)[number];

type AssignmentRule = {
    id: string;
    name: string;
    enabled: boolean;
    sizes: PrSizeLabel[];
    keywords: string[];
    reviewers: string[];
};

type TeamMember = { login: string; avatar_url: string };

function AssignmentRulesSection({ user }: { user: { login: string } }) {
    const [repoInput, setRepoInput] = useState("");
    const [activeRepo, setActiveRepo] = useState<{ owner: string; repo: string } | null>(null);
    const [team, setTeam] = useState<TeamMember[]>([]);
    const [teamLoading, setTeamLoading] = useState(false);
    const [rules, setRules] = useState<AssignmentRule[]>([]);
    const [rulesLoading, setRulesLoading] = useState(false);
    const [saving, setSaving] = useState(false);
    const [message, setMessage] = useState<{ type: "success" | "error"; text: string } | null>(null);

    const loadRepoData = useCallback(async (owner: string, repo: string) => {
        setTeamLoading(true);
        setRulesLoading(true);
        setMessage(null);
        try {
            const [teamRes, rulesRes] = await Promise.all([
                fetch(`/api/team?owner=${encodeURIComponent(owner)}&repo=${encodeURIComponent(repo)}`),
                fetch(`/api/assignment-rules?owner=${encodeURIComponent(owner)}&repo=${encodeURIComponent(repo)}`),
            ]);
            if (!teamRes.ok) {
                const err = (await teamRes.json()) as { error?: string };
                throw new Error(err.error ?? "Failed to load team");
            }
            const teamJson = (await teamRes.json()) as { team: TeamMember[] };
            setTeam(teamJson.team);

            if (rulesRes.ok) {
                const rulesJson = (await rulesRes.json()) as { rules: AssignmentRule[] };
                setRules(rulesJson.rules);
            }
        } catch (e) {
            setMessage({ type: "error", text: e instanceof Error ? e.message : "Failed to load repo data" });
        } finally {
            setTeamLoading(false);
            setRulesLoading(false);
        }
    }, []);

    const handleLoadRepo = () => {
        const parts = repoInput.trim().split("/");
        if (parts.length !== 2 || !parts[0] || !parts[1]) {
            setMessage({ type: "error", text: "Enter repo as owner/repo" });
            return;
        }
        const [owner, repo] = parts;
        setActiveRepo({ owner, repo });
        void loadRepoData(owner, repo);
    };

    const addRule = () => {
        setRules((prev) => [
            ...prev,
            {
                id: crypto.randomUUID(),
                name: `Rule ${prev.length + 1}`,
                enabled: true,
                sizes: [],
                keywords: [],
                reviewers: [],
            },
        ]);
    };

    const updateRule = (id: string, patch: Partial<AssignmentRule>) => {
        setRules((prev) => prev.map((r) => (r.id === id ? { ...r, ...patch } : r)));
    };

    const removeRule = (id: string) => {
        setRules((prev) => prev.filter((r) => r.id !== id));
    };

    const handleSaveRules = async () => {
        if (!activeRepo) return;
        setSaving(true);
        setMessage(null);
        try {
            const res = await fetch("/api/assignment-rules", {
                method: "POST",
                headers: { "content-type": "application/json" },
                body: JSON.stringify({ owner: activeRepo.owner, repo: activeRepo.repo, rules }),
            });
            const json = (await res.json()) as { success?: boolean; error?: string };
            if (!res.ok) throw new Error(json.error ?? "Failed to save rules");
            setMessage({ type: "success", text: "Assignment rules saved." });
        } catch (e) {
            setMessage({ type: "error", text: e instanceof Error ? e.message : "Failed to save rules" });
        } finally {
            setSaving(false);
        }
    };

    const inputCls = "rounded-md border border-slate-300 bg-white px-3 py-2 text-sm outline-none ring-emerald-500/40 placeholder:text-slate-400 focus:ring-2 dark:border-slate-700 dark:bg-slate-950 dark:placeholder:text-slate-600";

    return (
        <section className="rounded-xl border border-slate-200 bg-white/60 p-6 dark:border-slate-800 dark:bg-slate-950/40">
            <h2 className="mb-1 text-sm font-semibold text-slate-900 dark:text-slate-100">PR Auto-Assignment Rules</h2>
            <p className="mb-4 text-xs text-slate-500">
                Automatically assign reviewers to PRs based on size and keywords.
            </p>

            <div className="flex items-end gap-2">
                <label className="flex flex-1 flex-col gap-1">
                    <span className="text-xs font-medium text-slate-600 dark:text-slate-400">Repository</span>
                    <input
                        type="text"
                        className={inputCls}
                        placeholder="owner/repo"
                        value={repoInput}
                        onChange={(e) => setRepoInput(e.target.value)}
                        onKeyDown={(e) => { if (e.key === "Enter") handleLoadRepo(); }}
                    />
                </label>
                <button
                    type="button"
                    className="rounded-md bg-emerald-600 px-4 py-2 text-sm font-medium text-white hover:bg-emerald-500 dark:bg-emerald-500 dark:hover:bg-emerald-400"
                    onClick={handleLoadRepo}
                >
                    Load
                </button>
            </div>

            {(teamLoading || rulesLoading) && (
                <p className="mt-4 text-sm text-slate-500">Loading...</p>
            )}

            {activeRepo && !teamLoading && !rulesLoading && (
                <div className="mt-5 flex flex-col gap-4">
                    <div>
                        <h3 className="text-xs font-medium text-slate-600 dark:text-slate-400">
                            Team Members ({team.length})
                        </h3>
                        <div className="mt-2 flex flex-wrap gap-2">
                            {team.map((m) => (
                                <span key={m.login} className="inline-flex items-center gap-1.5 rounded-full border border-slate-200 bg-slate-50 px-2.5 py-1 text-xs dark:border-slate-700 dark:bg-slate-900">
                                    <img src={m.avatar_url} alt="" className="h-4 w-4 rounded-full" referrerPolicy="no-referrer" />
                                    {m.login}
                                </span>
                            ))}
                            {team.length === 0 && (
                                <span className="text-xs text-slate-400">No collaborators found</span>
                            )}
                        </div>
                    </div>

                    <div className="border-t border-slate-200 pt-4 dark:border-slate-800">
                        <div className="flex items-center justify-between">
                            <h3 className="text-xs font-medium text-slate-600 dark:text-slate-400">Rules</h3>
                            <button
                                type="button"
                                className="rounded-md border border-slate-300 px-3 py-1 text-xs font-medium hover:bg-slate-100 dark:border-slate-700 dark:hover:bg-slate-900"
                                onClick={addRule}
                            >
                                + Add Rule
                            </button>
                        </div>

                        {rules.length === 0 && (
                            <p className="mt-3 text-xs text-slate-400">No rules yet. Add one to get started.</p>
                        )}

                        <div className="mt-3 flex flex-col gap-4">
                            {rules.map((rule) => (
                                <RuleCard
                                    key={rule.id}
                                    rule={rule}
                                    team={team}
                                    onUpdate={(patch) => updateRule(rule.id, patch)}
                                    onRemove={() => removeRule(rule.id)}
                                    inputCls={inputCls}
                                />
                            ))}
                        </div>
                    </div>

                    {message && (
                        <div className={`rounded-md border px-3 py-2 text-sm ${
                            message.type === "success"
                                ? "border-emerald-300 bg-emerald-50 text-emerald-800 dark:border-emerald-700 dark:bg-emerald-950/40 dark:text-emerald-200"
                                : "border-rose-300 bg-rose-50 text-rose-800 dark:border-rose-900/60 dark:bg-rose-950/40 dark:text-rose-100"
                        }`}>
                            {message.text}
                        </div>
                    )}

                    <div className="flex items-center gap-3">
                        <button
                            type="button"
                            className="rounded-md bg-emerald-600 px-4 py-2 text-sm font-medium text-white hover:bg-emerald-500 disabled:opacity-40"
                            disabled={saving}
                            onClick={() => void handleSaveRules()}
                        >
                            {saving ? "Saving..." : "Save Rules"}
                        </button>
                    </div>
                </div>
            )}
        </section>
    );
}

function RuleCard({
    rule,
    team,
    onUpdate,
    onRemove,
    inputCls,
}: {
    rule: AssignmentRule;
    team: TeamMember[];
    onUpdate: (patch: Partial<AssignmentRule>) => void;
    onRemove: () => void;
    inputCls: string;
}) {
    const [keywordInput, setKeywordInput] = useState("");

    const addKeyword = () => {
        const kw = keywordInput.trim();
        if (kw && !rule.keywords.includes(kw)) {
            onUpdate({ keywords: [...rule.keywords, kw] });
        }
        setKeywordInput("");
    };

    const removeKeyword = (kw: string) => {
        onUpdate({ keywords: rule.keywords.filter((k) => k !== kw) });
    };

    const sizes = rule.sizes ?? [];

    const toggleSize = (size: PrSizeLabel) => {
        if (sizes.includes(size)) {
            onUpdate({ sizes: sizes.filter((s) => s !== size) });
        } else {
            onUpdate({ sizes: [...sizes, size] });
        }
    };

    const toggleReviewer = (login: string) => {
        if (rule.reviewers.includes(login)) {
            onUpdate({ reviewers: rule.reviewers.filter((r) => r !== login) });
        } else {
            onUpdate({ reviewers: [...rule.reviewers, login] });
        }
    };

    return (
        <div className="rounded-lg border border-slate-200 p-4 dark:border-slate-700">
            <div className="flex items-center justify-between gap-3">
                <input
                    type="text"
                    className={`${inputCls} flex-1 font-medium`}
                    value={rule.name}
                    onChange={(e) => onUpdate({ name: e.target.value })}
                />
                <label className="flex items-center gap-1.5 text-xs">
                    <input
                        type="checkbox"
                        checked={rule.enabled}
                        onChange={(e) => onUpdate({ enabled: e.target.checked })}
                        className="h-3.5 w-3.5 rounded border-slate-300"
                    />
                    Enabled
                </label>
                <button
                    type="button"
                    className="rounded p-1 text-rose-500 hover:bg-rose-50 dark:hover:bg-rose-950/30"
                    onClick={onRemove}
                    title="Remove rule"
                >
                    <svg className="h-4 w-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                    </svg>
                </button>
            </div>

            <div className="mt-3">
                <span className="text-xs text-slate-500">PR sizes (empty = match all sizes)</span>
                <div className="mt-2 flex flex-wrap gap-2">
                    {PR_SIZES.map((size) => {
                        const selected = sizes.includes(size);
                        return (
                            <button
                                key={size}
                                type="button"
                                className={`rounded-full border px-2.5 py-1 text-xs font-semibold transition-colors ${
                                    selected
                                        ? "border-cyan-400 bg-cyan-50 text-cyan-700 dark:border-cyan-600 dark:bg-cyan-950/40 dark:text-cyan-300"
                                        : "border-slate-200 bg-slate-50 text-slate-500 hover:border-slate-300 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-400"
                                }`}
                                onClick={() => toggleSize(size)}
                            >
                                {size}
                            </button>
                        );
                    })}
                </div>
            </div>

            <div className="mt-3">
                <span className="text-xs text-slate-500">Keywords (matches PR title)</span>
                <div className="mt-1 flex items-center gap-2">
                    <input
                        type="text"
                        className={`${inputCls} flex-1`}
                        placeholder="Add keyword..."
                        value={keywordInput}
                        onChange={(e) => setKeywordInput(e.target.value)}
                        onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); addKeyword(); } }}
                    />
                    <button
                        type="button"
                        className="rounded-md border border-slate-300 px-3 py-2 text-xs font-medium hover:bg-slate-100 dark:border-slate-700 dark:hover:bg-slate-900"
                        onClick={addKeyword}
                    >
                        Add
                    </button>
                </div>
                {rule.keywords.length > 0 && (
                    <div className="mt-2 flex flex-wrap gap-1.5">
                        {rule.keywords.map((kw) => (
                            <span key={kw} className="inline-flex items-center gap-1 rounded-full bg-cyan-50 px-2 py-0.5 text-xs text-cyan-700 dark:bg-cyan-950/40 dark:text-cyan-300">
                                {kw}
                                <button type="button" onClick={() => removeKeyword(kw)} className="hover:text-cyan-900 dark:hover:text-cyan-100">&times;</button>
                            </span>
                        ))}
                    </div>
                )}
                {rule.keywords.length === 0 && (
                    <p className="mt-1 text-xs text-slate-400">No keywords = matches any PR title</p>
                )}
            </div>

            <div className="mt-3">
                <span className="text-xs text-slate-500">Assign to reviewers</span>
                <div className="mt-2 flex flex-wrap gap-2">
                    {team.map((m) => {
                        const selected = rule.reviewers.includes(m.login);
                        return (
                            <button
                                key={m.login}
                                type="button"
                                className={`inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-xs transition-colors ${
                                    selected
                                        ? "border-emerald-400 bg-emerald-50 text-emerald-700 dark:border-emerald-600 dark:bg-emerald-950/40 dark:text-emerald-300"
                                        : "border-slate-200 bg-slate-50 text-slate-600 hover:border-slate-300 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-400"
                                }`}
                                onClick={() => toggleReviewer(m.login)}
                            >
                                <img src={m.avatar_url} alt="" className="h-4 w-4 rounded-full" referrerPolicy="no-referrer" />
                                {m.login}
                            </button>
                        );
                    })}
                </div>
            </div>
        </div>
    );
}

export default function SettingsPage() {
    const { user, loading: authLoading } = useAuth();

    const [profiles, setProfiles] = useState<ProviderProfile[]>([]);
    const [activeProfileId, setActiveProfileId] = useState<string | null>(null);
    const [editingProfileId, setEditingProfileId] = useState<string | null>(null);
    const [draftName, setDraftName] = useState("");
    const [draftProvider, setDraftProvider] = useState<LlmProvider | "">("");
    const [draftValues, setDraftValues] = useState<Record<string, string>>({});
    const [loading, setLoading] = useState(true);
    const [message, setMessage] = useState<{ type: "success" | "error"; text: string } | null>(null);
    const [includeCommentHeading, setIncludeCommentHeading] = useState(true);
    const [githubMcpReviewContext, setGithubMcpReviewContext] = useState(false);

    const reloadFromStorage = useCallback(() => {
        const { value, error } = readProviderProfiles();
        setProfiles(value.profiles);
        setActiveProfileId(value.activeProfileId);
        setMessage(error ? { type: "error", text: error } : null);
        setLoading(false);
    }, []);

    useEffect(() => {
        if (!authLoading) {
            reloadFromStorage();
            setIncludeCommentHeading(loadReviewCommentHeading());
            setGithubMcpReviewContext(loadGithubMcpReviewContext());
        }
    }, [authLoading, reloadFromStorage]);

    const handleAddProfile = () => {
        setEditingProfileId("new");
        setDraftName("");
        setDraftProvider("");
        setDraftValues({});
        setMessage(null);
    };

    const handleEditProfile = (profile: ProviderProfile) => {
        setEditingProfileId(profile.id);
        setDraftName(profile.name);
        setDraftProvider(profile.provider);
        const editableValues = { ...profile.settings } as Record<string, string>;
        for (const field of FIELDS) if (field.sensitive) delete editableValues[field.key];
        setDraftValues(editableValues);
        setMessage(null);
    };

    const handleSaveProfile = () => {
        if (!draftProvider) {
            setMessage({ type: "error", text: "Choose a provider type for this profile." });
            return;
        }
        const existing = profiles.find((profile) => profile.id === editingProfileId);
        const base = existing?.provider === draftProvider ? existing.settings : {};
        const settings = { ...base } as Record<string, string>;
        for (const field of FIELDS) {
            if (field.provider !== draftProvider) continue;
            const value = draftValues[field.key]?.trim();
            if (value) settings[field.key] = value;
        }
        const providerConfig = PROVIDERS.find((provider) => provider.value === draftProvider)!;
        const missing = providerConfig.required.filter((key) => !settings[key]);
        if (missing.length) {
            setMessage({ type: "error", text: `Complete the required ${missing.map((key) => FIELDS.find((field) => field.key === key)?.label ?? key).join(" and ")} field${missing.length > 1 ? "s" : ""}.` });
            return;
        }

        const id = existing?.id ?? `profile-${globalThis.crypto?.randomUUID?.() ?? Date.now().toString(36)}`;
        const profileName = draftName.trim() || `${providerConfig.label} ${profiles.filter((profile) => profile.provider === draftProvider).length + (existing ? 0 : 1)}`;
        const nextProfiles = existing
            ? profiles.map((profile) => profile.id === id ? { id, name: profileName, provider: draftProvider, settings } : profile)
            : [...profiles, { id, name: profileName, provider: draftProvider, settings }];
        const nextActiveId = activeProfileId ?? id;
        try {
            saveProviderProfiles({ profiles: nextProfiles, activeProfileId: nextActiveId });
            const { value, error } = readProviderProfiles();
            if (error || !value.profiles.some((profile) => profile.id === id)) throw new Error(error ?? "The profile was not retained in browser storage.");
            setProfiles(value.profiles);
            setActiveProfileId(value.activeProfileId);
            setEditingProfileId(null);
            setDraftValues({});
            setMessage({ type: "success", text: `${profileName} saved in this browser.` });
        } catch (e) {
            setMessage({ type: "error", text: e instanceof Error ? e.message : "Could not save provider profile in browser storage." });
        }
    };

    const handleActivateProfile = (profileId: string) => {
        try {
            const next = activateProviderProfile(profileId);
            setActiveProfileId(next.activeProfileId);
            setProfiles(next.profiles);
            setMessage({ type: "success", text: "Active provider changed. AI requests will use this profile." });
        } catch (e) {
            setMessage({ type: "error", text: e instanceof Error ? e.message : "Could not activate this provider profile." });
        }
    };

    const handleDeleteProfile = (profileId: string) => {
        const remaining = profiles.filter((profile) => profile.id !== profileId);
        const nextActiveId = activeProfileId === profileId ? remaining[0]?.id ?? null : activeProfileId;
        try {
            saveProviderProfiles({ profiles: remaining, activeProfileId: nextActiveId });
            setProfiles(remaining);
            setActiveProfileId(nextActiveId);
            if (editingProfileId === profileId) setEditingProfileId(null);
            setMessage({ type: "success", text: "Provider profile removed from this browser." });
        } catch (e) {
            setMessage({ type: "error", text: e instanceof Error ? e.message : "Could not remove provider profile." });
        }
    };

    const handleClear = () => {
        setMessage(null);
        try {
            clearLlmSettings();
            setProfiles([]);
            setActiveProfileId(null);
            setEditingProfileId(null);
            setDraftValues({});
            setMessage({ type: "success", text: "Provider profiles cleared from this browser profile for this site." });
        } catch (e) {
            setMessage({ type: "error", text: e instanceof Error ? e.message : "Could not clear browser storage." });
        }
    };

    function maskKey(key: string | undefined): string {
        if (!key) return "";
        if (key.length <= 8) return "****";
        return key.slice(0, 4) + "…" + key.slice(-4);
    }

    const activeProfile = profiles.find((profile) => profile.id === activeProfileId) ?? null;
    const editingProfile = profiles.find((profile) => profile.id === editingProfileId) ?? null;

    return (
        <main className="flex flex-col gap-6">
            <header className="flex items-center justify-between border-b border-slate-200 pb-6 dark:border-slate-800">
                <div>
                    <h1 className="text-2xl font-bold tracking-tight text-slate-900 dark:text-slate-100">Settings</h1>
                    <p className="text-xs text-slate-500">Configure your integrations and credentials</p>
                </div>
                <Link href="/" className="rounded-md border border-slate-300 px-4 py-2 text-sm font-medium hover:bg-slate-100 dark:border-slate-700 dark:hover:bg-slate-900">
                    Back to Dashboard
                </Link>
            </header>

            {!authLoading && !user ? (
                <section className="flex flex-col items-center gap-4 rounded-xl border border-slate-200 bg-white/60 p-8 text-center dark:border-slate-800 dark:bg-slate-950/40">
                    <p className="text-sm text-slate-600 dark:text-slate-400">
                        Sign in to save your settings.
                    </p>
                    <Link
                        href="/login"
                        className="flex items-center gap-2 rounded-md bg-slate-900 px-4 py-2 text-sm font-medium text-white hover:bg-slate-800 dark:bg-slate-100 dark:text-slate-900 dark:hover:bg-slate-200"
                    >
                        Sign in
                    </Link>
                </section>
            ) : null}

            {user ? (
                <>
                    <section className="rounded-xl border border-slate-200 bg-white/60 p-6 dark:border-slate-800 dark:bg-slate-950/40">
                        <div className="flex items-center gap-3">
                            <img
                                src={user.avatar_url}
                                alt=""
                                className="h-10 w-10 rounded-full"
                                referrerPolicy="no-referrer"
                            />
                            <div>
                                <h2 className="text-sm font-semibold text-slate-900 dark:text-slate-100">
                                    {user.name ?? user.login}
                                </h2>
                                {user.email ? <p className="text-xs text-slate-500">{user.email}</p> : null}
                            </div>
                            <div className="ml-auto flex items-center gap-1.5 rounded-full border border-emerald-300 bg-emerald-50 px-2.5 py-1 text-xs font-medium text-emerald-700 dark:border-emerald-700 dark:bg-emerald-950/40 dark:text-emerald-300">
                                <span className="h-1.5 w-1.5 rounded-full bg-emerald-500" />
                                GitHub connected
                            </div>
                        </div>
                        <p className="mt-3 text-xs text-slate-500">
                            Your GitHub token is used for API calls. LLM settings below are stored in your browser only and never saved on the server.
                        </p>
                    </section>

                    {loading ? (
                        <p className="text-sm text-slate-500">Loading settings...</p>
                    ) : (
                        <>
                            <section className="rounded-xl border border-slate-200 bg-white/60 p-6 dark:border-slate-800 dark:bg-slate-950/40">
                                <div className="mb-5 flex flex-wrap items-center justify-between gap-3">
                                    <div>
                                        <h2 className="text-sm font-semibold text-slate-900 dark:text-slate-100">Model provider profiles</h2>
                                        <p className="mt-1 text-xs text-slate-500">Save multiple configurations, including multiple profiles for the same provider. Switching profiles takes effect immediately.</p>
                                        <p className="mt-1 text-xs font-medium text-emerald-700 dark:text-emerald-300">Active for AI requests: {activeProfile?.name ?? "None selected"}</p>
                                    </div>
                                    <button
                                        type="button"
                                        className="rounded-md bg-emerald-600 px-3 py-2 text-sm font-medium text-white hover:bg-emerald-500"
                                        onClick={handleAddProfile}
                                    >
                                        Add provider profile
                                    </button>
                                </div>

                                {profiles.length ? (
                                    <div className="mb-5 grid gap-3 md:grid-cols-2">
                                        {profiles.map((profile) => {
                                            const providerLabel = PROVIDERS.find((provider) => provider.value === profile.provider)?.label ?? profile.provider;
                                            const settings = profile.settings as Record<string, string | undefined>;
                                            const model = settings[`${profile.provider}_model`];
                                            const endpoint = profile.provider === "vllm" ? settings.vllm_host : profile.provider === "ollama" ? settings.ollama_host : "";
                                            const credentialKey = profile.provider === "anthropic" ? settings.anthropic_api_key
                                                : profile.provider === "groq" ? settings.groq_api_key
                                                    : profile.provider === "openai" ? settings.openai_api_key
                                                        : profile.provider === "vertex" ? settings.vertex_sa_key
                                                            : profile.provider === "vllm" ? settings.vllm_api_key : "";
                                            const active = profile.id === activeProfileId;
                                            return (
                                                <article key={profile.id} className={`rounded-lg border p-4 ${active ? "border-emerald-500 bg-emerald-50/50 dark:border-emerald-700 dark:bg-emerald-950/20" : "border-slate-200 dark:border-slate-800"}`}>
                                                    <div className="flex items-start justify-between gap-3">
                                                        <div className="min-w-0">
                                                            <div className="flex flex-wrap items-center gap-2">
                                                                <h3 className="font-medium text-slate-900 dark:text-slate-100">{profile.name}</h3>
                                                                <span className="rounded-full bg-slate-100 px-2 py-0.5 text-[11px] text-slate-600 dark:bg-slate-800 dark:text-slate-300">{providerLabel}</span>
                                                                {active ? <span className="rounded-full bg-emerald-100 px-2 py-0.5 text-[11px] font-medium text-emerald-800 dark:bg-emerald-900/60 dark:text-emerald-200">Active</span> : null}
                                                            </div>
                                                            <div className="mt-2 space-y-1 break-all text-xs text-slate-600 dark:text-slate-400">
                                                                {model ? <p>Model: <span className="font-mono">{model}</span></p> : null}
                                                                {endpoint ? <p>Endpoint: <span className="font-mono">{endpoint}</span></p> : null}
                                                                {profile.provider === "vertex" && settings.vertex_project_id ? <p>Project: <span className="font-mono">{settings.vertex_project_id}</span>{settings.vertex_region ? ` · ${settings.vertex_region}` : ""}</p> : null}
                                                                {profile.provider === "ollama" ? <p>Credential: not required</p> : credentialKey ? <p>Credential: <span className="font-mono">{maskKey(credentialKey)}</span></p> : profile.provider === "vllm" ? <p>API key: not set</p> : null}
                                                            </div>
                                                        </div>
                                                    </div>
                                                    <div className="mt-4 flex flex-wrap gap-2">
                                                        {!active ? <button type="button" className="rounded-md border border-emerald-500 px-3 py-1.5 text-xs font-medium text-emerald-800 hover:bg-emerald-50 dark:text-emerald-200 dark:hover:bg-emerald-950/40" onClick={() => handleActivateProfile(profile.id)}>Use this provider</button> : null}
                                                        <button type="button" className="rounded-md border border-slate-300 px-3 py-1.5 text-xs hover:bg-slate-100 dark:border-slate-700 dark:hover:bg-slate-900" onClick={() => handleEditProfile(profile)}>Edit</button>
                                                        <button type="button" className="rounded-md border border-rose-300 px-3 py-1.5 text-xs text-rose-700 hover:bg-rose-50 dark:border-rose-800 dark:text-rose-300 dark:hover:bg-rose-950/30" onClick={() => handleDeleteProfile(profile.id)}>Remove</button>
                                                    </div>
                                                </article>
                                            );
                                        })}
                                    </div>
                                ) : (
                                    <p className="mb-5 rounded-lg border border-dashed border-slate-300 p-4 text-sm text-slate-500 dark:border-slate-700">No provider profiles saved yet. Add one to configure a model endpoint and credentials.</p>
                                )}

                                {editingProfileId !== null ? (
                                    <div className="mb-5 rounded-lg border border-slate-300 p-4 dark:border-slate-700">
                                        <h3 className="mb-3 text-sm font-semibold text-slate-900 dark:text-slate-100">{editingProfileId === "new" ? "New provider profile" : "Edit provider profile"}</h3>
                                        <div className="grid gap-4 sm:grid-cols-2">
                                            <label className="flex flex-col gap-1">
                                                <span className="text-xs font-medium text-slate-600 dark:text-slate-400">Profile name</span>
                                                <input className="rounded-md border border-slate-300 bg-white px-3 py-2 text-sm dark:border-slate-700 dark:bg-slate-950" placeholder="e.g. Work vLLM, Local Ollama" value={draftName} onChange={(e) => setDraftName(e.target.value)} />
                                            </label>
                                            <label className="flex flex-col gap-1">
                                                <span className="text-xs font-medium text-slate-600 dark:text-slate-400">Provider</span>
                                                <select className="rounded-md border border-slate-300 bg-white px-3 py-2 text-sm dark:border-slate-700 dark:bg-slate-950" value={draftProvider} onChange={(e) => { setDraftProvider(e.target.value as LlmProvider | ""); setDraftValues({}); }}>
                                                    <option value="">Choose a provider</option>
                                                    {PROVIDERS.map((provider) => <option key={provider.value} value={provider.value}>{provider.label}</option>)}
                                                </select>
                                            </label>
                                        </div>
                                        {draftProvider ? (
                                            <div className="mt-4 grid gap-4 sm:grid-cols-2">
                                                {FIELDS.filter((field) => field.provider === draftProvider).map((field) => {
                                                    const original = editingProfile?.provider === draftProvider ? String(editingProfile.settings[field.key as keyof ProviderProfile["settings"]] ?? "") : "";
                                                    const placeholder = field.sensitive && original ? `Saved (${maskKey(original)}); leave blank to keep` : original || field.placeholder;
                                                    const inputClass = "rounded-md border border-slate-300 bg-white px-3 py-2 text-sm outline-none ring-emerald-500/40 placeholder:text-slate-400 focus:ring-2 dark:border-slate-700 dark:bg-slate-950 dark:placeholder:text-slate-600";
                                                    return (
                                                        <label key={field.key} className={`flex flex-col gap-1 ${field.multiline ? "sm:col-span-2" : ""}`}>
                                                            <span className="text-xs font-medium text-slate-600 dark:text-slate-400">{field.label}</span>
                                                            {field.multiline ? <textarea className={`${inputClass} resize-y font-mono text-xs`} rows={4} placeholder={placeholder} value={draftValues[field.key] ?? ""} onChange={(e) => setDraftValues((prev) => ({ ...prev, [field.key]: e.target.value }))} /> : <input type={field.sensitive ? "password" : "text"} className={inputClass} placeholder={placeholder} value={draftValues[field.key] ?? ""} onChange={(e) => setDraftValues((prev) => ({ ...prev, [field.key]: e.target.value }))} />}
                                                        </label>
                                                    );
                                                })}
                                            </div>
                                        ) : null}
                                        {draftProvider === "vertex" ? <p className="mt-3 text-xs text-slate-500">Newer Claude models (Sonnet 5, Opus 4.8, …) use the <span className="font-mono">global</span> region.</p> : null}
                                        {draftProvider === "vllm" ? <p className="mt-3 text-xs text-slate-500">OpenAI-compatible endpoints use Chat Completions automatically. For an Anthropic-compatible server, enter its full Messages URL ending in <span className="font-mono">/v1/messages</span>; giTrack will send <span className="font-mono">x-api-key</span> and <span className="font-mono">anthropic-version</span>.</p> : null}
                                        <div className="mt-4 flex gap-2">
                                            <button type="button" className="rounded-md bg-emerald-600 px-3 py-2 text-sm font-medium text-white hover:bg-emerald-500" onClick={handleSaveProfile}>Save profile</button>
                                            <button type="button" className="rounded-md border border-slate-300 px-3 py-2 text-sm dark:border-slate-700" onClick={() => setEditingProfileId(null)}>Cancel</button>
                                        </div>
                                    </div>
                                ) : null}

                                {message ? (
                                    <div className={`mt-4 rounded-md border px-3 py-2 text-sm ${
                                        message.type === "success"
                                            ? "border-emerald-300 bg-emerald-50 text-emerald-800 dark:border-emerald-700 dark:bg-emerald-950/40 dark:text-emerald-200"
                                            : "border-rose-300 bg-rose-50 text-rose-800 dark:border-rose-900/60 dark:bg-rose-950/40 dark:text-rose-100"
                                    }`}>
                                        {message.text}
                                    </div>
                                ) : null}

                                <p className="mt-2 text-[11px] text-slate-400 dark:text-slate-500">
                                    Provider profiles and credentials are saved in this browser for this site. Secrets are masked in the profile list. The active profile is sent with AI requests and is not persisted on the server.
                                </p>

                                <div className="mt-4 flex items-center gap-3">
                                    <button
                                        type="button"
                                        className="rounded-md border border-rose-300 px-4 py-2 text-sm font-medium text-rose-600 hover:bg-rose-50 dark:border-rose-700 dark:text-rose-400 dark:hover:bg-rose-950/30"
                                        onClick={handleClear}
                                    >
                                        Clear All
                                    </button>
                                </div>
                            </section>

                            <section className="rounded-xl border border-slate-200 bg-white/60 p-6 dark:border-slate-800 dark:bg-slate-950/40">
                                <h2 className="mb-4 text-sm font-semibold text-slate-900 dark:text-slate-100">Review</h2>
                                <label className="mb-5 flex cursor-pointer items-start gap-3">
                                    <input
                                        type="checkbox"
                                        className="mt-1"
                                        checked={githubMcpReviewContext}
                                        onChange={(e) => {
                                            const next = e.target.checked;
                                            try {
                                                saveGithubMcpReviewContext(next);
                                                setGithubMcpReviewContext(next);
                                                setMessage({ type: "success", text: next ? "GitHub MCP context enabled for new AI reviews." : "GitHub MCP context disabled." });
                                            } catch {
                                                setMessage({ type: "error", text: "Could not save the GitHub MCP setting in browser storage." });
                                            }
                                        }}
                                    />
                                    <span>
                                        <span className="text-sm font-medium text-slate-800 dark:text-slate-200">Add read-only GitHub MCP context to AI reviews</span>
                                        <span className="mt-1 block text-xs text-slate-600 dark:text-slate-400">
                                            Adds PR history and up to 5 changed-file contents to the existing diff review. When enabled, the signed-in GitHub token is used with GitHub&apos;s hosted MCP service, and the returned context is sent to your selected model provider. This does not enable GitHub write actions.
                                        </span>
                                    </span>
                                </label>
                                <label className="flex cursor-pointer items-start gap-3">
                                    <input
                                        type="checkbox"
                                        className="mt-1"
                                        checked={includeCommentHeading}
                                        onChange={(e) => {
                                            const next = e.target.checked;
                                            setIncludeCommentHeading(next);
                                            saveReviewCommentHeading(next);
                                        }}
                                    />
                                    <span>
                                        <span className="text-sm font-medium text-slate-800 dark:text-slate-200">
                                            Include severity and title on GitHub comments
                                        </span>
                                        <span className="mt-1 block text-xs text-slate-600 dark:text-slate-400">
                                            Turn off to post only the comment body. Example:{" "}
                                            <code className="rounded bg-slate-200 px-1 py-0.5 font-mono text-[11px] text-slate-800 dark:bg-slate-800 dark:text-slate-200">
                                                [Suggestion] Example title
                                            </code>
                                        </span>
                                    </span>
                                </label>
                            </section>

                            <AssignmentRulesSection user={user} />
                        </>
                    )}
                </>
            ) : null}

            {authLoading ? <p className="text-sm text-slate-500">Loading...</p> : null}
        </main>
    );
}
