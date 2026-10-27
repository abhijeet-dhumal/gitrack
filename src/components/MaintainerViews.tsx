"use client";

import { Fragment, useCallback, useEffect, useState } from "react";

export type State = "open" | "closed" | "all";
export type IssueFilter = "all" | "needs-triage" | "unassigned" | "no-milestone" | "no-label" | "has-comments";
export type IssueSort = "updatedDesc" | "updatedAsc" | "createdDesc" | "createdAsc" | "commentsDesc" | "commentsAsc";
type Pagination = { page: number; nextPage: number | null; lastPage?: number | null; hasMore: boolean };
type Issue = {
  number: number;
  title: string;
  state: string;
  html_url: string;
  created_at: string;
  updated_at: string;
  comments: number;
  user: { login: string } | null;
  labels: Array<{ name: string; color: string }>;
  assignees: Array<{ login: string }>;
  milestone: { title: string; html_url: string } | null;
};
type ClosingPullRequest = { number: number; title: string; url: string; state: "OPEN" | "CLOSED"; merged: boolean };
type MaintainerSummary = { needsTriage: number; needsReview: number; needsChanges: number; waitingOnChecks: number };
type Milestone = {
  number: number;
  title: string;
  description: string | null;
  state: "open" | "closed";
  html_url: string;
  due_on: string | null;
  open_issues: number;
  closed_issues: number;
};

const panelClass = "rounded-xl border border-slate-200 bg-white/60 p-4 dark:border-slate-800 dark:bg-slate-900/40";
const mutedClass = "text-xs text-slate-500 dark:text-slate-400";
const ISSUES_CACHE_KEY = "gitrack:issues-cache";
const MILESTONES_CACHE_KEY = "gitrack:milestones-cache";

function shortDate(value: string) {
  return new Date(value).toLocaleDateString(undefined, { year: "numeric", month: "short", day: "numeric" });
}

function Pager({ pagination, onPage, loading }: { pagination: Pagination | null; onPage: (page: number) => void; loading: boolean }) {
  if (!pagination) return null;
  return (
    <div className="flex items-center gap-2">
      <button type="button" className="rounded-md border border-slate-300 px-3 py-1.5 text-sm hover:bg-slate-100 disabled:opacity-40 dark:border-slate-700 dark:hover:bg-slate-900" disabled={pagination.page <= 1 || loading} onClick={() => onPage(pagination.page - 1)}>Prev</button>
      <span className={mutedClass}>Page {pagination.page}</span>
      <button type="button" className="rounded-md border border-slate-300 px-3 py-1.5 text-sm hover:bg-slate-100 disabled:opacity-40 dark:border-slate-700 dark:hover:bg-slate-900" disabled={!pagination.hasMore || loading} onClick={() => onPage(pagination.page + 1)}>Next</button>
    </div>
  );
}

export function ListOptions({ idPrefix, state, perPage, onStateChange, onPerPageChange }: { idPrefix: string; state: State; perPage: number; onStateChange: (state: State) => void; onPerPageChange: (perPage: number) => void }) {
  return <div className="flex items-end gap-2">
    <label className="flex flex-col gap-1">
      <span className="text-[10px] font-medium uppercase tracking-wide text-slate-500">State</span>
      <select id={`${idPrefix}-state`} aria-label={`${idPrefix} state`} className="rounded-md border border-slate-300 bg-white px-2.5 py-1.5 text-sm dark:border-slate-700 dark:bg-slate-950" value={state} onChange={(e) => onStateChange(e.target.value as State)}>
        <option value="open">Open</option><option value="closed">Closed</option><option value="all">All</option>
      </select>
    </label>
    <label className="flex flex-col gap-1">
      <span className="text-[10px] font-medium uppercase tracking-wide text-slate-500">Per page</span>
      <select id={`${idPrefix}-per-page`} aria-label={`${idPrefix} per page`} className="rounded-md border border-slate-300 bg-white px-2.5 py-1.5 text-sm dark:border-slate-700 dark:bg-slate-950" value={String(perPage)} onChange={(e) => onPerPageChange(Number(e.target.value))}>
        {[5, 10, 20, 30].map((n) => <option key={n} value={n}>{n}</option>)}
      </select>
    </label>
  </div>;
}

