// Tavily Extract page materialization for plurnk's http scheme.
// {§tavily-plugin} — the HTTP family discovers this materializer; the operator selects
// it with PLURNK_SCHEMES_HTTP_MATERIALIZER=tavily-extract, and WebFetcher consults
// eligibility and extraction through the ordinary materializer contract.

import type { HttpMaterializer, MaterializerProblem, MaterializerResult } from "@plurnk/plurnk-schemes-http/materializer";
import { Knob } from "@plurnk/plurnk-meta";

export const TAVILY_DEPTH = "PLURNK_SCHEMES_HTTP_TAVILY_DEPTH";
export const TAVILY_TIMEOUT_MS = "PLURNK_SCHEMES_HTTP_TAVILY_TIMEOUT_MS";

export type TavilyDepth = "basic" | "advanced";
export type TavilyFailureReason =
    | "authentication"
    | "provider-rejection"
    | "rate-limit"
    | "server"
    | "failed-result"
    | "timeout"
    | "network"
    | "malformed-response";

const TAVILY_REQUEST_ID_HEADER = "x-plurnk-tavily-request-id";
const TAVILY_CREDITS_HEADER = "x-plurnk-tavily-credits";
const TAVILY_STATUS_HEADER = "x-plurnk-tavily-status";
const TAVILY_REASON_HEADER = "x-plurnk-tavily-reason";
const TAVILY_RETRY_AFTER_HEADER = "x-plurnk-tavily-retry-after";
const TAVILY_ELAPSED_HEADER = "x-plurnk-tavily-elapsed-ms";
const TAVILY_ERROR_HEADER = "x-plurnk-tavily-error";
const TAVILY_SOURCE_URL_HEADER = "x-plurnk-tavily-source-url";

interface TavilyEvidence {
    readonly status?: number;
    readonly requestId?: string;
    readonly credits?: number;
    readonly retryAfter?: string;
    readonly error?: string;
    readonly elapsedMs: number;
}

interface TavilyConfiguration {
    readonly apiKey: string;
    readonly depth: TavilyDepth;
    readonly timeoutMs: number;
    readonly identity: string;
}

export const tavilyConfiguration = (): TavilyConfiguration | null => {
    const configuredDepth = Knob.choice(TAVILY_DEPTH, ["basic", "advanced"]);
    const timeoutMs = Knob.integer(TAVILY_TIMEOUT_MS, 1);
    const apiKey = process.env.TAVILY_API_KEY?.trim() ?? "";
    if (apiKey.length === 0) return null;
    return {
        apiKey,
        depth: configuredDepth,
        timeoutMs,
        identity: `tavily-extract:v1:${configuredDepth}`,
    };
};

const elapsed = (started: number): number => Math.max(0, Math.round(performance.now() - started));

const bounded = (value: unknown): string => String(value).slice(0, 512);

const objectRecord = (value: unknown): Record<string, unknown> | null => value !== null
    && typeof value === "object"
    && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null;

const optionalString = (value: unknown): string | undefined => typeof value === "string" && value.length > 0
    ? value
    : undefined;

const reportedCredits = (value: unknown): number | undefined => {
    const usage = objectRecord(value);
    const credits = usage?.credits;
    return typeof credits === "number" && Number.isFinite(credits) && credits >= 0
        ? credits
        : undefined;
};

const responseError = async (response: Response): Promise<{
    error: string;
    requestId?: string;
    credits?: number;
}> => {
    const text = await response.text();
    let parsed: Record<string, unknown> | null = null;
    try { parsed = objectRecord(JSON.parse(text)); } catch {}
    const requestId = optionalString(parsed?.request_id)
        ?? optionalString(response.headers.get("x-request-id"));
    const credits = reportedCredits(parsed?.usage);
    const error = optionalString(parsed?.detail)
        ?? optionalString(parsed?.message)
        ?? optionalString(parsed?.error)
        ?? (text.length > 0 ? text : response.statusText);
    return {
        error: bounded(error),
        ...(requestId === undefined ? {} : { requestId }),
        ...(credits === undefined ? {} : { credits }),
    };
};

const safeEvidence = (value: string): string => value.replace(/[\r\n]+/g, " ").trim();

