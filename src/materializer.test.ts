// Hermetic materializer coverage: mocked global fetch, no network. The
// composition test discovers the declared built materializer through the HTTP family
// and exercises extraction through the framework's WebFetcher.

import test, { after, beforeEach } from "node:test";
import { strict as assert } from "node:assert";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { materializer, tavilyConfiguration } from "./materializer.ts";
import { validateManifest } from "@plurnk/plurnk-meta/agent-plugin";

const originalKey = process.env.TAVILY_API_KEY;
const originalDepth = process.env.PLURNK_SCHEMES_HTTP_TAVILY_DEPTH;
const originalTimeout = process.env.PLURNK_SCHEMES_HTTP_TAVILY_TIMEOUT_MS;
beforeEach(() => {
    delete process.env.TAVILY_API_KEY;
    process.env.PLURNK_SCHEMES_HTTP_TAVILY_DEPTH = "basic";
    process.env.PLURNK_SCHEMES_HTTP_TAVILY_TIMEOUT_MS = "30000";
});
after(() => {
    if (originalKey === undefined) delete process.env.TAVILY_API_KEY;
    else process.env.TAVILY_API_KEY = originalKey;
    if (originalDepth === undefined) delete process.env.PLURNK_SCHEMES_HTTP_TAVILY_DEPTH;
    else process.env.PLURNK_SCHEMES_HTTP_TAVILY_DEPTH = originalDepth;
    if (originalTimeout === undefined) delete process.env.PLURNK_SCHEMES_HTTP_TAVILY_TIMEOUT_MS;
    else process.env.PLURNK_SCHEMES_HTTP_TAVILY_TIMEOUT_MS = originalTimeout;
});

const withFetch = async (impl: typeof fetch, fn: () => Promise<void>) => {
    const orig = globalThis.fetch;
    globalThis.fetch = impl;
    try { await fn(); } finally { globalThis.fetch = orig; }
};
const resp = (body: string, status: number, headers: Record<string, string> = {}) =>
    new Response(body, { status, headers: { "content-type": "application/json", ...headers } });

test("{§tavily-plugin} a standard plugin owns the native declaration; npm only delivers it", async () => {
    const plugin = validateManifest(JSON.parse(await readFile(new URL("../plugin.json", import.meta.url), "utf8")));
    assert.ok("manifest" in plugin);
    assert.deepEqual(plugin.ignored, []);
    assert.equal(plugin.manifest.name, "plurnk-tavily-plugin");
    assert.deepEqual(plugin.manifest.extensions?.["ai.plurnk"], {
        kind: "http-materializer",
        materializers: [{ id: "tavily-extract", module: "ai.plurnk/dist/materializer.js" }],
    });
    const pkg = JSON.parse(await readFile(new URL("../package.json", import.meta.url), "utf8"));
    assert.equal(pkg.name, "@plurnk/plurnk-tavily-plugin");
    assert.equal(pkg.plurnk?.kind, undefined, "no second native declaration");
});

test("eligibility: absence is the mode — no key means the local projection produces the body", () => {
    assert.equal(tavilyConfiguration(), null);
});

test("eligibility: a configured key yields the depth-bearing identity", async () => {
    process.env.TAVILY_API_KEY = "tvly-test";
    assert.equal(await materializer.eligible("https://example.com/x", {}), "tavily-extract:v1:basic");
    process.env.PLURNK_SCHEMES_HTTP_TAVILY_DEPTH = "advanced";
    assert.equal(await materializer.eligible("https://example.com/x", {}), "tavily-extract:v1:advanced");
});

test("eligibility: an invalid depth fails loudly, never guesses", () => {
    process.env.PLURNK_SCHEMES_HTTP_TAVILY_DEPTH = "automatic";
    assert.throws(() => tavilyConfiguration(), {
        name: "ConfigurationError",
        message: 'PLURNK_SCHEMES_HTTP_TAVILY_DEPTH must be one of basic, advanced; got "automatic".',
    });
});

test("configuration: invalid operator settings identify their key as ConfigurationError", () => {
    const cases = [
        ["PLURNK_SCHEMES_HTTP_TAVILY_DEPTH", "automatic"],
        ["PLURNK_SCHEMES_HTTP_TAVILY_TIMEOUT_MS", ""],
        ["PLURNK_SCHEMES_HTTP_TAVILY_TIMEOUT_MS", "0"],
        ["PLURNK_SCHEMES_HTTP_TAVILY_TIMEOUT_MS", "-1"],
        ["PLURNK_SCHEMES_HTTP_TAVILY_TIMEOUT_MS", "1.5"],
        ["PLURNK_SCHEMES_HTTP_TAVILY_TIMEOUT_MS", "NaN"],
        ["PLURNK_SCHEMES_HTTP_TAVILY_TIMEOUT_MS", "9007199254740992"],
    ];
    for (const [key, value] of cases) {
        const original = process.env[key];
        try {
            process.env[key] = value;
            assert.throws(() => tavilyConfiguration(), {
                name: "ConfigurationError",
                key,
            }, `${key}=${JSON.stringify(value)} must remain a repairable configuration error`);
        } finally {
            if (original === undefined) delete process.env[key];
            else process.env[key] = original;
        }
    }
});

