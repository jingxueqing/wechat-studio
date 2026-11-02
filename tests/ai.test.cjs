/* AI 调用层自测：node tests/ai.test.cjs
   不打网络，只锁两件真实踩过坑的事：
   1) 403 到底是「域名没授权」还是「网关限流」——说错话比报错更糟；
   2) 模型把 JSON 写坏时，解析层要能救回来，救不回来要重试。*/
const assert = require("node:assert");
globalThis.APP_CONFIG = { cloud: { endpoint: "https://example.invalid", publishableKey: "pk_test" } };
require("../assets/ai.js");
const AI = globalThis.AI;

let pass = 0;
function ok(name, fn) {
  try {
    fn();
    pass++;
    console.log("  ✓ " + name);
  } catch (e) {
    console.error("  ✗ " + name + "\n    " + e.message);
    process.exitCode = 1;
  }
}

ok("403 带 origin 关键词时，归因到域名未授权且不建议重试", () => {
  const r = AI.explain({ status: 403, message: "Request origin not allowed: https://x.dev" });
  assert.match(r.text, /域名/);
  assert.strictEqual(r.retry, false);
});

ok("403 没有 origin 关键词时，不诬赖域名，而是提示稍后重试", () => {
  const r = AI.explain({ status: 403, message: "Forbidden" });
  assert.ok(!/域名/.test(r.text), "不应该说成域名未授权：" + r.text);
  assert.strictEqual(r.retry, true);
});

ok("429 与 5xx 都算可重试", () => {
  assert.strictEqual(AI.explain({ code: "429", message: "Too Many Requests" }).retry, true);
  assert.strictEqual(AI.explain({ message: "502 Bad Gateway" }).retry, true);
});

ok("数字 status 429 时，提示里带上服务端给的等待秒数", () => {
  const r = AI.explain({ status: 429, message: "rate limited", retryAfterMs: 4000 });
  assert.match(r.text, /4 秒/);
  assert.strictEqual(r.retry, true);
});

ok("额度用尽不重试，避免白等", () => {
  assert.strictEqual(AI.explain({ message: "insufficient quota" }).retry, false);
});

ok("纯 JSON 直接解析", () => {
  assert.deepStrictEqual(AI.parseJson('{"a":1}'), { a: 1 });
});

ok("包在 ```json 代码块里也能解析", () => {
  assert.deepStrictEqual(AI.parseJson('```json\n{"titles":[]}\n```'), { titles: [] });
});

ok("前后夹着解释文字时，截取中间的对象", () => {
  assert.deepStrictEqual(AI.parseJson('好的，结果如下：{"scores":{"钩子":8}} 希望有用'), { scores: { 钩子: 8 } });
});

ok("尾随逗号能救回来", () => {
  assert.deepStrictEqual(AI.parseJson('{"a":1,"b":2,}'), { a: 1, b: 2 });
});

ok("彻底不是 JSON 时返回 null，不抛异常", () => {
  assert.strictEqual(AI.parseJson("抱歉我不能完成这个请求"), null);
});

console.log(`\n${pass} 项通过${process.exitCode ? "（有失败）" : "，全绿"}`);