export function MaintainerOverview({ owner, repo, onIssues, onQueue, onMilestones }: { owner: string; repo: string; onIssues: () => void; onQueue: (queue: "needsReview" | "needsChanges" | "waitingOnChecks") => void; onMilestones: () => void }) {
  const [summary, setSummary] = useState<MaintainerSummary | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [refreshCount, setRefreshCount] = useState(0);
  useEffect(() => {
    if (!owner || !repo) return;
    let active = true;
    setLoading(true);
    setSummary(null);
    const q = new URLSearchParams({ owner, repo });
    fetch(`/api/maintainer-summary?${q}`)
      .then(async (res) => {
        const json = await res.json() as MaintainerSummary & { error?: string };
        if (!res.ok) throw new Error(json.error ?? `Request failed (${res.status})`);
        if (active) {
          setSummary(json);
          setError(null);
        }
      })
      .catch((e: unknown) => { if (active) setError(e instanceof Error ? e.message : "Could not load overview"); })
      .finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, [owner, repo, refreshCount]);

  const cards = [
    { title: "Needs triage · needs-triage label", count: summary?.needsTriage, owner: "Next: maintainer", action: onIssues },
    { title: "Review requested", count: summary?.needsReview, owner: "Next: requested reviewer", action: () => onQueue("needsReview") },
    { title: "Formal changes requested", count: summary?.needsChanges, owner: "Next: PR author", action: () => onQueue("needsChanges") },
    { title: "Checks pending", count: summary?.waitingOnChecks, owner: "Next: CI", action: () => onQueue("waitingOnChecks") },
    { title: "Release scope", count: undefined, owner: "Issues and closing PRs by milestone", action: onMilestones },
  ];
  return <section className="mt-4" aria-label="Maintainer action queues">
    <div className="mb-2 flex flex-wrap items-baseline justify-between gap-2"><div><h2 className="text-sm font-semibold">Maintainer queues</h2><p className={mutedClass}>Open-only GitHub signals; counts can overlap.</p></div><div className="flex items-center gap-2"><span className={mutedClass}>{loading ? "Refreshing counts…" : `Full repository totals · ${owner}/${repo}`}</span><button type="button" className="text-xs text-emerald-700 hover:underline dark:text-emerald-400" disabled={loading} onClick={() => setRefreshCount((n) => n + 1)}>Refresh</button></div></div>
    {error ? <p role="alert" className="mb-2 text-xs text-rose-600">Queue counts unavailable: {error}</p> : null}
    <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-5">{cards.map((card) => <button key={card.title} type="button" onClick={card.action} className={`${panelClass} text-left transition hover:border-emerald-400 hover:bg-emerald-50/40 dark:hover:border-emerald-800 dark:hover:bg-emerald-950/20`}>
      <span className="block text-xs font-medium text-slate-500 dark:text-slate-400">{card.title}</span>
      <span className="mt-1 block text-2xl font-semibold tabular-nums text-slate-900 dark:text-slate-100">{card.count === undefined ? "→" : card.count}</span>
      <span className={mutedClass}>{card.owner}</span>
    </button>)}</div>
  </section>;
}

