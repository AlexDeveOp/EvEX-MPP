import { test } from "node:test";
import assert from "node:assert/strict";
import { parseVersion, compareVersions, repoFromUrl, checkForUpdates } from "../../src/main/updates.js";

test("compareVersions sigue SemVer", () => {
  assert.ok(compareVersions("0.4.10", "0.4.9") > 0);
  assert.ok(compareVersions("v1.0.0", "0.9.9") > 0);
  assert.equal(compareVersions("0.4.2", "v0.4.2"), 0);
  assert.ok(compareVersions("1.0.0-beta.2", "1.0.0") < 0);
  assert.ok(compareVersions("1.0.0-beta.10", "1.0.0-beta.2") > 0);
  assert.equal(parseVersion("latest"), null);
  assert.throws(() => compareVersions("x", "1.0.0"));
});

test("repoFromUrl entiende las URL de package.json", () => {
  assert.equal(repoFromUrl("https://github.com/AlexDeveOp/EvEX-MPP.git"), "AlexDeveOp/EvEX-MPP");
  assert.equal(repoFromUrl("git+https://github.com/owner/repo"), "owner/repo");
  assert.equal(repoFromUrl("https://gitlab.com/owner/repo"), null);
});

const fakeFetch = (body, status = 200) => async (url, opts) => {
  fakeFetch.last = { url, opts };
  return { ok: status < 400, status, json: async () => body };
};

test("checkForUpdates detecta una versión nueva y solo enlaza a la página de releases del repo", async () => {
  const r = await checkForUpdates({ currentVersion: "0.4.2", repo: "o/r", fetchImpl: fakeFetch({ tag_name: "v0.5.0", html_url: "https://github.com/o/r/releases/tag/v0.5.0" }) });
  assert.deepEqual(r, { latest: "0.5.0", url: "https://github.com/o/r/releases/tag/v0.5.0", newer: true });
  assert.equal(fakeFetch.last.url, "https://api.github.com/repos/o/r/releases/latest");
  const evil = await checkForUpdates({ currentVersion: "0.4.2", repo: "o/r", fetchImpl: fakeFetch({ tag_name: "v0.5.0", html_url: "https://malo.example/descarga" }) });
  assert.equal(evil.url, "https://github.com/o/r/releases/latest");
});

test("checkForUpdates: misma versión, prerelease y errores", async () => {
  assert.equal((await checkForUpdates({ currentVersion: "0.4.2", repo: "o/r", fetchImpl: fakeFetch({ tag_name: "v0.4.2" }) })).newer, false);
  assert.equal((await checkForUpdates({ currentVersion: "0.4.2", repo: "o/r", fetchImpl: fakeFetch({ tag_name: "v9.0.0", prerelease: true }) })).newer, false);
  await assert.rejects(checkForUpdates({ currentVersion: "0.4.2", repo: "o/r", fetchImpl: fakeFetch({}, 403) }), /403/);
  await assert.rejects(checkForUpdates({ currentVersion: "0.4.2", repo: "o/r", fetchImpl: fakeFetch({ tag_name: "latest" }) }), /no válida/i);
});

test("checkForUpdates rechaza un repositorio con formato extraño sin hacer la petición", async () => {
  let called = false;
  const spy = async () => ((called = true), { ok: true, json: async () => ({}) });
  for (const repo of ["../../evil", "o/r/../x", "o r/x", "", "o/r?x=1"]) {
    await assert.rejects(checkForUpdates({ currentVersion: "0.4.2", repo, fetchImpl: spy }));
  }
  assert.equal(called, false);
});
