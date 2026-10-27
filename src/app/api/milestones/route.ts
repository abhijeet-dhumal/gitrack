import { NextRequest, NextResponse } from "next/server";
import { listMilestones, parseLinkHeader } from "@/lib/github";
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

    if (!owner || !repo) return NextResponse.json({ error: "owner and repo are required" }, { status: 400 });

    return await withSessionOverrides(req, async () => {
      const { milestones, link } = await listMilestones(owner, repo, { state, page, perPage });
      const pages = parseLinkHeader(link);
      return NextResponse.json({
        milestones,
        pagination: { page, perPage, nextPage: pages.next ?? null, lastPage: pages.last ?? null, hasMore: pages.next !== undefined },
      });
    }, { requireLlm: false });
  } catch (e) {
    if (e instanceof UnauthenticatedError) return NextResponse.json({ error: e.message }, { status: 401 });
    return NextResponse.json({ error: e instanceof Error ? e.message : "Unknown error" }, { status: 500 });
  }
}
