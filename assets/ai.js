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

    if (s.includes("quota") || s.includes("insufficient") || s.includes("余额") || s.includes("超限")) {
      return { text: "今天的模型额度用完了，明天再来，或者换个模型试试。", retry: false };
    }
    if (s.includes("unauthenticated") || s.includes("401") || s.includes("unauthorized") || s.includes("invalid_grant")) {
      return { text: "模型调用没拿到授权，刷新页面再试一次。", retry: true };
    }
    if (s.includes("origin") || s.includes("403") || s.includes("forbidden")) {
      return { text: "当前访问域名没有被授权，请用正式发布的链接打开。", retry: false };
    }
    if (s.includes("timeout") || s.includes("aborted") || s.includes("network") || s.includes("fetch")) {
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

  /** 取纯文本（一次性拿完），带 1 次自动重试 */
  async function complete(opts) {
    try {
      return await stream(opts);
    } catch (e) {
      if (e && (e.name === "AbortError" || /abort/i.test(String(e.message)))) throw e;
      await new Promise((r) => setTimeout(r, 700));
      return await stream(opts);
    }
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

  async function json(opts) {
    const text = await complete(opts);
    return parseJson(text);
  }

  global.AI = { getClient, listModels, stream, complete, json, parseJson, explain };
})(typeof window !== "undefined" ? window : globalThis);
