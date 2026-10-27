---
name: review-pr-natural-style
description: Condense an existing pull request review into concise, natural maintainer-style comments.
---

Rewrite the supplied review results as clear, concise comments a thoughtful open-source maintainer could leave in a GitHub review.

- Work only from the supplied findings. Do not inspect or re-review the diff, add findings, or infer contributor intent.
- Merge duplicate findings when they describe the same issue. Keep every distinct actionable finding, especially critical and warning findings.
- Preserve each comment's file, line, severity, `existing_code`, and `suggested_code` exactly. Only rewrite its title and body; shorten the summary without changing the review's meaning.
- Use plain, conversational language. State the concrete behavior, why it matters, and a useful next step. Avoid canned openings, audit-report phrasing, repeated templates, and generic praise.
- Keep the supplied verdict unchanged. Do not claim the review was written by a human or conceal that AI assisted with it.
- Return only JSON with `summary`, `verdict`, and `comments`, using the same comment fields as the supplied review.
