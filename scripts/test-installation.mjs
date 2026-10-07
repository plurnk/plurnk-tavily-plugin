import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { promisify } from "node:util";

// {§tavily-plugin}: public package installation, with no daemon dependency or private loader.
const run = promisify(execFile);
const root = path.resolve(import.meta.dirname, "..");
const directory = await mkdtemp(path.join(tmpdir(), "plurnk-tavily-install-"));
try {
    const packed = await run("npm", ["pack", "--json", "--pack-destination", directory], { cwd: root });
    const archives = JSON.parse(packed.stdout);
    assert.equal(archives.length, 1);
    await writeFile(path.join(directory, "package.json"), JSON.stringify({ name: "plugin-consumer", private: true, version: "1.0.0" }));
    await run("npm", ["install", "--no-audit", "--no-fund", "--include=peer", path.join(directory, archives[0].filename)], { cwd: directory });
    await run("npm", ["ls", "--all"], { cwd: directory });
    const env = Object.fromEntries(Object.entries(process.env).filter(([key]) => !key.startsWith("PLURNK_") && key !== "TAVILY_API_KEY"));
    await run(process.execPath, [
        "--env-file=node_modules/@plurnk/plurnk-tavily-plugin/ai.plurnk/.env.defaults",
        "--input-type=module", "--eval", `
            import assert from "node:assert/strict";
            import { existsSync } from "node:fs";
            import MaterializerRegistry from "@plurnk/plurnk-schemes-http/materializer";
            assert.equal(existsSync("node_modules/@plurnk/plurnk-service"), false);
            assert.equal(process.env.PLURNK_SCHEMES_HTTP_MATERIALIZER, undefined);
            const registry = await MaterializerRegistry.current().discover();
            const materializer = registry.materializerFor("tavily-extract");
            assert.equal(materializer?.id, "tavily-extract");
            assert.equal(await materializer.eligible("https://example.com", {}), null);
            process.env.TAVILY_API_KEY = "installation-fixture";
            assert.equal(await materializer.eligible("https://example.com", {}), "tavily-extract:v1:basic");
            process.env.PLURNK_SCHEMES_HTTP_TAVILY_DEPTH = "advanced";
            assert.equal(await materializer.eligible("https://example.com", {}), "tavily-extract:v1:advanced");
        `,
    ], { cwd: directory, env });
    console.log("Tavily standalone installation, discovery and configuration verified.");
} finally {
    await rm(directory, { recursive: true, force: true });
}
