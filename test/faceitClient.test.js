import assert from "node:assert/strict";
import { after, describe, it } from "node:test";
import { AppError } from "../src/errors.js";
import { createFaceitClient } from "../src/faceitClient.js";
import { ConcurrencyLimiter } from "../src/limiter.js";
import { fakeFetch, jsonResponse, PLAYER_A, standardFaceit } from "./helpers.js";

/** @param {typeof fetch} fetchImpl @param {object} [extra] */
function client(fetchImpl, extra = {}) {
  return createFaceitClient({
    apiKey: "test-key",
    timeoutMs: 200,
    limiter: new ConcurrencyLimiter({ concurrency: 4, queueLimit: 50 }),
    fetchImpl,
    retryDelayMs: 1,
    ...extra,
  });
}

describe("FACEIT client", () => {
  it("sends the API key as a bearer token and refuses redirects", async () => {
    const fetchImpl = standardFaceit();
    await client(fetchImpl).getPlayerByNickname("alpha");
    const { init } = fetchImpl.calls[0];
    assert.equal(/** @type {any} */ (init.headers).Authorization, "Bearer test-key");
    assert.equal(init.redirect, "error");
  });

  it("returns null for unknown players", async () => {
    assert.equal(await client(standardFaceit()).getPlayerByNickname("nobody"), null);
  });

  it("caches lookups case-insensitively", async () => {
    const fetchImpl = standardFaceit();
    const c = client(fetchImpl);
    await c.getPlayerByNickname("alpha");
    await c.getPlayerByNickname("ALPHA");
    assert.equal(fetchImpl.calls.length, 1);
  });

  it("pages through match history up to the limit", async () => {
    const page = (n) => Array.from({ length: n }, (_, i) => ({ match_id: `1-match-${String(i).padStart(4, "0")}` }));
    const fetchImpl = fakeFetch((url) => {
      const offset = Number(url.searchParams.get("offset"));
      const limit = Number(url.searchParams.get("limit"));
      return jsonResponse(200, { items: offset < 1000 ? page(limit) : page(0) });
    });
    const items = await client(fetchImpl).getPlayerMatchHistory(PLAYER_A.player_id, 250);
    assert.equal(items.length, 250);
    assert.deepEqual(
      fetchImpl.calls.map((c) => [c.url.searchParams.get("offset"), c.url.searchParams.get("limit")]),
      [["0", "100"], ["100", "100"], ["200", "50"]]
    );
  });

  it("stops paging when a short page comes back", async () => {
    const fetchImpl = fakeFetch(() => jsonResponse(200, { items: [{ match_id: "1-only-one0" }] }));
    await client(fetchImpl).getPlayerMatchHistory(PLAYER_A.player_id, 500);
    assert.equal(fetchImpl.calls.length, 1);
  });

  it("retries a 429 once, then reports busy with Retry-After", async () => {
    const fetchImpl = fakeFetch(() => jsonResponse(429, {}, { "retry-after": "7" }));
    await assert.rejects(client(fetchImpl).getPlayerByNickname("alpha"), (err) => {
      return err instanceof AppError && err.status === 503 && err.retryAfterSeconds === 7;
    });
    assert.equal(fetchImpl.calls.length, 2);
  });

  it("recovers when a retry succeeds", async () => {
    let n = 0;
    const fetchImpl = fakeFetch(() => (++n === 1 ? jsonResponse(500) : jsonResponse(200, PLAYER_A)));
    const player = await client(fetchImpl).getPlayerByNickname("alpha");
    assert.equal(player?.nickname, "alpha");
  });

  it("turns timeouts into a safe 502", async () => {
    // AbortSignal.timeout uses an unref'd timer; keep the test process alive meanwhile.
    const keepAlive = setInterval(() => {}, 1000);
    const fetchImpl = fakeFetch((_url, init) => new Promise((_resolve, reject) => {
      init.signal?.addEventListener("abort", () => reject(init.signal?.reason));
    }));
    after(() => clearInterval(keepAlive));
    await assert.rejects(client(fetchImpl, { timeoutMs: 20 }).getPlayerByNickname("alpha"), (err) => {
      return err instanceof AppError && err.status === 502 && !err.message.includes("open.faceit.com");
    });
  });

  it("does not leak the upstream reason for auth failures", async () => {
    const fetchImpl = fakeFetch(() => jsonResponse(401, { message: "invalid key test-key" }));
    await assert.rejects(client(fetchImpl).getPlayerByNickname("alpha"), (err) => {
      return err instanceof AppError && err.status === 502 && !err.message.includes("test-key");
    });
    assert.equal(fetchImpl.calls.length, 1, "auth errors are not retried");
  });

  it("refuses to build URLs from unexpected player IDs", async () => {
    const fetchImpl = fakeFetch(() => jsonResponse(200, { player_id: "../../admin", nickname: "evil" }));
    await assert.rejects(client(fetchImpl).getPlayerByNickname("evil"), (err) => err instanceof AppError && err.status === 502);
    assert.throws(() => client(fetchImpl).getPlayerStats("../x?y"), AppError);
  });

  it("returns 503 when no API key is configured", async () => {
    await assert.rejects(client(standardFaceit(), { apiKey: "" }).getPlayerByNickname("alpha"), (err) => err instanceof AppError && err.status === 503);
  });
});