export function IssuesInbox({ owner, repo, state, onStateChange, perPage, onPerPageChange, filter, onFilterChange, search, onSearchChange, author, onAuthorChange, assignee, onAssigneeChange, label, onLabelChange, milestone, onMilestoneChange, sort, onSortChange }: { owner: string; repo: string; state: State; onStateChange: (state: State) => void; perPage: number; onPerPageChange: (perPage: number) => void; filter: IssueFilter; onFilterChange: (filter: IssueFilter) => void; search: string; onSearchChange: (search: string) => void; author: string; onAuthorChange: (value: string) => void; assignee: string; onAssigneeChange: (value: string) => void; label: string; onLabelChange: (value: string) => void; milestone: string; onMilestoneChange: (value: string) => void; sort: IssueSort; onSortChange: (sort: IssueSort) => void }) {
  const [issues, setIssues] = useState<Issue[]>([]);
  const [pagination, setPagination] = useState<Pagination | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [totalCount, setTotalCount] = useState(0);
  const [expandedIssue, setExpandedIssue] = useState<number | null>(null);
  const [closingPullRequests, setClosingPullRequests] = useState<Record<number, ClosingPullRequest[] | "loading" | string>>({});
  const queryKey = JSON.stringify([owner, repo, state, perPage, filter, search.trim(), author.trim(), assignee.trim(), label.trim(), milestone.trim(), sort]);
  const [cachedQueryKey, setCachedQueryKey] = useState<string | null>(null);

  const load = useCallback(async (page: number) => {
    if (!owner || !repo) return;
    setLoading(true);
    setError(null);
    try {
      const q = new URLSearchParams({ owner, repo, state, filter, page: String(page), perPage: String(perPage) });
      if (search.trim()) q.set("search", search.trim());
      if (author.trim()) q.set("author", author.trim());
      if (assignee.trim()) q.set("assignee", assignee.trim());
      if (label.trim()) q.set("label", label.trim());
      if (milestone.trim()) q.set("milestoneTitle", milestone.trim());
      const [sortBy, direction] = sort.endsWith("Asc") ? [sort === "commentsAsc" ? "comments" : sort === "createdAsc" ? "created" : "updated", "asc"] : [sort === "commentsDesc" ? "comments" : sort === "createdDesc" ? "created" : "updated", "desc"];
      q.set("sort", sortBy);
      q.set("direction", direction);
      const res = await fetch(`/api/issues?${q}`);
      const json = await res.json() as { issues?: Issue[]; pagination?: Pagination; totalCount?: number; error?: string };
      if (!res.ok) throw new Error(json.error ?? `Request failed (${res.status})`);
      setIssues(json.issues ?? []);
      setPagination(json.pagination ?? null);
      setTotalCount(json.totalCount ?? 0);
      setCachedQueryKey(queryKey);
    } catch (e) {
      setIssues([]);
      setPagination(null);
      setError(e instanceof Error ? e.message : "Failed to load issues");
    } finally {
      setLoading(false);
    }
  }, [owner, repo, state, filter, perPage, search, author, assignee, label, milestone, sort, queryKey]);

  useEffect(() => {
    if (cachedQueryKey === queryKey) return;
    try {
      const cached = JSON.parse(sessionStorage.getItem(ISSUES_CACHE_KEY) ?? "null") as {
        queryKey?: string; issues?: Issue[]; pagination?: Pagination | null; totalCount?: number;
        expandedIssue?: number | null; closingPullRequests?: Record<number, ClosingPullRequest[] | "loading" | string>;
      } | null;
      if (cached?.queryKey === queryKey && Array.isArray(cached.issues) && cached.pagination) {
        setIssues(cached.issues);
        setPagination(cached.pagination);
        setTotalCount(cached.totalCount ?? 0);
        setExpandedIssue(cached.expandedIssue ?? null);
        setClosingPullRequests(Object.fromEntries(Object.entries(cached.closingPullRequests ?? {}).filter(([, value]) => value !== "loading")));
        setCachedQueryKey(queryKey);
        return;
      }
    } catch { /* Cached inbox data is optional when browser storage is unavailable. */ }
    const timer = setTimeout(() => void load(1), [search, author, assignee, label, milestone].some((value) => value.trim()) ? 300 : 0);
    return () => clearTimeout(timer);
  }, [load, queryKey, cachedQueryKey, search, author, assignee, label, milestone]);

  useEffect(() => {
    if (cachedQueryKey !== queryKey || !pagination) return;
    try {
      sessionStorage.setItem(ISSUES_CACHE_KEY, JSON.stringify({ queryKey, issues, pagination, totalCount, expandedIssue, closingPullRequests: Object.fromEntries(Object.entries(closingPullRequests).filter(([, value]) => value !== "loading")) }));
    } catch { /* Cached inbox data is optional when browser storage is unavailable. */ }
  }, [cachedQueryKey, queryKey, issues, pagination, totalCount, expandedIssue, closingPullRequests]);

  const toggleIssue = async (number: number) => {
    if (expandedIssue === number) { setExpandedIssue(null); return; }
    setExpandedIssue(number);
    if (closingPullRequests[number]) return;
    setClosingPullRequests((current) => ({ ...current, [number]: "loading" }));
    try {
      const q = new URLSearchParams({ owner, repo });
      const res = await fetch(`/api/issues/${number}/closing-prs?${q}`);
      const json = await res.json() as { pullRequests?: ClosingPullRequest[]; error?: string };
      if (!res.ok) throw new Error(json.error ?? `Request failed (${res.status})`);
      setClosingPullRequests((current) => ({ ...current, [number]: json.pullRequests ?? [] }));
    } catch (e) {
      setClosingPullRequests((current) => ({ ...current, [number]: e instanceof Error ? e.message : "Could not load closing PRs" }));
    }
  };

  return (
    <section className="flex flex-col gap-3">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div className="flex flex-wrap items-end gap-3">
          <ListOptions idPrefix="issues" state={state} onStateChange={onStateChange} perPage={perPage} onPerPageChange={onPerPageChange} />
          <button type="button" className="rounded-md border border-slate-300 px-3 py-1.5 text-sm hover:bg-slate-100 disabled:opacity-40 dark:border-slate-700 dark:hover:bg-slate-900" disabled={loading} onClick={() => void load(pagination?.page ?? 1)}>{loading ? "Loading…" : "Refresh"}</button>
        </div>
        {pagination ? <span className={mutedClass}>Page {pagination.page}{pagination.lastPage ? ` / ${pagination.lastPage}` : ""}</span> : null}
      </div>
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2 className="text-lg font-medium">Issues inbox</h2>
          <p className={mutedClass}>Triage {owner}/{repo} issues. Pull requests are excluded.</p>
        </div>
        <div className="flex items-center gap-2">
          <button type="button" className="rounded-md border border-slate-300 px-3 py-1.5 text-sm hover:bg-slate-100 disabled:opacity-40 dark:border-slate-700 dark:hover:bg-slate-900" disabled={!pagination || pagination.page <= 1 || loading} onClick={() => void load((pagination?.page ?? 1) - 1)}>Prev</button>
          <button type="button" className="rounded-md border border-slate-300 px-3 py-1.5 text-sm hover:bg-slate-100 disabled:opacity-40 dark:border-slate-700 dark:hover:bg-slate-900" disabled={!pagination?.hasMore || loading} onClick={() => void load((pagination?.page ?? 1) + 1)}>Next</button>
        </div>
      </div>
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div className="flex flex-wrap items-end gap-3">
          <label className="flex flex-col gap-1">
            <span className="text-xs font-medium uppercase tracking-wide text-slate-500">Search</span>
            <input id="issue-inbox-search" className="w-56 rounded-md border border-slate-300 bg-white px-3 py-2 text-sm outline-none ring-emerald-500/40 focus:ring-2 dark:border-slate-700 dark:bg-slate-950" placeholder="Issue # or title…" value={search} onChange={(e) => onSearchChange(e.target.value)} />
          </label>
          <label className="flex flex-col gap-1">
            <span className="text-xs font-medium uppercase tracking-wide text-slate-500">Priority view</span>
            <select id="issue-inbox-filter" className="rounded-md border border-slate-300 bg-white px-3 py-2 text-sm outline-none ring-emerald-500/40 focus:ring-2 dark:border-slate-700 dark:bg-slate-950" value={filter} onChange={(e) => onFilterChange(e.target.value as typeof filter)}>
              <option value="all">All issues</option>
              <option value="needs-triage">Needs triage</option>
              <option value="unassigned">Unassigned</option>
              <option value="no-milestone">No milestone</option>
              <option value="no-label">No labels</option>
              <option value="has-comments">Has discussion</option>
            </select>
          </label>
          <label className="flex flex-col gap-1">
            <span className="text-xs font-medium uppercase tracking-wide text-slate-500">Author</span>
            <input className="w-36 rounded-md border border-slate-300 bg-white px-3 py-2 text-sm outline-none ring-emerald-500/40 focus:ring-2 dark:border-slate-700 dark:bg-slate-950" placeholder="GitHub username" value={author} onChange={(e) => onAuthorChange(e.target.value)} />
          </label>
          <label className="flex flex-col gap-1">
            <span className="text-xs font-medium uppercase tracking-wide text-slate-500">Assignee</span>
            <input className="w-36 rounded-md border border-slate-300 bg-white px-3 py-2 text-sm outline-none ring-emerald-500/40 focus:ring-2 dark:border-slate-700 dark:bg-slate-950" placeholder="GitHub username" value={assignee} onChange={(e) => onAssigneeChange(e.target.value)} />
          </label>
          <label className="flex flex-col gap-1">
            <span className="text-xs font-medium uppercase tracking-wide text-slate-500">Label</span>
            <input className="w-36 rounded-md border border-slate-300 bg-white px-3 py-2 text-sm outline-none ring-emerald-500/40 focus:ring-2 dark:border-slate-700 dark:bg-slate-950" placeholder="Exact label" value={label} onChange={(e) => onLabelChange(e.target.value)} />
          </label>
          <label className="flex flex-col gap-1">
            <span className="text-xs font-medium uppercase tracking-wide text-slate-500">Milestone</span>
            <input className="w-36 rounded-md border border-slate-300 bg-white px-3 py-2 text-sm outline-none ring-emerald-500/40 focus:ring-2 dark:border-slate-700 dark:bg-slate-950" placeholder="Milestone title" value={milestone} onChange={(e) => onMilestoneChange(e.target.value)} />
          </label>
          <label className="flex flex-col gap-1">
            <span className="text-xs font-medium uppercase tracking-wide text-slate-500">Sort</span>
            <select className="rounded-md border border-slate-300 bg-white px-3 py-2 text-sm outline-none ring-emerald-500/40 focus:ring-2 dark:border-slate-700 dark:bg-slate-950" value={sort} onChange={(e) => onSortChange(e.target.value as IssueSort)}>
              <option value="updatedDesc">Recently updated</option>
              <option value="updatedAsc">Oldest update</option>
              <option value="createdDesc">Newest opened</option>
              <option value="createdAsc">Oldest opened</option>
              <option value="commentsDesc">Most discussed</option>
              <option value="commentsAsc">Least discussed</option>
            </select>
          </label>
        </div>
        <div className="flex items-center gap-2 text-xs text-slate-500">
          <span>{`Showing ${issues.length} issues on this page / ${totalCount} matching issues`}</span>
          {(filter !== "all" || search || author || assignee || label || milestone) ? <button type="button" className="text-emerald-700 hover:underline dark:text-emerald-400" onClick={() => { onFilterChange("all"); onSearchChange(""); onAuthorChange(""); onAssigneeChange(""); onLabelChange(""); onMilestoneChange(""); }}>Clear filters</button> : null}
        </div>
      </div>
      {error ? <p role="alert" className="rounded-md border border-rose-300 bg-rose-50 px-3 py-2 text-sm text-rose-800 dark:border-rose-900/60 dark:bg-rose-950/40 dark:text-rose-100">{error}</p> : null}
      {!error ? <div className="overflow-x-auto rounded-xl border border-slate-200 dark:border-slate-800">
        {issues.length ? (
          <table className="min-w-full divide-y divide-slate-200 text-left text-sm dark:divide-slate-800">
            <thead className="bg-slate-100/80 text-xs uppercase tracking-wide text-slate-500 dark:bg-slate-900/60"><tr><th className="px-3 py-2">Issue</th><th className="px-3 py-2">State</th><th className="px-3 py-2">Labels</th><th className="px-3 py-2">Assigned to</th><th className="px-3 py-2">Milestone</th><th className="px-3 py-2">Activity</th></tr></thead>
            <tbody className="divide-y divide-slate-200 bg-white/60 dark:divide-slate-800 dark:bg-slate-950/40">
              {issues.map((issue) => <Fragment key={issue.number}>
                <tr className="align-top hover:bg-slate-50/70 dark:hover:bg-slate-950/50">
                  <td className="px-3 py-3">
                    <div className="flex items-start gap-2">
                      <button type="button" aria-label={`${expandedIssue === issue.number ? "Hide" : "Show"} closing pull requests for issue #${issue.number}`} aria-expanded={expandedIssue === issue.number} className="rounded p-1 text-slate-400 hover:bg-slate-100 dark:hover:bg-slate-900" onClick={() => void toggleIssue(issue.number)}><span className="inline-block transition-transform" style={{ transform: expandedIssue === issue.number ? "rotate(90deg)" : "rotate(0deg)" }}>▸</span></button>
                      <div className="min-w-0">
                        <a className="font-medium text-slate-900 hover:text-emerald-700 hover:underline dark:text-slate-100 dark:hover:text-emerald-400" href={issue.html_url} target="_blank" rel="noreferrer">#{issue.number}</a>
                        <div className="max-w-md text-xs text-slate-600 dark:text-slate-400">{issue.title}</div>
                        <div className="mt-1 text-[11px] text-slate-500">opened by {issue.user?.login ?? "unknown"} · {issue.comments} comments</div>
                      </div>
                    </div>
                  </td>
                  <td className="px-3 py-3"><span className={`inline-flex items-center rounded-full border px-2 py-0.5 text-xs font-medium ${issue.state === "open" ? "border-emerald-300 bg-emerald-50 text-emerald-800 dark:border-emerald-900/60 dark:bg-emerald-950/40 dark:text-emerald-100" : "border-slate-300 bg-slate-100 text-slate-700 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-300"}`}>{issue.state}</span></td>
                  <td className="px-3 py-3"><div className="flex max-w-xs flex-wrap gap-1">{issue.labels.length ? issue.labels.map((label) => <span key={label.name} className="rounded-full border px-2 py-0.5 text-[10px]" style={{ borderColor: `#${label.color}80`, backgroundColor: `#${label.color}18` }}>{label.name}</span>) : <span className={mutedClass}>No labels</span>}</div></td>
                  <td className="px-3 py-3 text-xs text-slate-600 dark:text-slate-300">{issue.assignees.length ? issue.assignees.map((a) => a.login).join(", ") : <span className="text-amber-700 dark:text-amber-400">Unassigned</span>}</td>
                  <td className="px-3 py-3 text-xs">{issue.milestone ? <a className="text-emerald-700 hover:underline dark:text-emerald-400" href={issue.milestone.html_url} target="_blank" rel="noreferrer">{issue.milestone.title}</a> : <span className={mutedClass}>—</span>}</td>
                  <td className="whitespace-nowrap px-3 py-3 text-xs text-slate-500">opened {Math.max(0, Math.floor((Date.now() - Date.parse(issue.created_at)) / 86400000))}d ago<br />updated {shortDate(issue.updated_at)}</td>
                </tr>
                {expandedIssue === issue.number ? <tr><td colSpan={6} className="bg-slate-50/70 px-8 py-3 dark:bg-slate-950/40">
                  <p className="mb-2 text-xs font-semibold text-slate-600 dark:text-slate-300">Closing pull requests</p>
                  {closingPullRequests[issue.number] === "loading" ? <span className={mutedClass}>Loading…</span> : typeof closingPullRequests[issue.number] === "string" ? <p role="alert" className="text-xs text-rose-600">{String(closingPullRequests[issue.number])}</p> : (closingPullRequests[issue.number] ?? []).length ? <div className="flex flex-wrap gap-x-4 gap-y-1">{(closingPullRequests[issue.number] as ClosingPullRequest[]).map((pr) => <a key={pr.number} className="text-xs text-emerald-700 hover:underline dark:text-emerald-400" href={pr.url} target="_blank" rel="noreferrer">#{pr.number} {pr.title} · {pr.merged ? "merged" : pr.state.toLowerCase()}</a>)}</div> : <span className={mutedClass}>No linked closing PRs</span>}
                </td></tr> : null}
              </Fragment>)}
            </tbody>
          </table>
        ) : <p className="px-4 py-8 text-center text-sm text-slate-500">{loading ? "Loading issues…" : "No issues match this view."}</p>}
      </div> : null}
    </section>
  );
}

export function MilestoneTracker({ owner, repo, state, onStateChange, perPage, onPerPageChange }: { owner: string; repo: string; state: State; onStateChange: (state: State) => void; perPage: number; onPerPageChange: (perPage: number) => void }) {
  const [milestones, setMilestones] = useState<Milestone[]>([]);
  const [pagination, setPagination] = useState<Pagination | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [selectedMilestone, setSelectedMilestone] = useState<number | null>(null);
  const [scope, setScope] = useState<{ openIssues: number; closedIssues: number; openClosingPullRequests: number; mergedClosingPullRequests: number } | null>(null);
  const [scopeLoading, setScopeLoading] = useState(false);
  const [scopeError, setScopeError] = useState<string | null>(null);
  const [scopeIssues, setScopeIssues] = useState<Issue[]>([]);
  const [scopePagination, setScopePagination] = useState<Pagination | null>(null);
  const queryKey = JSON.stringify([owner, repo, state, perPage]);
  const [cachedQueryKey, setCachedQueryKey] = useState<string | null>(null);

  const load = useCallback(async (page: number) => {
    if (!owner || !repo) return;
    setLoading(true);
    setError(null);
    try {
      const q = new URLSearchParams({ owner, repo, state, page: String(page), perPage: String(perPage) });
      const res = await fetch(`/api/milestones?${q}`);
      const json = await res.json() as { milestones?: Milestone[]; pagination?: Pagination; error?: string };
      if (!res.ok) throw new Error(json.error ?? `Request failed (${res.status})`);
      setMilestones(json.milestones ?? []);
      setPagination(json.pagination ?? null);
      setCachedQueryKey(queryKey);
    } catch (e) {
      setMilestones([]);
      setPagination(null);
      setError(e instanceof Error ? e.message : "Failed to load milestones");
    } finally {
      setLoading(false);
    }
  }, [owner, repo, state, perPage, queryKey]);

  useEffect(() => {
    if (cachedQueryKey === queryKey) return;
    try {
      const cached = JSON.parse(sessionStorage.getItem(MILESTONES_CACHE_KEY) ?? "null") as {
        queryKey?: string; milestones?: Milestone[]; pagination?: Pagination | null;
        selectedMilestone?: number | null; scope?: { openIssues: number; closedIssues: number; openClosingPullRequests: number; mergedClosingPullRequests: number } | null;
        scopeIssues?: Issue[]; scopePagination?: Pagination | null;
      } | null;
      if (cached?.queryKey === queryKey && Array.isArray(cached.milestones) && cached.pagination) {
        setMilestones(cached.milestones);
        setPagination(cached.pagination);
        setSelectedMilestone(cached.scope ? cached.selectedMilestone ?? null : null);
        setScope(cached.scope ?? null);
        setScopeIssues(cached.scopeIssues ?? []);
        setScopePagination(cached.scopePagination ?? null);
        setCachedQueryKey(queryKey);
        return;
      }
    } catch { /* Cached milestone data is optional when browser storage is unavailable. */ }
    void load(1);
  }, [load, queryKey, cachedQueryKey]);

  useEffect(() => {
    if (cachedQueryKey !== queryKey || !pagination) return;
    try {
      sessionStorage.setItem(MILESTONES_CACHE_KEY, JSON.stringify({ queryKey, milestones, pagination, selectedMilestone: scope ? selectedMilestone : null, scope, scopeIssues, scopePagination }));
    } catch { /* Cached milestone data is optional when browser storage is unavailable. */ }
  }, [cachedQueryKey, queryKey, milestones, pagination, selectedMilestone, scope, scopeIssues, scopePagination]);

  const openMilestone = async (milestone: Milestone, page = 1) => {
    if (selectedMilestone === milestone.number && page === 1) { setSelectedMilestone(null); return; }
    if (selectedMilestone !== milestone.number) { setScope(null); setScopeIssues([]); setScopePagination(null); }
    setSelectedMilestone(milestone.number);
    setScopeLoading(true);
    setScopeError(null);
    try {
      const issueQuery = new URLSearchParams({ owner, repo, state: "all", page: String(page), perPage: String(perPage), milestone: String(milestone.number) });
      const summaryRequest = selectedMilestone === milestone.number && scope
        ? Promise.resolve(scope)
        : fetch(`/api/milestones/${milestone.number}?${new URLSearchParams({ owner, repo })}`).then(async (res) => {
            const data = await res.json() as { openIssues: number; closedIssues: number; openClosingPullRequests: number; mergedClosingPullRequests: number; error?: string };
            if (!res.ok) throw new Error(data.error ?? `Request failed (${res.status})`);
            return data;
          });
      const [summary, issuesRes] = await Promise.all([summaryRequest, fetch(`/api/issues?${issueQuery}`)]);
      const issues = await issuesRes.json() as { issues?: Issue[]; pagination?: Pagination; error?: string };
      if (!issuesRes.ok) throw new Error(issues.error ?? `Request failed (${issuesRes.status})`);
      setScope(summary);
      setScopeIssues((issues.issues ?? []).filter((issue) => !("pull_request" in issue)));
      setScopePagination(issues.pagination ?? null);
    } catch (e) {
      setScopeError(e instanceof Error ? e.message : "Could not load milestone scope");
      setScope(null);
      setScopeIssues([]);
    } finally { setScopeLoading(false); }
  };

  return (
    <section className="flex flex-col gap-3">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div><h2 className="text-lg font-medium">Milestones</h2><p className={mutedClass}>Progress and due dates for {owner}/{repo}.</p></div>
        <div className="flex flex-wrap items-end gap-2">
          <ListOptions idPrefix="milestones" state={state} onStateChange={onStateChange} perPage={perPage} onPerPageChange={onPerPageChange} />
          <button type="button" className="rounded-md border border-slate-300 px-3 py-1.5 text-sm hover:bg-slate-100 disabled:opacity-40 dark:border-slate-700 dark:hover:bg-slate-900" disabled={loading} onClick={() => void load(pagination?.page ?? 1)}>{loading ? "Loading…" : "Refresh"}</button>
          <Pager pagination={pagination} onPage={(page) => void load(page)} loading={loading} />
        </div>
      </div>
      {error ? <p role="alert" className="rounded-md border border-rose-300 bg-rose-50 px-3 py-2 text-sm text-rose-800 dark:border-rose-900/60 dark:bg-rose-950/40 dark:text-rose-100">{error}</p> : null}
      {!error ? milestones.length ? <div className="grid gap-3 md:grid-cols-2">
        {milestones.map((milestone) => {
          const total = milestone.open_issues + milestone.closed_issues;
          const progress = total ? Math.round((milestone.closed_issues / total) * 100) : 0;
          return <article key={milestone.number} className={panelClass}>
            <div className="flex items-start justify-between gap-3">
              <div><button type="button" aria-expanded={selectedMilestone === milestone.number} onClick={() => void openMilestone(milestone)} className="text-left font-semibold text-slate-800 hover:text-emerald-700 dark:text-slate-200 dark:hover:text-emerald-400">{milestone.title}</button><p className={`${mutedClass} mt-1`}>Milestone #{milestone.number} · {milestone.state} · <a href={milestone.html_url} target="_blank" rel="noreferrer" className="text-emerald-700 hover:underline dark:text-emerald-400">GitHub</a></p></div>
              <span className="shrink-0 rounded-full bg-emerald-100 px-2 py-1 text-xs font-semibold text-emerald-800 dark:bg-emerald-900/40 dark:text-emerald-300">{progress}%</span>
            </div>
            {milestone.description ? <p className="mt-3 line-clamp-2 text-sm text-slate-600 dark:text-slate-400">{milestone.description}</p> : null}
            <div className="mt-4 h-2 overflow-hidden rounded-full bg-slate-200 dark:bg-slate-800" role="progressbar" aria-label={`${milestone.title} completion`} aria-valuemin={0} aria-valuemax={100} aria-valuenow={progress}><div className="h-full rounded-full bg-emerald-500" style={{ width: `${progress}%` }} /></div>
            <div className="mt-2 flex items-center justify-between gap-2 text-xs text-slate-500 dark:text-slate-400"><span>{milestone.closed_issues} closed · {milestone.open_issues} open</span><span>{milestone.due_on ? `Due ${shortDate(milestone.due_on)}` : "No due date"}</span></div>
            {selectedMilestone === milestone.number ? <div className="mt-4 border-t border-slate-200 pt-3 dark:border-slate-800">
              {scopeError ? <p role="alert" className="text-xs text-rose-600">{scopeError}</p> : null}
              {scopeLoading ? <p className={mutedClass}>Loading full release scope…</p> : scope ? <>
                <div className="grid grid-cols-2 gap-2 text-xs sm:grid-cols-4"><span>{scope.openIssues} open issues</span><span>{scope.closedIssues} closed issues</span><span>{scope.openClosingPullRequests} open closing PRs</span><span>{scope.mergedClosingPullRequests} merged closing PRs</span></div>
                <div className="mt-3 flex items-center justify-between"><h3 className="text-xs font-semibold">Issues in milestone</h3><Pager pagination={scopePagination} onPage={(page) => void openMilestone(milestone, page)} loading={scopeLoading} /></div>
                {scopeIssues.length ? <ul className="mt-2 space-y-1">{scopeIssues.map((issue) => <li key={issue.number} className="text-xs"><a className="text-emerald-700 hover:underline dark:text-emerald-400" href={issue.html_url} target="_blank" rel="noreferrer">#{issue.number} {issue.title}</a><span className="ml-2 text-slate-500">{issue.state}</span></li>)}</ul> : <p className={`${mutedClass} mt-2`}>No issues in this milestone.</p>}
              </> : null}
            </div> : null}
          </article>;
        })}
      </div> : <div className={`${panelClass} py-8 text-center text-sm text-slate-500`}>{loading ? "Loading milestones…" : "No milestones match this view."}</div> : null}
    </section>
  );
}
