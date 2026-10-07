# plurnk-tavily-plugin — Specification

This package is a third-party materializer plugin for
`@plurnk/plurnk-schemes-http`. The owning contract is the framework's
`{§http-materializer-extensions}`; this document states the plugin's own
behavior.

## §tavily-plugin Plugin packaging

| Surface | Contract |
|---|---|
| `plugin.json` | Agent Plugins 1.0.0 manifest; `extensions.ai.plurnk` declares `kind: "http-materializer"` and its `materializers` file entries. |
| `ai.plurnk/dist/materializer.js` | Native `HttpMaterializer` default export, identified as `tavily-extract`. |
| `ai.plurnk/.env.defaults` | Package-owned floor and configuration documentation. |
| `package.json` | npm delivery as `@plurnk/plurnk-tavily-plugin`, dependency requirements, and Node exports; no duplicate native capability declaration. |
| Portable components | No skill or MCP server is required for this extension-only plugin. Other clients ignore the `ai.plurnk` namespace. |

Native loading uses the HTTP family's npm discovery and lazy process-wide registry,
not a daemon module. This package must be installed through npm, not merely copied
into a user plugin directory. Daemon creation and shutdown do not alter its registration.
The package's installation gate packs and installs it independently, then verifies
ordinary npm discovery, the shipped configuration floor, and explicit credential
eligibility through the public HTTP framework.

## §tavily-materializer Materializer behavior

`PLURNK_SCHEMES_HTTP_MATERIALIZER=tavily-extract` selects this package's
`tavily-extract` materializer. It is eligible when `TAVILY_API_KEY` is
present; its identity is `tavily-extract:v1:<depth>`. The framework gates
authored request metadata before the plugin is consulted; the plugin gates
its own credentials.

One provider request is `POST https://api.tavily.com/extract` with bearer
authentication and exactly one URL, configured `basic` or `advanced` depth,
`format: "markdown"`, and `include_usage: true`. A plugin-owned abort timeout
bounds the call. Success requires Markdown plus `request_id` and
`usage.credits`; those facts remain durable in `header` as
`x-plurnk-tavily-*` evidence.

| Provider outcome                         | Classification | `#readable` when server HTML exists                    |
| ---------------------------------------- | -------------- | ------------------------------------------------------ |
| Success with required evidence           | Success        | Use Tavily Markdown                                    |
| Caller cancellation                      | Cancelled      | Throw the caller's abort reason; the framework returns exact `499` |
| Client timeout or transport failure      | Recoverable    | Local projection, terminal `203`                       |
| `429`, `5xx`, or `failed_results`        | Recoverable    | Local projection, terminal `203`                       |
| `401` or `403`                           | Hard           | `tavily-authentication-failed`; no local projection    |
| Other `4xx`                              | Hard           | `tavily-provider-rejected`; no local projection        |
| Malformed success or missing evidence    | Hard           | `tavily-invalid-response`; no local projection         |

Recoverable outcomes carry the corresponding Problem so that a missing local
recovery input still fails with the provider's exact durable reason.

## §tavily-config Operator configuration

| Variable | Contract |
| --- | --- |
| `TAVILY_API_KEY` | Credential; absence makes the materializer ineligible (absence IS the mode) |
| `PLURNK_SCHEMES_HTTP_TAVILY_DEPTH` | `basic` or `advanced`; invalid values fail at eligibility |
| `PLURNK_SCHEMES_HTTP_TAVILY_TIMEOUT_MS` | Positive integer ms; invalid values fail at eligibility |

The credential is read from the environment at extraction time, never persisted.
The shared `Knob` reader validates depth and timeout against the assembled
environment. Invalid values raise `ConfigurationError` with the owning key;
missing floor values remain internal deployment errors. No replacement value
or missing-credential shortcut hides invalid configuration.
