import { NextRequest, NextResponse } from "next/server";
import { githubFetch, listPullRequestsAwaitingReview, maintainerQueueSearchQuery } from "@/lib/github";
import { withSessionOverrides, UnauthenticatedError } from "@/lib/session";

export const runtime = "nodejs";

async function count(query: string) {
  const q = new URLSearchParams({ q: query, per_page: "1" });
  const res = await githubFetch(`/search/issues?${q}`);
  return ((await res.json()) as { total_count?: number }).total_count ?? 0;
}

export async function GET(req: NextRequest) {
  try {
    const { searchParams } = new URL(req.url);
    const owner = searchParams.get("owner")?.trim();
    const repo = searchParams.get("repo")?.trim();
    if (!owner || !repo || !/^[A-Za-z0-9-]+$/.test(owner) || !/^[A-Za-z0-9._-]+$/.test(repo)) return NextResponse.json({ error: "a valid owner and repo are required" }, { status: 400 });
    return await withSessionOverrides(req, async () => {
      const [needsTriage, reviewRequested, needsChanges, waitingOnChecks] = await Promise.all([
        count(maintainerQueueSearchQuery(owner, repo, "needsTriage")),
        listPullRequestsAwaitingReview(owner, repo),
        count(maintainerQueueSearchQuery(owner, repo, "needsChanges")),
        count(maintainerQueueSearchQuery(owner, repo, "waitingOnChecks")),
      ]);
      return NextResponse.json({ needsTriage, needsReview: reviewRequested.length, needsChanges, waitingOnChecks });
    }, { requireLlm: false });
  } catch (e) {
    if (e instanceof UnauthenticatedError) return NextResponse.json({ error: e.message }, { status: 401 });
    return NextResponse.json({ error: e instanceof Error ? e.message : "Unknown error" }, { status: 500 });
  }
}
