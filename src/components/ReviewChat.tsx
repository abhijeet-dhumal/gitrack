"use client";

import { FormEvent, useEffect, useRef, useState } from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { buildLlmHeaders } from "@/lib/client-settings";

type Message = { role: "user" | "assistant"; content: string };
type ReviewContext = {
  summary?: string;
  verdict?: string;
  comments?: Array<{
    file: string;
    line?: string;
    severity: string;
    title: string;
    body: string;
    existing_code?: string;
    suggested_code?: string;
  }>;
};

export function ReviewChat({
  owner,
  repo,
  number,
  title,
  review,
}: {
  owner: string;
  repo: string;
  number: number;
  title: string;
  review: ReviewContext;
}) {
  const [messages, setMessages] = useState<Message[]>([]);
  const [draft, setDraft] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const endRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    endRef.current?.scrollIntoView({ block: "nearest" });
  }, [messages, loading]);

  async function send(event: FormEvent) {
    event.preventDefault();
    const content = draft.trim();
    if (!content || loading) return;
    const next = [...messages, { role: "user" as const, content }];
    setMessages(next);
    setDraft("");
    setError("");
    setLoading(true);
    try {
      const response = await fetch("/api/review/chat", {
        method: "POST",
        headers: { "content-type": "application/json", ...buildLlmHeaders() },
        body: JSON.stringify({ owner, repo, number, review, messages: next.slice(-12) }),
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error ?? `Chat failed (${response.status})`);
      setMessages([...next, { role: "assistant", content: data.reply }]);
    } catch (e) {
      setMessages(messages);
      setDraft(content);
      setError(e instanceof Error ? e.message : "Chat request failed");
    } finally {
      setLoading(false);
    }
  }

  return (
    <section className="mt-4 rounded-xl border border-slate-200 bg-slate-50/60 p-3 dark:border-slate-800 dark:bg-slate-900/40" aria-label={`Discuss pull request #${number}`}>
      <div className="mb-2">
        <h3 className="text-sm font-semibold">Discuss this review</h3>
        <p className="text-xs text-slate-500">Ask follow-up questions with the PR diff and review findings in context. This chat does not post to GitHub.</p>
      </div>
      <div className="max-h-72 space-y-3 overflow-y-auto rounded-lg border border-slate-200 bg-white p-3 dark:border-slate-800 dark:bg-slate-950" role="log" aria-live="polite" aria-relevant="additions text">
        {!messages.length ? <p className="text-sm text-slate-500">{title ? `Ask about “${title}” or any review finding.` : "Ask about the PR or any review finding."}</p> : null}
        {messages.map((message, index) => (
          <div key={index} className={`rounded-lg p-2 text-sm ${message.role === "user" ? "ml-8 bg-violet-50 text-slate-800 dark:bg-violet-950/40 dark:text-slate-200" : "mr-4 text-slate-700 dark:text-slate-300"}`}>
            <div className="mb-1 text-[10px] font-semibold uppercase tracking-wide text-slate-500">{message.role === "user" ? "You" : "Review assistant"}</div>
            <div className="prose prose-sm max-w-none dark:prose-invert"><ReactMarkdown remarkPlugins={[remarkGfm]}>{message.content}</ReactMarkdown></div>
          </div>
        ))}
        {loading ? <p className="text-sm text-slate-500" role="status">Thinking…</p> : null}
        <div ref={endRef} />
      </div>
      {error ? <p className="mt-2 text-xs text-rose-600 dark:text-rose-400" role="alert">{error}</p> : null}
      <form className="mt-2 flex items-end gap-2" onSubmit={send}>
        <label className="sr-only" htmlFor={`review-chat-${number}`}>Message about this pull request</label>
        <textarea
          id={`review-chat-${number}`}
          className="min-h-10 flex-1 resize-y rounded-md border border-slate-300 bg-white px-3 py-2 text-sm outline-none ring-violet-500/40 placeholder:text-slate-400 focus:ring-2 dark:border-slate-700 dark:bg-slate-950 dark:placeholder:text-slate-600"
          rows={2}
          maxLength={4000}
          placeholder="Ask a question or discuss a finding…"
          value={draft}
          onChange={(event) => setDraft(event.target.value)}
        />
        <button className="shrink-0 rounded-md bg-violet-600 px-3 py-2 text-xs font-medium text-white hover:bg-violet-500 disabled:opacity-40" type="submit" disabled={loading || !draft.trim()}>Send</button>
      </form>
    </section>
  );
}
