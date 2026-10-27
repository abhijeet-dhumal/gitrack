import { NextRequest, NextResponse } from "next/server";
import { getPullDetail, getPullDiff, getPullReviewThreadCounts, listCheckRunsForRef, listCommitStatuses, listPullReviews } from "@/lib/github";
import { reviewPull } from "@/lib/review";
import { summarizeChecks } from "@/lib/readiness";
import { withSessionOverrides, UnauthenticatedError } from "@/lib/session";
import { LlmNotConfiguredError } from "@/lib/llm";
import { getGithubToken } from "@/lib/request-context";
import { getGithubMcpReviewContext } from "@/lib/github-mcp";

export const runtime = "nodejs";

const DEFAULT_MAX_DIFF = 140_000;

export async function POST(req: NextRequest) {
    try {
        const body = (await req.json()) as {
            owner?: string;
            repo?: string;
            number?: number;
            maxDiffChars?: number;
            customPrompt?: string;
            repoRulesContext?: string;
            naturalReview?: boolean;
            githubMcpContext?: boolean;
        };

        const owner = body.owner?.trim();
        const repo = body.repo?.trim();
        const number = body.number;

        if (!owner || !repo || typeof number !== "number" || !Number.isFinite(number)) {
            return NextResponse.json(
                { error: "owner, repo, and numeric number are required" },
                { status: 400 },
            );
        }

        const maxDiffChars =
            typeof body.maxDiffChars === "number" && body.maxDiffChars > 0
                ? Math.min(body.maxDiffChars, 250_000)
                : DEFAULT_MAX_DIFF;

        const result = await withSessionOverrides(req, async (llmConfig) => {
            const detail = await getPullDetail(owner, repo, number);
            const [diff, reviews, reviewThreads, checkRuns, commitStatuses, githubMcp] = await Promise.all([
                getPullDiff(owner, repo, number),
                listPullReviews(owner, repo, number).catch(() => null),
                getPullReviewThreadCounts(owner, repo, number).catch(() => null),
                listCheckRunsForRef(owner, repo, detail.head.sha).catch(() => null),
                listCommitStatuses(owner, repo, detail.head.sha).catch(() => null),
                body.githubMcpContext === true
                    ? getGithubMcpReviewContext(getGithubToken(), owner, repo, number, detail.head.sha)
                    : Promise.resolve(null),
            ]);
            const latestByReviewer = new Map<string, (NonNullable<typeof reviews>[number])>();
            for (const review of [...(reviews ?? [])].sort((a, b) => Date.parse(a.submitted_at ?? "") - Date.parse(b.submitted_at ?? ""))) {
                const login = review.user?.login;
                if (!login) continue;
                if (review.state === "DISMISSED") latestByReviewer.delete(login);
                else latestByReviewer.set(login, review);
            }
            const checks = checkRuns && commitStatuses
                ? summarizeChecks([...checkRuns, ...commitStatuses])
                : null;
            const review = await reviewPull({
                owner,
                repo,
                number,
                title: detail.title,
                diff,
                maxDiffChars,
                customPrompt: body.customPrompt?.trim(),
                repoRulesContext: body.repoRulesContext?.trim(),
                githubMcpContext: githubMcp?.context ?? undefined,
                naturalReview: body.naturalReview === true,
                reviewProgress: {
                    state: detail.state,
                    draft: detail.draft,
                    mergeable: detail.mergeable,
                    mergeableState: detail.mergeable_state,
                    requestedReviewers: (detail.requested_reviewers ?? []).map(({ login }) => login),
                    requestedTeams: (detail.requested_teams ?? []).map(({ slug }) => slug),
                    checks: checks ? { total: checks.total, passing: checks.passing, failing: checks.failing, pending: checks.pending } : null,
                    latestReviews: reviews ? [...latestByReviewer.values()].map((item) => ({
                        reviewer: item.user?.login ?? "",
                        state: item.state,
                        submittedAt: item.submitted_at,
                        commitId: item.commit_id,
                    })) : null,
                    unresolvedReviewThreads: reviewThreads?.unresolved ?? null,
                },
                llmConfig: llmConfig!,
            });
            return { detail, review, githubMcp };
        });

        const warning = [result.review.warning, result.githubMcp?.warning].filter(Boolean).join(" ") || undefined;
        return NextResponse.json({
            number,
            title: result.detail.title,
            model: result.review.model,
            summary: result.review.summary,
            verdict: result.review.verdict,
            comments: result.review.comments,
            mergeReadinessScore: result.review.mergeReadinessScore,
            mergeReadinessReason: result.review.mergeReadinessReason,
            reviewedHeadSha: result.detail.head.sha,
            markdown: result.review.markdown,
            warning,
            githubMcpContextLoaded: Boolean(result.githubMcp?.context),
        });
    } catch (e) {
        if (e instanceof UnauthenticatedError) {
            return NextResponse.json({ error: e.message }, { status: 401 });
        }
        if (e instanceof LlmNotConfiguredError) {
            return NextResponse.json({ error: e.message }, { status: 422 });
        }
        const message = e instanceof Error ? e.message : "Unknown error";
        return NextResponse.json({ error: message }, { status: 500 });
    }
}