test("configuration: a missing floor is an internal error, not guessed configuration", () => {
    delete process.env.PLURNK_SCHEMES_HTTP_TAVILY_DEPTH;
    assert.throws(() => tavilyConfiguration(), {
        name: "Error",
        message: "PLURNK_SCHEMES_HTTP_TAVILY_DEPTH is missing from the assembled environment floor.",
    });
});

test("extract: success requires Markdown plus request_id and usage.credits evidence", async () => {
    process.env.TAVILY_API_KEY = "tvly-test";
    await withFetch((async () => resp(JSON.stringify({
        results: [{ url: "https://example.com/x", markdown: "# Extracted" }],
        request_id: "req-1",
        usage: { credits: 0.2 },
    }), 200)) as typeof fetch, async () => {
        const result = await materializer.extract("https://example.com/x", {});
        assert.equal(result.outcome, "success");
        assert.equal(result.body, "# Extracted");
        assert.equal(result.identity, "tavily-extract:v1:basic");
        assert.deepEqual(result.evidence.filter(({ name }) => name === "x-plurnk-tavily-request-id"), [{ name: "x-plurnk-tavily-request-id", value: "req-1" }]);
        assert.deepEqual(result.evidence.filter(({ name }) => name === "x-plurnk-tavily-credits"), [{ name: "x-plurnk-tavily-credits", value: "0.2" }]);
    });
});

test("extract: a 401 is a hard authentication failure with its exact Problem", async () => {
    process.env.TAVILY_API_KEY = "tvly-test";
    await withFetch((async () => resp(JSON.stringify({ detail: "invalid key" }), 401)) as typeof fetch, async () => {
        const result = await materializer.extract("https://example.com/x", {});
        assert.equal(result.outcome, "hard");
        assert.equal(result.problem.code, "tavily-authentication-failed");
        assert.equal(result.problem.retryable, false);
    });
});

test("extract: a 429 is recoverable and carries the rate-limit Problem", async () => {
    process.env.TAVILY_API_KEY = "tvly-test";
    await withFetch((async () => resp(JSON.stringify({ detail: "slow down" }), 429, { "retry-after": "2" })) as typeof fetch, async () => {
        const result = await materializer.extract("https://example.com/x", {});
        assert.equal(result.outcome, "recoverable");
        assert.equal(result.problem?.code, "tavily-rate-limited");
        assert.equal(result.problem?.status, 429);
        assert.deepEqual(result.evidence.filter(({ name }) => name === "x-plurnk-tavily-retry-after"), [{ name: "x-plurnk-tavily-retry-after", value: "2" }]);
    });
});

test("extract: failed_results is recoverable with the provider's reason", async () => {
    process.env.TAVILY_API_KEY = "tvly-test";
    await withFetch((async () => resp(JSON.stringify({
        results: [],
        failed_results: [{ url: "https://example.com/x", error: "not extractable" }],
        request_id: "req-f",
        usage: { credits: 0 },
    }), 200)) as typeof fetch, async () => {
        const result = await materializer.extract("https://example.com/x", {});
        assert.equal(result.outcome, "recoverable");
        assert.equal(result.reason, "failed-result");
        assert.equal(result.problem?.code, "tavily-failed-result");
    });
});

test("extract: a malformed success is hard and never invents a body", async () => {
    process.env.TAVILY_API_KEY = "tvly-test";
    await withFetch((async () => resp(JSON.stringify({ results: [{ raw_content: "ambiguous" }], request_id: "req-no-usage" }), 200)) as typeof fetch, async () => {
        const result = await materializer.extract("https://example.com/x", {});
        assert.equal(result.outcome, "hard");
        assert.equal(result.problem.code, "tavily-invalid-response");
    });
});

test("{§tavily-materializer} cancellation before or during extraction preserves the caller's reason", async () => {
    process.env.TAVILY_API_KEY = "tvly-test";
    const reason = new Error("caller cancelled extraction");
    const aborted = AbortSignal.abort(reason);
    await withFetch((async () => { throw new Error("cancelled calls must not reach fetch"); }) as typeof fetch, async () => {
        await assert.rejects(materializer.extract("https://example.com/x", { signal: aborted }), (cause) => cause === reason);
    });
    const controller = new AbortController();
    await withFetch((async (_input, init) => {
        controller.abort(reason);
        assert.equal(init?.signal?.aborted, true);
        throw init?.signal?.reason;
    }) as typeof fetch, async () => {
        await assert.rejects(materializer.extract("https://example.com/x", { signal: controller.signal }), (cause) => cause === reason);
    });
});

