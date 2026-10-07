# @plurnk/plurnk-tavily-plugin

An [Agent Plugin](https://agent-plugins.org/specification) supplying Tavily Extract
page materialization for Plurnk's `http(s)://` resources. The portable manifest
wraps a native Plurnk extension; the existing HTTP scheme owns fetching, caching,
and resource access. This plugin supplies neither a new scheme nor an MCP server.

This is Plurnk's non-bundled plugin showcase: it uses the same public extension
interface and installation path available to other plugin authors.

## Install and enable

Install beside the service (add `--global` if the service is installed globally):

```sh
npm install @plurnk/plurnk-tavily-plugin --no-audit --no-fund
```

```text
# $XDG_CONFIG_HOME/plurnk/.env (normally ~/.config/plurnk/.env)
PLURNK_SCHEMES_HTTP_MATERIALIZER=tavily-extract
```

Supply `TAVILY_API_KEY` through the service process environment and restart the
service after installation. The package's
`ai.plurnk/.env.defaults` supplies its configuration floor; operator environment and
configuration files override that floor through the normal Plurnk cascade.

A generic public HTML READ then keeps the exact server source as the page's
`body` and lands the sanitized Tavily Markdown as its `#readable` channel; the
entry header records the materializer identity and Tavily's request/usage
evidence, and every READ of the page names `#readable` with its tokens. Without
the selection (or the key), the installed HTML projection produces `#readable`
instead, and the page reads the same way.

## Configuration

| Variable | Contract |
| --- | --- |
| `TAVILY_API_KEY` | The Tavily API credential; absence makes the materializer ineligible |
| `PLURNK_SCHEMES_HTTP_TAVILY_DEPTH` | `basic` or `advanced` |
| `PLURNK_SCHEMES_HTTP_TAVILY_TIMEOUT_MS` | Positive request timeout in ms |

Invalid values raise the shared `ConfigurationError` naming the setting. Missing
floor values are deployment errors; neither case silently selects a replacement.

## Contract

`plugin.json#extensions.ai.plurnk` declares `kind: "http-materializer"` and one
`HttpMaterializer` (`eligible`/`extract`). The HTTP family's existing npm discovery,
lazy process-wide registry, trust policy and flat materializer namespace load it.
This native capability requires npm installation; copying it into a user plugin
folder is not sufficient. Client-specific files live in `ai.plurnk/`.
There is no parallel npm capability manifest. See
[SPEC.md](./SPEC.md) for the exact outcome mapping.

## Develop

```sh
npm install --no-audit --no-fund
npm test
npm run test:installation
```

## Versioning

This package versions independently. Compatibility is declared by its dependency
ranges; a Plurnk release does not require a release of this package.
