import { NextRequest, NextResponse } from "next/server";
import { getMilestoneClosingPullRequestCounts } from "@/lib/github";
import { withSessionOverrides, UnauthenticatedError } from "@/lib/session";

export const runtime = "nodejs";

export async function GET(req: NextRequest, { params }: { params: Promise<{ number: string }> }) {
  try {
    const { number: rawNumber } = await params;
    const number = Number(rawNumber);
    const { searchParams } = new URL(req.url);
    const owner = searchParams.get("owner")?.trim();
    const repo = searchParams.get("repo")?.trim();
    if (!owner || !repo || !/^[A-Za-z0-9-]+$/.test(owner) || !/^[A-Za-z0-9._-]+$/.test(repo) || !Number.isSafeInteger(number) || number < 1) {
      return NextResponse.json({ error: "valid owner, repo and milestone number are required" }, { status: 400 });
    }
    return await withSessionOverrides(req, async () => NextResponse.json(await getMilestoneClosingPullRequestCounts(owner, repo, number)), { requireLlm: false });
  } catch (e) {
    if (e instanceof UnauthenticatedError) return NextResponse.json({ error: e.message }, { status: 401 });
    return NextResponse.json({ error: e instanceof Error ? e.message : "Unknown error" }, { status: 500 });
  }
}
