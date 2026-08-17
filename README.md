# @plurnk/plurnk-schemes-http-tavily

Tavily Extract page materialization for plurnk's `http(s)://` scheme — the
documented showcase of third-party pluggability. This package owns zero scheme
logic: it declares the `http-materializer` plugin family and implements the
materializer contract that `@plurnk/plurnk-schemes-http` selects.

## Install and enable

```sh
npm install @plurnk/plurnk-schemes-http-tavily
```

```text
# ~/.plurnk/.env, read by the service
PLURNK_SCHEMES_HTTP_MATERIALIZER=tavily-extract
TAVILY_API_KEY=...
```

Generic public HTML READs then produce the sanitized Tavily Markdown body while
retaining the exact server source in `#html`; the entry header records the
materializer identity and Tavily's request/usage evidence. Without the
selection (or the key), the installed HTML projection produces the body
unchanged.

## Configuration

| Variable | Contract |
| --- | --- |
| `TAVILY_API_KEY` | The Tavily API credential; absence makes the materializer ineligible |
| `PLURNK_SCHEMES_HTTP_TAVILY_DEPTH` | `basic` or `advanced` |
| `PLURNK_SCHEMES_HTTP_TAVILY_TIMEOUT_MS` | Positive request timeout in ms |

## Contract

`plurnk: { kind: "http-materializer", materializers: [{ id: "tavily-extract", module: "dist/materializer.js" }] }`
exports one `HttpMaterializer` (`eligible`/`extract`) under the framework's
discovery, trust, and one-flat-id-namespace rules. See
[SPEC.md](./SPEC.md) for the exact outcome mapping.

## Develop

```sh
npm install   # links ../plurnk-service/plurnk-schemes-http for the plurnk-dev source
npm test
```
