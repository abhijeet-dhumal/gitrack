import { NextRequest, NextResponse } from "next/server";
import {
  getPullReviewThreadCounts,
  getPullDetail,
  listCheckRunsForRef,
  listCommitStatuses,
  listPullLinkedIssuesBatch,
  listPullRequests,
  listPullReviews,
  parseLinkHeader,
  searchPullRequestQueue,
  type PullListItem,
  type PullLinkedIssue,
} from "@/lib/github";
import { computeReadiness, summarizeChecks } from "@/lib/readiness";
import { withSessionOverrides, UnauthenticatedError } from "@/lib/session";

export const runtime = "nodejs";

async function enrichPull(owner: string, repo: string, prNumber: number) {
  const [detail, reviews, reviewThreads] = await Promise.all([
    getPullDetail(owner, repo, prNumber),
    listPullReviews(owner, repo, prNumber),
    getPullReviewThreadCounts(owner, repo, prNumber).catch(() => null),
  ]);
  const [checkRuns, commitStatuses] = await Promise.all([
    listCheckRunsForRef(owner, repo, detail.head.sha).catch(() => []),
    listCommitStatuses(owner, repo, detail.head.sha).catch(() => []),
  ]);
  const allChecks = [...checkRuns, ...commitStatuses];
  const checks = summarizeChecks(allChecks);
  const readiness = computeReadiness({
    draft: detail.draft,
    mergeable: detail.mergeable,
    mergeable_state: detail.mergeable_state,
    reviews,
    checkRuns: allChecks,
  });

  const activityDates: number[] = [];
  if (detail.updated_at) activityDates.push(Date.parse(detail.updated_at));
  for (const r of reviews) {
    if (r.submitted_at) activityDates.push(Date.parse(r.submitted_at));
  }
  const last_activity_at =
    activityDates.length > 0
      ? new Date(Math.max(...activityDates)).toISOString()
      : null;

  return {
    number: detail.number,
    title: detail.title,
    author: detail.user?.login ?? "",
    labels: detail.labels ?? [],
    state: detail.state,
    draft: detail.draft,
    mergeable: detail.mergeable,
    mergeable_state: detail.mergeable_state,
    head: detail.head.ref,
    head_sha: detail.head.sha,
    base: detail.base.ref,
    created_at: detail.created_at,
    updated_at: detail.updated_at,
    last_activity_at,
    comments: detail.comments,
    review_comments: detail.review_comments,
    commits: detail.commits,
    additions: detail.additions,
    deletions: detail.deletions,
    changed_files: detail.changed_files,
    readiness,
    checks: { total: checks.total, failing: checks.failing, pending: checks.pending },
    reviews,
    reviewThreads,
    requested_reviewers: detail.requested_reviewers ?? [],
    requested_teams: detail.requested_teams ?? [],
  };
}

async function includeLinkedIssues<T extends { number: number }>(owner: string, repo: string, pulls: T[]) {
  const linkedIssues: Record<number, PullLinkedIssue[]> = await listPullLinkedIssuesBatch(owner, repo, pulls.map((pull) => pull.number)).catch(() => ({}));
  return pulls.map((pull) => ({ ...pull, linkedIssues: linkedIssues[pull.number] ?? [] }));
}

export async function GET(req: NextRequest) {
  try {
    const { searchParams } = new URL(req.url);
    const owner = searchParams.get("owner")?.trim();
    const repo = searchParams.get("repo")?.trim();
    const search = searchParams.get("search")?.trim();
    const queueParam = searchParams.get("queue");
    const queue = queueParam === "needsReview" || queueParam === "needsChanges" || queueParam === "waitingOnChecks" ? queueParam : null;
    const page = Math.max(1, Number(searchParams.get("page") ?? "1") || 1);
    const perPage = Math.min(30, Math.max(1, Number(searchParams.get("perPage") ?? "10") || 10));
    const stateParam = (searchParams.get("state") ?? "open").toLowerCase();
    const state =
      stateParam === "closed" || stateParam === "all" ? (stateParam as "closed" | "all") : "open";
    const requestedSort = searchParams.get("sort");
    const sort = requestedSort === "created" || requestedSort === "popularity" || requestedSort === "long-running" ? requestedSort : "updated";
    const direction = searchParams.get("direction") === "asc" ? "asc" : "desc";

    if (!owner || !repo || !/^[A-Za-z0-9-]+$/.test(owner) || !/^[A-Za-z0-9._-]+$/.test(repo)) {
      return NextResponse.json({ error: "a valid owner and repo are required" }, { status: 400 });
    }

    return await withSessionOverrides(req, async (_llm) => {
      if (queue) {
        const { pullNumbers, totalCount, pagination } = await searchPullRequestQueue(owner, repo, queue, page, perPage, search);
        const enriched = await Promise.all(pullNumbers.map((number) => enrichPull(owner, repo, number)));
        return NextResponse.json({ pulls: await includeLinkedIssues(owner, repo, enriched), totalCount, pagination });
      }
      if (search) {
        const prNum = Number(search);
        if (Number.isFinite(prNum) && prNum > 0 && String(prNum) === search) {
          const enriched = await enrichPull(owner, repo, prNum).catch(() => null);
          return NextResponse.json({
            pulls: enriched ? await includeLinkedIssues(owner, repo, [enriched]) : [],
            pagination: { page: 1, perPage: 1, nextPage: null, lastPage: 1, hasMore: false },
          });
        }

        const searchLower = search.toLowerCase();
        const allPulls: PullListItem[] = [];
        let pg = 1;
        while (allPulls.length < 100) {
          const { pulls: batch } = await listPullRequests(owner, repo, { state, page: pg, perPage: 30, sort, direction });
          if (batch.length === 0) break;
          allPulls.push(...batch);
          if (batch.length < 30) break;
          pg++;
        }

        const matched = allPulls.filter((p) =>
          p.title.toLowerCase().includes(searchLower) ||
          p.user?.login.toLowerCase().includes(searchLower) ||
          p.head.ref.toLowerCase().includes(searchLower)
        );

        const enriched = await Promise.all(
          matched.slice(0, 20).map((p) => enrichPull(owner, repo, p.number).catch(() => null)),
        );
        const successful = enriched.filter((pull): pull is NonNullable<typeof pull> => pull !== null);
        return NextResponse.json({
          pulls: await includeLinkedIssues(owner, repo, successful),
          pagination: { page: 1, perPage: matched.length, nextPage: null, lastPage: 1, hasMore: false },
        });
      }

      const { pulls, link } = await listPullRequests(owner, repo, { state, page, perPage, sort, direction });
      const pages = parseLinkHeader(link);
      const enriched = await Promise.all(
        pulls.map((p) => enrichPull(owner, repo, p.number)),
      );
      const withIssues = await includeLinkedIssues(owner, repo, enriched);

      return NextResponse.json({
        pulls: withIssues,
        pagination: {
          page,
          perPage,
          nextPage: pages.next ?? null,
          lastPage: pages.last ?? null,
          hasMore: pages.next !== undefined,
        },
      });
    }, { requireLlm: false });
  } catch (e) {
    if (e instanceof UnauthenticatedError) {
      return NextResponse.json({ error: e.message }, { status: 401 });
    }
    const message = e instanceof Error ? e.message : "Unknown error";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
