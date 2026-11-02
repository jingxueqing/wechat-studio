/* ==========================================================================
   ai.js — 大模型调用层
   只管三件事：拿模型列表、流式取字、一键取 JSON。
   业务与界面都不直接碰 SDK，便于以后换模型供应商。
   ========================================================================== */
(function (global) {
  "use strict";

  const cfg = global.APP_CONFIG.cloud;
  let client = null;
  let modelsCache = null;

  function getClient() {
    if (client) return client;
    if (!global.WorkBuddyCloud || typeof global.WorkBuddyCloud.createWorkBuddyCloud !== "function") {
      throw new Error("SDK 未加载");
    }
    client = global.WorkBuddyCloud.createWorkBuddyCloud({
      endpoint: cfg.endpoint,
      publishableKey: cfg.publishableKey,
    });
    return client;
  }

  /** 把各种失败翻译成人话 + 给下一步 */
  function explain(error) {
    const code = String((error && (error.code || error.errorCode)) || "");
    const raw = String((error && (error.message || error.detail)) || error || "");
    const s = (code + " " + raw).toLowerCase();
    const status = Number((error && (error.status || error.statusCode)) || 0);
    const wait = Number((error && error.retryAfterMs) || 0);

    if (s.includes("quota") || s.includes("insufficient") || s.includes("余额") || s.includes("超限")) {
      return { text: "今天的模型额度用完了，明天再来，或者换个模型试试。", retry: false };
    }
    if (status === 429 || s.includes("429") || s.includes("too many") || s.includes("rate limit")) {
      const sec = wait ? Math.ceil(wait / 1000) : 2;
      return { text: `这个模型这会儿排队的人多（限流），${sec} 秒后重试更稳。`, retry: true };
    }
    if (s.includes("unauthenticated") || status === 401 || s.includes("401") || s.includes("unauthorized") || s.includes("invalid_grant")) {
      return { text: "模型调用没拿到授权，刷新页面再试一次。", retry: true };
    }
    // 403 既可能是域名没授权，也可能是网关限流：只有明确提到 origin 才归因到域名，
    // 否则会说成「域名未授权」，用户在正式链接上看到会一头雾水（真实踩过）。
    if (s.includes("origin") || s.includes("referer") || s.includes("not allowed")) {
      return { text: "当前访问域名没有被授权，请用正式发布的链接打开。", retry: false };
    }
    if (status === 403 || s.includes("403") || s.includes("forbidden") || s.includes("rate")) {
      return { text: "服务端把这个请求挡回来了（多半是请求太密），已经自动重试过，等一下再点一次。", retry: true };
    }
    if (s.includes("timeout") || s.includes("aborted") || s.includes("network") || s.includes("fetch") || s.includes("502") || s.includes("503") || s.includes("504")) {
      return { text: "网络或模型响应超时，点重试通常就好了。", retry: true };
    }
    if (s.includes("content_filter") || s.includes("blocked") || s.includes("sensitive")) {
      return { text: "这段内容被模型的安全策略挡下了，换个说法再试。", retry: false };
    }
    if (s.includes("model") && (s.includes("not found") || s.includes("unavailable") || s.includes("disabled"))) {
      return { text: "这个模型暂时不可用，换一个模型再试。", retry: true };
    }
    return { text: "生成失败：" + (raw.slice(0, 120) || "未知错误"), retry: true };
  }

  /** 值不值得再试一次：网络抖动、限流、5xx 都算 */
  function isTransient(error) {
    const info = explain(error);
    return info.retry;
  }

  /** 明显不是「写字」的模型（出图 / 出视频 / 向量），不放进下拉框 */
  const NOT_TEXT = /(image|video|kling|embed|rerank|tts|asr|whisper|flux|sd-?xl)/i;

  /** 排序偏好：中文长文写作稳、速度快、流式不卡顿的排前面 */
  const PREFER = [
    "deepseek-v4.1-flash",
    "deepseek-v4-flash",
    "glm-5.3-flash",
    "kimi-k3.1-pro",
    "glm-5.3",
    "deepseek-v4-pro",
    "hy4-preview",
    "kimi-k3-1",
    "minimax-m3.1-flash",
  ];

  async function listModels() {
    if (modelsCache) return modelsCache;
    const cloud = getClient();
    const models = await cloud.llm.models.list();
    const usable = (models || []).filter(
      (m) => m && m.disabled !== true && m.enabled !== false && !NOT_TEXT.test(String(m.id || "") + " " + String(m.name || ""))
    );
    usable.sort((a, b) => {
      const ia = PREFER.indexOf(a.id);
      const ib = PREFER.indexOf(b.id);
      return (ia < 0 ? 999 : ia) - (ib < 0 ? 999 : ib);
    });
    // 同名模型（不同供应商路由）只留一个，避免下拉框全是重复项
    const seen = new Set();
    modelsCache = usable.filter((m) => {
      const key = String(m.name || m.id);
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    });
    return modelsCache;
  }

  /**
   * 流式调用
   * @returns {Promise<string>} 完整文本
   */
  async function stream(opts) {
    const cloud = getClient();
    const { model, system, user, messages, temperature, signal, onDelta, includeUsage } = opts;

    const payload = {
      model,
      messages: messages || [
        { role: "system", content: system || "You are a helpful assistant. Be concise and helpful." },
        { role: "user", content: user },
      ],
      stream: true,
    };
    if (typeof temperature === "number") payload.temperature = temperature;
    if (includeUsage) payload.stream_options = { include_usage: true };
    if (signal) payload.signal = signal;

    let text = "";
    for await (const chunk of cloud.llm.chat.completions.create(payload)) {
      const delta = chunk && chunk.choices && chunk.choices[0] && chunk.choices[0].delta;
      if (delta && typeof delta.content === "string" && delta.content) {
        text += delta.content;
        if (onDelta) onDelta(delta.content, text);
      }
    }
    return text;
  }

  /** 取纯文本（一次性拿完），瞬时错误退避重试 2 次 */
  async function complete(opts) {
    let last = null;
    for (let i = 0; i < 3; i++) {
      try {
        return await stream(opts);
      } catch (e) {
        last = e;
        if (e && (e.name === "AbortError" || /abort/i.test(String(e.message)))) throw e;
        if (!isTransient(e)) throw e;
        await new Promise((r) => setTimeout(r, 800 * (i + 1)));
      }
    }
    throw last;
  }

  /** 取 JSON：容忍模型把 JSON 包在 ```json 里或前后加话 */
  function parseJson(text) {
    let s = String(text || "").trim();
    s = s.replace(/^```(?:json)?\s*/i, "").replace(/```\s*$/, "").trim();
    try {
      return JSON.parse(s);
    } catch (_) {
      const start = s.indexOf("{");
      const end = s.lastIndexOf("}");
      if (start >= 0 && end > start) {
        const slice = s.slice(start, end + 1);
        try {
          return JSON.parse(slice);
        } catch (_e) {
          // 去掉可能的尾随逗号再试一次
          try {
            return JSON.parse(slice.replace(/,\s*([}\]])/g, "$1"));
          } catch (_e2) {
            return null;
          }
        }
      }
      return null;
    }
  }

  /** 取 JSON：模型偶尔会把 JSON 写坏或包一层解释，坏一次就再要一次 */
  async function json(opts) {
    let lastErr = null;
    for (let i = 0; i < 3; i++) {
      try {
        const text = await complete(opts);
        const data = parseJson(text);
        if (data) return data;
        lastErr = new Error("模型返回的不是合法 JSON");
      } catch (e) {
        lastErr = e;
        if (!isTransient(e)) throw e;
      }
      await new Promise((r) => setTimeout(r, 800 * (i + 1)));
    }
    throw lastErr || new Error("模型返回的不是合法 JSON");
  }

  global.AI = { getClient, listModels, stream, complete, json, parseJson, explain };
})(typeof window !== "undefined" ? window : globalThis);
