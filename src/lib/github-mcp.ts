import { Client, StreamableHTTPClientTransport, type CallToolResult } from "@modelcontextprotocol/client";

const GITHUB_MCP_URL = "https://api.githubcopilot.com/mcp/";
const MAX_CONTEXT_CHARS = 36_000;
const MAX_FILE_COUNT = 5;
const MAX_FILE_CHARS = 5_000;

type ContextResult = {
    context: string | null;
    warning?: string;
};

function resultText(result: CallToolResult): string {
    if (result.isError) throw new Error("GitHub MCP tool returned an error");
    if (result.structuredContent !== undefined) return JSON.stringify(result.structuredContent);
    return result.content
        .flatMap((item) => item.type === "text" ? [item.text] : [])
        .join("\n")
        .trim();
}

function findChangedPaths(value: unknown, paths = new Set<string>()): string[] {
    if (Array.isArray(value)) {
        for (const item of value) findChangedPaths(item, paths);
    } else if (typeof value === "object" && value !== null) {
        const record = value as Record<string, unknown>;
        const candidate = typeof record.filename === "string" ? record.filename : record.path;
        if (typeof candidate === "string" && candidate.length < 500 && !candidate.startsWith("/")) paths.add(candidate);
        for (const item of Object.values(record)) findChangedPaths(item, paths);
    } else if (typeof value === "string") {
        try {
            findChangedPaths(JSON.parse(value), paths);
        } catch {
            // MCP servers may return a textual representation; source files are optional context.
        }
    }
    return [...paths];
}

function parseStructuredText(text: string): unknown {
    try {
        return JSON.parse(text);
    } catch {
        const start = text.search(/[\[{]/);
        if (start < 0) return null;
        try {
            return JSON.parse(text.slice(start));
        } catch {
            return null;
        }
    }
}

function appendBounded(parts: string[], heading: string, content: string, budget: number): number {
    if (!content) return budget;
    const section = `\n\n## ${heading}\n${content.slice(0, Math.max(0, budget))}`;
    if (section.length <= 4) return budget;
    parts.push(section);
    return Math.max(0, budget - section.length);
}

/** Fetch review-only GitHub context through GitHub's hosted MCP endpoint. */
export async function getGithubMcpReviewContext(
    token: string,
    owner: string,
    repo: string,
    number: number,
    headSha: string,
): Promise<ContextResult> {
    const transport = new StreamableHTTPClientTransport(new URL(GITHUB_MCP_URL), {
        authProvider: { token: async () => token },
        requestInit: {
            headers: {
                "X-MCP-Tools": "pull_request_read,get_file_contents",
                "X-MCP-Readonly": "true",
            },
        },
    });
    const client = new Client({ name: "gitrack-review", version: "0.3.0" });
    const args = { owner, repo, pullNumber: number };

    try {
        await client.connect(transport, { timeout: 10_000 });
        const methods = ["get", "get_files", "get_reviews", "get_review_comments", "get_comments"] as const;
        const results = await Promise.allSettled(methods.map((method) => client.callTool({
            name: "pull_request_read",
            arguments: { ...args, method, perPage: method === "get_files" ? 30 : 20 },
        }, { timeout: 8_000, maxTotalTimeout: 10_000 })));

        const sections: Array<{ name: string; text: string }> = [];
        const warnings: string[] = [];
        let changedFiles: unknown = null;
        for (let index = 0; index < results.length; index++) {
            const result = results[index];
            if (result.status === "rejected") {
                warnings.push(methods[index]);
                continue;
            }
            try {
                const text = resultText(result.value);
                if (methods[index] === "get_files") changedFiles = result.value.structuredContent ?? parseStructuredText(text);
                if (text && methods[index] !== "get_files") sections.push({ name: methods[index], text });
                else if (!text && methods[index] !== "get_files") warnings.push(methods[index]);
            } catch {
                warnings.push(methods[index]);
            }
        }

        const changedPaths = findChangedPaths(changedFiles).slice(0, MAX_FILE_COUNT);
        if (changedPaths.length) sections.push({ name: "changed file paths", text: changedPaths.join("\n") });
        const fileResults = await Promise.allSettled(changedPaths.map((path) => client.callTool({
            name: "get_file_contents",
            arguments: { owner, repo, path, ref: headSha },
        }, { timeout: 8_000, maxTotalTimeout: 10_000 })));
        for (let index = 0; index < fileResults.length; index++) {
            const result = fileResults[index];
            if (result.status === "rejected") {
                warnings.push("changed file contents");
                continue;
            }
            try {
                const text = resultText(result.value);
                if (text) sections.push({ name: `changed file ${changedPaths[index]}`, text: text.slice(0, MAX_FILE_CHARS) });
                else warnings.push("changed file contents");
            } catch {
                warnings.push("changed file contents");
            }
        }

        const parts: string[] = [];
        let remaining = MAX_CONTEXT_CHARS;
        for (const section of sections) {
            if (!remaining) break;
            remaining = appendBounded(parts, section.name, section.text, remaining);
        }
        if (!parts.length) return { context: null, warning: "GitHub MCP returned no usable context; review used the PR diff and existing GitHub data." };
        return {
            context: parts.join("").slice(0, MAX_CONTEXT_CHARS),
            ...(warnings.length ? { warning: "Some GitHub MCP context could not be loaded; review used the available context." } : {}),
        };
    } catch {
        return { context: null, warning: "GitHub MCP could not be reached; review used the PR diff and existing GitHub data." };
    } finally {
        await client.close().catch(() => undefined);
    }
}
