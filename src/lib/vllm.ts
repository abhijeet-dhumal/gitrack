type ChatCompletionsResponse = {
    choices?: Array<{
        message?: { content?: string | null };
    }>;
};

type AnthropicMessagesResponse = {
    content?: Array<{ type?: string; text?: string }>;
};

type ModelsResponse = {
    data?: Array<{ id: string }>;
};

function apiBaseUrl(host: string): string {
    return `${host.replace(/\/+$/, "").replace(/\/v1$/, "")}/v1`;
}

function isAnthropicMessagesEndpoint(host: string): boolean {
    try {
        return /\/v\d+\/messages\/?$/i.test(new URL(host).pathname);
    } catch {
        return false;
    }
}

async function resolveModel(configured: string, host: string, apiKey?: string): Promise<string> {
    if (configured && configured !== "default" && configured !== "auto") {
        return configured;
    }

    const baseUrl = apiBaseUrl(host);
    const headers: Record<string, string> = { "content-type": "application/json" };
    if (apiKey) headers.Authorization = `Bearer ${apiKey}`;

    try {
        const res = await fetch(`${baseUrl}/models`, {
            headers,
            cache: "no-store",
        });
        if (res.ok) {
            const json = (await res.json()) as ModelsResponse;
            const first = json.data?.[0]?.id;
            if (first) return first;
        }
    } catch { /* fall through */ }
    throw new Error("Failed to detect vLLM model — set VLLM_MODEL or configure it in Settings");
}

export async function callVllmChatCompletions(input: {
    model: string;
    prompt: string;
    maxTokens: number;
    host: string;
    apiKey?: string;
}): Promise<string> {
    if (isAnthropicMessagesEndpoint(input.host)) {
        const headers: Record<string, string> = {
            "content-type": "application/json",
            "anthropic-version": "2023-06-01",
        };
        if (input.apiKey) headers["x-api-key"] = input.apiKey;

        const res = await fetch(input.host, {
            method: "POST",
            headers,
            body: JSON.stringify({
                model: input.model,
                max_tokens: input.maxTokens,
                messages: [{ role: "user", content: input.prompt }],
            }),
            cache: "no-store",
        });
        if (!res.ok) {
            const text = await res.text();
            throw new Error(`Failed to call Anthropic-compatible endpoint (${res.status}): ${text.slice(0, 800)}`);
        }
        const json = (await res.json()) as AnthropicMessagesResponse;
        return (json.content ?? [])
            .filter((block) => block.type === "text" && typeof block.text === "string")
            .map((block) => block.text!.trim())
            .filter(Boolean)
            .join("\n");
    }

    const baseUrl = apiBaseUrl(input.host);
    const model = await resolveModel(input.model, input.host, input.apiKey);

    const headers: Record<string, string> = { "content-type": "application/json" };
    if (input.apiKey) headers.Authorization = `Bearer ${input.apiKey}`;

    const res = await fetch(`${baseUrl}/chat/completions`, {
        method: "POST",
        headers,
        body: JSON.stringify({
            model,
            messages: [{ role: "user", content: input.prompt }],
            temperature: 0.2,
            max_tokens: input.maxTokens,
        }),
        cache: "no-store",
    });

    if (!res.ok) {
        const text = await res.text();
        throw new Error(`Failed to call vLLM (${res.status}): ${text.slice(0, 800)}`);
    }

    const json = (await res.json()) as ChatCompletionsResponse;
    const content = json.choices?.[0]?.message?.content;
    return (content ?? "").trim();
}
