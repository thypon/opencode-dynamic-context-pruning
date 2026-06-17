import { Logger } from "../logger"

interface ProviderConfig {
    endpoint: string
    headers: (apiKey: string) => Record<string, string>
    buildBody: (model: string, prompt: string) => unknown
}

const PROVIDERS: Record<string, ProviderConfig> = {
    venice: {
        endpoint: "https://api.venice.ai/api/v1/chat/completions",
        headers: (apiKey: string) => ({
            Authorization: `Bearer ${apiKey}`,
            "Content-Type": "application/json",
        }),
        buildBody: (model: string, prompt: string) => ({
            model,
            messages: [{ role: "user", content: prompt }],
            max_tokens: 2048,
            temperature: 0,
        }),
    },
    openrouter: {
        endpoint: "https://openrouter.ai/api/v1/chat/completions",
        headers: (apiKey: string) => ({
            Authorization: `Bearer ${apiKey}`,
            "Content-Type": "application/json",
        }),
        buildBody: (model: string, prompt: string) => ({
            model,
            messages: [{ role: "user", content: prompt }],
            max_tokens: 2048,
            temperature: 0,
        }),
    },
    anthropic: {
        endpoint: "https://api.anthropic.com/v1/messages",
        headers: (apiKey: string) => ({
            "x-api-key": apiKey,
            "anthropic-version": "2023-06-01",
            "Content-Type": "application/json",
        }),
        buildBody: (model: string, prompt: string) => ({
            model,
            max_tokens: 2048,
            messages: [{ role: "user", content: prompt }],
        }),
    },
    minimax: {
        endpoint: "https://api.minimax.chat/v1/text/chatcompletion_v2",
        headers: (apiKey: string) => ({
            Authorization: `Bearer ${apiKey}`,
            "Content-Type": "application/json",
        }),
        buildBody: (model: string, prompt: string) => ({
            model,
            messages: [{ role: "user", content: prompt }],
            tokens_to_generate: 2048,
        }),
    },
}

function getApiKey(provider: string): string | undefined {
    const key = `${provider.toUpperCase()}_API_KEY`
    return process.env[key]
}

function parseContent(data: any, provider: string): string {
    if (provider === "anthropic") {
        return data?.content?.[0]?.text ?? ""
    }
    if (provider === "minimax") {
        return data?.reply ?? ""
    }
    return data?.choices?.[0]?.message?.content ?? ""
}

const PROMPT_TEMPLATE = `You are a conversation summarizer. Compress the following context into a dense, high-fidelity summary.

RULES:
- Write in caveman style: fragments OK, drop articles, no filler
- Capture ALL technical substance: file paths, function signatures, decisions, constraints, key findings
- Preserve user intent exactly — use direct quotes for short user messages
- Strip noise: failed attempts, verbose output, repetition
- Write lean — pure signal

CONTEXT TO SUMMARIZE:
{context}

Return ONLY the summary. No preamble, no explanation.`

export async function generateSummary(
    model: string,
    originalSummary: string,
    logger: Logger,
): Promise<string> {
    const slashIdx = model.indexOf("/")
    if (slashIdx === -1) {
        logger.warn(`compress.model "${model}" lacks provider/ prefix, skipping generation`)
        return originalSummary
    }

    const provider = model.slice(0, slashIdx)
    const providerModel = model.slice(slashIdx + 1)
    const providerConfig = PROVIDERS[provider]

    if (!providerConfig) {
        logger.warn(`Unsupported compress.model provider "${provider}", skipping generation`)
        return originalSummary
    }

    const apiKey = getApiKey(provider)
    if (!apiKey) {
        logger.warn(
            `No ${provider.toUpperCase()}_API_KEY env var for compress.model, skipping generation`,
        )
        return originalSummary
    }

    const prompt = PROMPT_TEMPLATE.replace("{context}", originalSummary)

    try {
        const response = await fetch(providerConfig.endpoint, {
            method: "POST",
            headers: providerConfig.headers(apiKey),
            body: JSON.stringify(providerConfig.buildBody(providerModel, prompt)),
        })

        if (!response.ok) {
            const errorText = await response.text().catch(() => "")
            logger.warn(
                `compress.model API error ${response.status}: ${errorText.slice(0, 200)}`,
            )
            return originalSummary
        }

        const data = await response.json()
        const content = parseContent(data, provider)

        if (!content) {
            logger.warn("compress.model returned empty content, using original summary")
            return originalSummary
        }

        logger.info(`compress.model generated summary (${content.length} chars)`)
        return content
    } catch (err: any) {
        logger.warn(`compress.model call failed: ${err.message}, using original summary`)
        return originalSummary
    }
}
