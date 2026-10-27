import { NextRequest, NextResponse } from "next/server";
import { listPullLinkedIssues } from "@/lib/github";
import { UnauthenticatedError, withSessionOverrides } from "@/lib/session";

export const runtime = "nodejs";

export async function GET(req: NextRequest, { params }: { params: Promise<{ number: string }> }) {
  try {
    const { number: rawNumber } = await params;
    const number = Number(rawNumber);
    const { searchParams } = new URL(req.url);
    const owner = searchParams.get("owner")?.trim();
    const repo = searchParams.get("repo")?.trim();
    if (!owner || !repo || !/^[A-Za-z0-9-]+$/.test(owner) || !/^[A-Za-z0-9._-]+$/.test(repo) || !Number.isSafeInteger(number) || number < 1) {
      return NextResponse.json({ error: "valid owner, repo and pull request number are required" }, { status: 400 });
    }

    return await withSessionOverrides(req, async () => NextResponse.json({ issues: await listPullLinkedIssues(owner, repo, number) }), { requireLlm: false });
  } catch (error) {
    if (error instanceof UnauthenticatedError) return NextResponse.json({ error: error.message }, { status: 401 });
    return NextResponse.json({ error: error instanceof Error ? error.message : "Unknown error" }, { status: 500 });
  }
}
