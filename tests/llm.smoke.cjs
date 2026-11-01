/* 在 Node 里直接验证云服务 LLM 链路（等同于浏览器里的同一条路径）。
   目的：不进浏览器也能确认「模型列表 + 流式生成 + JSON 抽取」三件事是真的通。
   用法：node tests/llm.smoke.cjs
*/
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

const ORIGIN = "https://wechat-studio-57144.app.workbuddy.host";

// 让 SDK 以为自己跑在浏览器里：只垫它真正用到的 API
const sandbox = {
  console,
  setTimeout,
  clearTimeout,
  TextDecoder,
  TextEncoder,
  AbortController,
  URL,
  URLSearchParams,
  Blob,
  Response,
  Request,
  Headers,
  fetch: (url, init = {}) => {
    const u = String(url);
    const headers = { ...(init.headers || {}) };
    if (!headers.Origin && u.startsWith(ORIGIN)) headers.Origin = ORIGIN;
    return fetch(url, { ...init, headers });
  },
  localStorage: {
    _d: {},
    getItem(k) { return this._d[k] ?? null; },
    setItem(k, v) { this._d[k] = String(v); },
    removeItem(k) { delete this._d[k]; },
  },
  navigator: { userAgent: "node-smoke", language: "zh-CN" },
  location: { origin: ORIGIN, href: ORIGIN + "/" },
  document: { cookie: "", addEventListener() {}, dispatchEvent() {} },
};
sandbox.window = sandbox;
sandbox.globalThis = sandbox;
sandbox.self = sandbox;

const code = fs.readFileSync(path.join(__dirname, "..", "assets", "wbcloud.sdk.js"), "utf8");
vm.createContext(sandbox);
vm.runInContext(code, sandbox);

const Sdk = sandbox.WorkBuddyCloud;
if (!Sdk) throw new Error("SDK 未挂载");

// config.js 是给浏览器用的，这里手工读一遍
const cfgSrc = fs.readFileSync(path.join(__dirname, "..", "assets", "config.js"), "utf8");
const endpoint = cfgSrc.match(/endpoint:\s*"([^"]+)"/)[1];
const publishableKey = cfgSrc.match(/publishableKey:\s*"([^"]+)"/)[1];

(async () => {
  const cloud = Sdk.createWorkBuddyCloud({ endpoint, publishableKey });

  console.log("\n[1] 拉模型列表");
  const models = await cloud.llm.models.list();
  console.log("    可用模型：", models.filter((m) => m.disabled !== true).map((m) => m.name || m.id).join(", ") || "（空）");
  const model = models.find((m) => m.disabled !== true);
  if (!model) throw new Error("没有可用模型");

  console.log("\n[2] 流式生成（真实调用）");
  const messages = [
    { role: "system", content: "你是一位中文公众号作者。只输出正文，不要解释。" },
    { role: "user", content: "用 80 字以内写一段关于「公众号排版为什么麻烦」的开头，第一句必须是具体场景。" },
  ];
  let text = "";
  let chunks = 0;
  const t0 = Date.now();
  for await (const chunk of cloud.llm.chat.completions.create({ model: model.id, messages, stream: true })) {
    const d = chunk.choices?.[0]?.delta?.content;
    if (d) { text += d; chunks++; }
  }
  console.log(`    ${chunks} 个增量，${Date.now() - t0}ms，共 ${text.length} 字`);
  console.log("    ----\n    " + text.replace(/\n/g, "\n    ") + "\n    ----");
  if (text.length < 20) throw new Error("返回内容过短，链路可疑");

  console.log("\n[3] JSON 结构化输出");
  const jmsgs = [
    { role: "system", content: "你只输出 JSON，不要任何解释。" },
    { role: "user", content: '给「校园 AI 工具」这个题材起 2 个公众号标题，输出 {"titles":["...","..."]}' },
  ];
  let raw = "";
  for await (const chunk of cloud.llm.chat.completions.create({ model: model.id, messages: jmsgs, stream: true, response_format: { type: "json_object" } })) {
    const d = chunk.choices?.[0]?.delta?.content;
    if (d) raw += d;
  }
  console.log("    原始：", raw.replace(/\s+/g, " ").slice(0, 120));
  const parsed = JSON.parse(raw.replace(/^```(?:json)?/i, "").replace(/```$/, "").trim());
  console.log("    解析出标题：", parsed.titles?.join(" / "));

  console.log("\n✓ 云服务 LLM 链路验证通过\n");
})().catch((e) => {
  console.error("\n✗ 失败：", e && (e.code || e.message), "\n", e);
  process.exit(1);
});
