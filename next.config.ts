import type { NextConfig } from "next";

const nextConfig: NextConfig = {
    output: "standalone",
    outputFileTracingIncludes: {
        "/api/review": ["./.agents/skills/review-pr/SKILL.md", "./.agents/skills/ponytail-review/SKILL.md", "./.agents/skills/review-pr-natural-style/SKILL.md", ...["code-reviewer", "code-simplifier", "comment-analyzer", "pr-test-analyzer", "silent-failure-hunter", "type-design-analyzer"].map((name) => `./.agents/skills/review-pr/agents/${name}.md`)],
    },
};

export default nextConfig;