test("{§tavily-materializer} provider request preserves the exact URL, configured depth and usage request", async () => {
    process.env.TAVILY_API_KEY = "tvly-test";
    process.env.PLURNK_SCHEMES_HTTP_TAVILY_DEPTH = "advanced";
    const url = "https://example.com/page?a=1&b=2";
    await withFetch((async (input, init) => {
        assert.equal(input, "https://api.tavily.com/extract");
        assert.equal(init?.method, "POST");
        assert.deepEqual(JSON.parse(String(init?.body)), {
            urls: [url], extract_depth: "advanced", format: "markdown", include_usage: true,
        });
        assert.equal(new Headers(init?.headers).get("authorization"), "Bearer tvly-test");
        return resp(JSON.stringify({ results: [{ url, markdown: "body" }], request_id: "req-exact", usage: { credits: 0 } }), 200);
    }) as typeof fetch, async () => {
        const result = await materializer.extract(url, {});
        assert.equal(result.outcome, "success");
        assert.equal(result.identity, "tavily-extract:v1:advanced");
        assert.ok(result.evidence.some(({ name, value }) => name === "x-plurnk-tavily-credits" && value === "0"));
    });
});

test("composition: native family discovery supplies HTTP extraction without daemon lifecycle hooks", async () => {
    process.env.TAVILY_API_KEY = "tvly-test";
    process.env.PLURNK_SCHEMES_HTTP_MATERIALIZER = "tavily-extract";
    process.env.PLURNK_SCHEMES_HTTP_FETCH_TIMEOUT = "30000";
    process.env.PLURNK_SCHEMES_HTTP_REDIRECTS = "5";
    process.env.PLURNK_SCHEMES_HTTP_ERROR_DETAIL_LIMIT = "512";
    process.env.PLURNK_SCHEMES_HTTP_USER_AGENT = "plurnk-tavily-plugin/test";
    const { default: MaterializerRegistry } = await import("@plurnk/plurnk-schemes-http/materializer");
    const { WebFetcher } = await import("@plurnk/plurnk-schemes-http");
    const pkgDir = resolve(import.meta.dirname, "..");
    await MaterializerRegistry.current().discover({ packageDirs: [{ dir: pkgDir, name: "@plurnk/plurnk-tavily-plugin" }] });
    assert.ok(MaterializerRegistry.current().materializerFor("tavily-extract"));
    const projection = {
        async readable() { return null; },
        async binary(chunks: AsyncIterable<Uint8Array>) {
            const parts: Uint8Array[] = [];
            for await (const chunk of chunks) parts.push(chunk);
            return { bytes: Uint8Array.from(parts.flatMap((p) => [...p])), readable: null, projectionIdentity: "test-projection" };
        },
        async identity(mimetype: string) { return `${mimetype}-projection`; },
        async isBinary(mimetype: string) { return !mimetype.startsWith("text/"); },
        parseIssues: async () => undefined,
    } as Parameters<typeof WebFetcher.materialize>[1];
    try {
        await withFetch((async (input) => String(input) === "https://api.tavily.com/extract"
            ? resp(JSON.stringify({
                results: [{ url: "https://93.184.216.34/x", markdown: "# Tavily composition body" }],
                request_id: "req-composed",
                usage: { credits: 0.1 },
            }), 200)
            : new Response("<html><body>Origin</body></html>", { status: 200, headers: { "content-type": "text/html" } })) as typeof fetch, async () => {
            const fetched = await new WebFetcher().fetch("https://93.184.216.34/x");
            assert.ok(fetched !== null);
            const materialized = await WebFetcher.materialize(fetched, projection);
            // The materializer's extraction is the page's #readable; body keeps the origin bytes.
            assert.equal(materialized?.readable?.content, "# Tavily composition body");
            assert.equal(materialized?.body?.content, "<html><body>Origin</body></html>");
            assert.match(materialized?.header ?? "", /x-plurnk-materializer-id: tavily-extract:v1:basic/);
            assert.match(materialized?.header ?? "", /x-plurnk-tavily-request-id: req-composed/);
        });
    } finally {
        delete process.env.PLURNK_SCHEMES_HTTP_MATERIALIZER;
        delete process.env.PLURNK_SCHEMES_HTTP_FETCH_TIMEOUT;
        delete process.env.PLURNK_SCHEMES_HTTP_REDIRECTS;
        delete process.env.PLURNK_SCHEMES_HTTP_ERROR_DETAIL_LIMIT;
        delete process.env.PLURNK_SCHEMES_HTTP_USER_AGENT;
    }
});