// The plugin owns its failure algebra: each Tavily outcome maps to one exact
// durable Problem; recoverable outcomes carry it for the no-local-floor case.
const problemFor = (url: string, reason: TavilyFailureReason, evidence: TavilyEvidence): MaterializerProblem => {
    const facts = {
        provider: "tavily",
        reason,
        ...(evidence.status === undefined ? {} : { providerStatus: evidence.status }),
        ...(evidence.requestId === undefined ? {} : { requestId: evidence.requestId }),
        ...(evidence.retryAfter === undefined ? {} : { retryAfter: evidence.retryAfter }),
    };
    if (reason === "rate-limit") {
        return { status: 429, code: "tavily-rate-limited", detail: `Tavily Extract rate-limited ${url}.`, retryable: true };
    }
    if (reason === "timeout") {
        return { status: 504, code: "tavily-timeout", detail: `Tavily Extract timed out for ${url}.`, retryable: true };
    }
    if (reason === "authentication") {
        return { status: 502, code: "tavily-authentication-failed", detail: "Tavily rejected the configured API credentials.", retryable: false };
    }
    if (reason === "malformed-response") {
        return { status: 502, code: "tavily-invalid-response", detail: "Tavily returned an invalid Extract response.", retryable: false };
    }
    if (reason === "provider-rejection") {
        return { status: 502, code: "tavily-provider-rejected", detail: `Tavily rejected extraction for ${url}.`, retryable: false };
    }
    void facts;
    return { status: 502, code: `tavily-${reason}`, detail: `Tavily Extract failed for ${url}.`, retryable: true };
};

const evidenceHeaders = (result: TavilyEvidence & { reason?: TavilyFailureReason; sourceUrl?: string; outcome: "success" | "recoverable" | "hard" }): MaterializerResult["evidence"] => {
    const lines: Array<{ name: string; value: string }> = [
        { name: TAVILY_STATUS_HEADER, value: String(result.status ?? "transport-failure") },
        { name: TAVILY_ELAPSED_HEADER, value: String(result.elapsedMs) },
    ];
    if (result.requestId !== undefined) lines.push({ name: TAVILY_REQUEST_ID_HEADER, value: safeEvidence(result.requestId) });
    if (result.credits !== undefined) lines.push({ name: TAVILY_CREDITS_HEADER, value: String(result.credits) });
    if (result.retryAfter !== undefined && result.outcome !== "success") lines.push({ name: TAVILY_RETRY_AFTER_HEADER, value: safeEvidence(result.retryAfter) });
    if (result.outcome === "success") {
        if (result.sourceUrl !== undefined) lines.push({ name: TAVILY_SOURCE_URL_HEADER, value: safeEvidence(result.sourceUrl) });
    } else if (result.reason !== undefined) {
        lines.push({ name: TAVILY_REASON_HEADER, value: result.reason });
    }
    if (result.error !== undefined && result.outcome !== "success") lines.push({ name: TAVILY_ERROR_HEADER, value: safeEvidence(result.error) });
    return lines;
};

