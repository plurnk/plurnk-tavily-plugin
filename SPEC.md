# plurnk-schemes-http-tavily — Specification

This package is a third-party materializer plugin for
`@plurnk/plurnk-schemes-http`. The owning contract is the framework's
`{§http-materializer-plugins}`; this document states the plugin's own
behavior.

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
