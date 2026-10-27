import { NextRequest, NextResponse } from "next/server";
import { listIssues, parseLinkHeader } from "@/lib/github";
import { withSessionOverrides, UnauthenticatedError } from "@/lib/session";

export const runtime = "nodejs";

export async function GET(req: NextRequest) {
  try {
    const { searchParams } = new URL(req.url);
    const owner = searchParams.get("owner")?.trim();
    const repo = searchParams.get("repo")?.trim();
    const page = Math.max(1, Number(searchParams.get("page") ?? "1") || 1);
    const perPage = Math.min(100, Math.max(1, Number(searchParams.get("perPage") ?? "10") || 10));
    const stateParam = searchParams.get("state")?.toLowerCase();
    const state = stateParam === "closed" || stateParam === "all" ? stateParam : "open";
    const filterParam = searchParams.get("filter");
    const filter = ["needs-triage", "unassigned", "no-milestone", "no-label", "has-comments"].includes(filterParam ?? "") ? filterParam as "needs-triage" | "unassigned" | "no-milestone" | "no-label" | "has-comments" : "all";
    const search = searchParams.get("search")?.trim();
    const loginParam = (value: string | null) => value && /^[A-Za-z0-9](?:[A-Za-z0-9-]{0,38})$/.test(value) ? value : undefined;
    const author = loginParam(searchParams.get("author"));
    const assignee = loginParam(searchParams.get("assignee"));
    const labelParam = searchParams.get("label")?.trim();
    const milestoneTitleParam = searchParams.get("milestoneTitle")?.trim();
    const label = labelParam && labelParam.length <= 100 && !/[\r\n]/.test(labelParam) ? labelParam : undefined;
    const milestoneTitle = milestoneTitleParam && milestoneTitleParam.length <= 100 && !/[\r\n]/.test(milestoneTitleParam) ? milestoneTitleParam : undefined;
    const sortParam = searchParams.get("sort");
    const sort = sortParam === "created" || sortParam === "comments" ? sortParam : "updated";
    const direction = searchParams.get("direction") === "asc" ? "asc" : "desc";
    const milestoneParam = Number(searchParams.get("milestone"));
    const milestone = Number.isSafeInteger(milestoneParam) && milestoneParam > 0 ? milestoneParam : undefined;

    if (!owner || !repo || !/^[A-Za-z0-9-]+$/.test(owner) || !/^[A-Za-z0-9._-]+$/.test(repo)) {
      return NextResponse.json({ error: "a valid owner and repo are required" }, { status: 400 });
    }

    return await withSessionOverrides(req, async () => {
      const { issues, totalCount, link } = await listIssues(owner, repo, { state, page, perPage, filter, milestone, search, author, assignee, label, milestoneTitle, sort, direction });
      const pages = parseLinkHeader(link);
      return NextResponse.json({
        issues,
        totalCount,
        pagination: { page, perPage, nextPage: pages.next ?? null, lastPage: pages.last ?? null, hasMore: pages.next !== undefined },
      });
    }, { requireLlm: false });
  } catch (e) {
    if (e instanceof UnauthenticatedError) return NextResponse.json({ error: e.message }, { status: 401 });
    return NextResponse.json({ error: e instanceof Error ? e.message : "Unknown error" }, { status: 500 });
  }
}