export const materializer: HttpMaterializer = {
    id: "tavily-extract",

    async eligible(): Promise<string | null> {
        // Credential-free generic public requests only; the framework gates
        // authored metadata, the plugin gates its own credentials.
        return tavilyConfiguration()?.identity ?? null;
    },

    async extract(url: string, opts: { signal?: AbortSignal }): Promise<MaterializerResult> {
        const configured = tavilyConfiguration();
        if (configured === null) {
            throw new Error("tavily-extract: configuration disappeared during materialization.");
        }
        opts?.signal?.throwIfAborted();
        const started = performance.now();
        const timeout = AbortSignal.timeout(configured.timeoutMs);
        const signal = opts?.signal === undefined
            ? timeout
            : AbortSignal.any([opts.signal, timeout]);
        const interrupted = (cause: unknown): MaterializerResult => {
            if (opts?.signal?.aborted === true) throw opts.signal.reason;
            const reason: TavilyFailureReason = timeout.aborted ? "timeout" : "network";
            const evidence = {
                elapsedMs: elapsed(started),
                error: bounded(timeout.aborted ? timeout.reason : cause),
            };
            return {
                outcome: "recoverable",
                reason,
                identity: configured.identity,
                evidence: evidenceHeaders({ ...evidence, reason, outcome: "recoverable" }),
                problem: problemFor(url, reason, evidence),
            };
        };

        let response: Response;
        try {
            response = await fetch("https://api.tavily.com/extract", {
                method: "POST",
                headers: {
                    "Content-Type": "application/json",
                    "Authorization": `Bearer ${configured.apiKey}`,
                },
                body: JSON.stringify({
                    urls: [url],
                    extract_depth: configured.depth,
                    format: "markdown",
                    include_usage: true,
                }),
                signal,
            });
        } catch (cause) {
            return interrupted(cause);
        }

        if (!response.ok) {
            let parsed: Awaited<ReturnType<typeof responseError>>;
            try {
                parsed = await responseError(response);
            } catch (cause) {
                if (opts?.signal?.aborted === true || timeout.aborted) return interrupted(cause);
                parsed = { error: bounded(cause) };
            }
            const evidence = {
                status: response.status,
                elapsedMs: elapsed(started),
                ...parsed,
                ...(response.headers.get("retry-after") === null
                    ? {}
                    : { retryAfter: response.headers.get("retry-after")! }),
            };
            const reason: TavilyFailureReason = response.status === 401 || response.status === 403
                ? "authentication"
                : response.status === 429
                    ? "rate-limit"
                    : response.status >= 500
                        ? "server"
                        : "provider-rejection";
            const outcome = reason === "authentication" || reason === "provider-rejection" ? "hard" : "recoverable";
            return {
                outcome,
                identity: configured.identity,
                evidence: evidenceHeaders({ ...evidence, reason, outcome }),
                ...(outcome === "hard"
                    ? { problem: problemFor(url, reason, evidence) }
                    : { reason, problem: problemFor(url, reason, evidence) }),
            } as MaterializerResult;
        }

        let text: string;
        try {
            text = await response.text();
        } catch (cause) {
            return interrupted(cause);
        }
        let data: Record<string, unknown> | null;
        try {
            data = objectRecord(JSON.parse(text));
        } catch (cause) {
            const evidence = { status: response.status, elapsedMs: elapsed(started), error: bounded(cause) };
            const reason: TavilyFailureReason = "malformed-response";
            return {
                outcome: "hard",
                identity: configured.identity,
                evidence: evidenceHeaders({ ...evidence, reason, outcome: "hard" }),
                problem: problemFor(url, reason, evidence),
            };
        }
        if (data === null) {
            const evidence = { status: response.status, elapsedMs: elapsed(started), error: "Tavily Extract returned a non-object payload." };
            const reason: TavilyFailureReason = "malformed-response";
            return {
                outcome: "hard",
                identity: configured.identity,
                evidence: evidenceHeaders({ ...evidence, reason, outcome: "hard" }),
                problem: problemFor(url, reason, evidence),
            };
        }

        const requestId = optionalString(data.request_id);
        const credits = reportedCredits(data.usage);
        const evidence = {
            status: response.status,
            elapsedMs: elapsed(started),
            ...(requestId === undefined ? {} : { requestId }),
            ...(credits === undefined ? {} : { credits }),
        };
        const results = Array.isArray(data.results) ? data.results : [];
        const failedResults = Array.isArray(data.failed_results) ? data.failed_results : [];
        if (requestId === undefined || credits === undefined
            || (!Array.isArray(data.results) && !Array.isArray(data.failed_results))) {
            const reason: TavilyFailureReason = "malformed-response";
            const full = { ...evidence, error: "Tavily Extract omitted required results, request_id, or usage.credits evidence." };
            return {
                outcome: "hard",
                identity: configured.identity,
                evidence: evidenceHeaders({ ...full, reason, outcome: "hard" }),
                problem: problemFor(url, reason, full),
            };
        }

        const result = objectRecord(results[0]);
        const markdown = typeof result?.markdown === "string"
            ? result.markdown
            : typeof result?.raw_content === "string"
                ? result.raw_content
                : undefined;
        if (markdown !== undefined) {
            const sourceUrl = optionalString(result?.url);
            const full = { ...evidence, ...(sourceUrl === undefined ? {} : { sourceUrl }) };
            return {
                outcome: "success",
                body: markdown,
                identity: configured.identity,
                evidence: evidenceHeaders({ ...full, outcome: "success" }),
            };
        }

        const failedResult = objectRecord(failedResults[0]);
        if (failedResult !== null) {
            const reason: TavilyFailureReason = "failed-result";
            const full = {
                ...evidence,
                error: bounded(optionalString(failedResult.error) ?? "Tavily Extract could not extract the URL."),
            };
            return {
                outcome: "recoverable",
                reason,
                identity: configured.identity,
                evidence: evidenceHeaders({ ...full, reason, outcome: "recoverable" }),
                problem: problemFor(url, reason, full),
            };
        }
        const reason: TavilyFailureReason = "malformed-response";
        const full = { ...evidence, error: "Tavily Extract returned neither Markdown nor a failed_results occurrence." };
        return {
            outcome: "hard",
            identity: configured.identity,
            evidence: evidenceHeaders({ ...full, reason, outcome: "hard" }),
            problem: problemFor(url, reason, full),
        };
    },
};

export default materializer;
