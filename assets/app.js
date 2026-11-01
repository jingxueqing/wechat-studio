/* ==========================================================================
   app.js — 界面状态机与业务流程
   流程：选题 → 大纲 → 正文 → 排版发布，每步都可回退/重做；
   所有生成都是流式的，正文一边出来一边渲染排版预览。
   ========================================================================== */
(function () {
  "use strict";

  const $ = (s) => document.querySelector(s);
  const $$ = (s) => Array.from(document.querySelectorAll(s));
  const DRAFT_KEY = "gaotai.drafts.v1";
  const STATE_KEY = "gaotai.state.v1";

  const state = {
    models: [],
    modelId: "",
    ctx: { topic: "", mode: "干货科普", audience: "同专业的同学 / 学弟学妹", length: 1500, extra: "" },
    chosen: { title: "", angle: "", summary: "", cover: "" },
    titles: [],
    outline: "",
    article: "",
    theme: "ink",
    cjk: true,
    view: "preview",
    busy: false,
    controller: null,
    undo: null,
    mobileView: "input",
  };

  const els = {
    topic: $("#topic"),
    topicCount: $("#topicCount"),
    audience: $("#audience"),
    length: $("#length"),
    extra: $("#extra"),
    modelSelect: $("#modelSelect"),
    modelDot: $("#modelDot"),
    steps: $$("#steps .step"),
    emptyState: $("#emptyState"),
    stageIdeas: $("#stageIdeas"),
    stageOutline: $("#stageOutline"),
    stageArticle: $("#stageArticle"),
    angleText: $("#angleText"),
    titleList: $("#titleList"),
    summaryText: $("#summaryText"),
    coverText: $("#coverText"),
    outlineBox: $("#outlineBox"),
    articleBox: $("#articleBox"),
    wechatPreview: $("#wechatPreview"),
    articleTitle: $("#articleTitle"),
    stats: $("#stats"),
    genBanner: $("#genBanner"),
    genText: $("#genText"),
    samplePill: $("#samplePill"),
    chatLog: $("#chatLog"),
    chatInput: $("#chatInput"),
    toast: $("#toast"),
  };

  /* ── 小工具 ──────────────────────────────────────────────────────── */
  let toastTimer = null;
  function toast(msg, kind) {
    els.toast.textContent = msg;
    els.toast.className = "toast" + (kind === "warn" ? " warn" : "");
    els.toast.hidden = false;
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => (els.toast.hidden = true), 2600);
  }

  let busyTimer = null;
  function setBusy(on, text) {
    state.busy = on;
    els.genBanner.hidden = !on;
    clearInterval(busyTimer);
    if (on) {
      const base = text || els.genText.textContent;
      let sec = 0;
      els.genText.textContent = base;
      busyTimer = setInterval(() => {
        sec += 1;
        els.genText.textContent = `${base} ${sec}s`;
      }, 1000);
    }
    $$(".btn").forEach((b) => {
      if (b.id === "btnStop") return;
      b.disabled = on ? b.dataset.keep !== "1" : false;
    });
    if (!on && state.noModel) $$(".btn.primary").forEach((b) => (b.disabled = true));
  }

  function setStep(n, status) {
    els.steps.forEach((el, i) => {
      const idx = i + 1;
      el.classList.toggle("active", idx === n);
      el.classList.toggle("done", idx < n || (status === "done" && idx === n));
      el.classList.toggle("busy", idx === n && status === "busy");
    });
  }

  function showStage(name) {
    els.emptyState.hidden = name !== "empty";
    els.stageIdeas.hidden = name !== "ideas";
    els.stageOutline.hidden = name !== "outline";
    els.stageArticle.hidden = name !== "article";
    if (name === "article") els.stageArticle.style.display = "flex";
  }

  function switchMobile(view) {
    state.mobileView = view;
    document.body.dataset.view = view;
    $$("#mobileNav button").forEach((b) => b.classList.toggle("active", b.dataset.view === view));
  }

  function currentMeta() {
    const a = WxRender.audit(state.article);
    return `约 ${a.chars} 字 · 预计阅读 ${a.minutes} 分钟`;
  }

  /* ── 模型 ────────────────────────────────────────────────────────── */
  async function initModels() {
    try {
      const models = await AI.listModels();
      state.models = models;
      if (!models.length) {
        els.modelDot.className = "model-dot err";
        els.modelSelect.innerHTML = '<option value="">暂无可用模型</option>';
        state.noModel = true;
        toast("当前没有可用的模型，稍后再试", "warn");
        $$(".btn.primary").forEach((b) => (b.disabled = true));
        return;
      }
      els.modelSelect.innerHTML = models
        .map((m) => `<option value="${m.id}">${(m.name || m.id).replace(/</g, "")}</option>`)
        .join("");
      state.modelId = models[0].id;
      els.modelSelect.value = state.modelId;
      els.modelDot.className = "model-dot ok";
    } catch (e) {
      els.modelDot.className = "model-dot err";
      els.modelSelect.innerHTML = '<option value="">模型连接失败</option>';
      const info = AI.explain(e);
      toast(info.text, "warn");
      console.error("[models]", e);
    }
  }

  /* ── 生成：选题与标题 ────────────────────────────────────────────── */
  async function runIdeas() {
    const ctx = readCtx();
    if (!ctx) return;
    setStep(1, "busy");
    showStage("ideas");
    setBusy(true, "正在找一个值得写的角度……");
    els.angleText.textContent = "正在找一个值得写的角度……";
    els.titleList.innerHTML = "";
    els.summaryText.textContent = "";
    els.coverText.textContent = "";

    const p = Prompts.ideas(ctx);
    try {
      const data = await AI.json({ model: state.modelId, system: p.system, user: p.user, temperature: 0.9 });
      if (!data || !Array.isArray(data.titles) || !data.titles.length) throw new Error("模型没有返回可用标题");

      state.titles = data.titles.slice(0, 6);
      state.chosen = {
        title: state.titles[0].title,
        angle: data.angle || "",
        summary: data.summary || "",
        cover: data.cover || "",
      };
      els.angleText.textContent = state.chosen.angle;
      els.summaryText.textContent = state.chosen.summary || "—";
      els.coverText.textContent = state.chosen.cover || "—";
      renderTitles();
      setStep(1, "done");
      setStep(2, "active");
      if (window.innerWidth <= 1080) switchMobile("work");
    } catch (e) {
      const info = AI.explain(e);
      els.angleText.textContent = "生成失败：" + info.text;
      toast(info.text, "warn");
      setStep(1, "active");
      console.error("[ideas]", e);
    } finally {
      setBusy(false);
    }
  }

  function renderTitles() {
    els.titleList.innerHTML = state.titles
      .map(
        (t, i) => `
      <button class="title-item ${t.title === state.chosen.title ? "sel" : ""}" data-i="${i}" type="button">
        <span class="idx">${i + 1}</span>
        <span><span class="t">${escapeHtml(t.title)}</span>${t.why ? `<span class="why">${escapeHtml(t.why)}</span>` : ""}</span>
      </button>`
      )
      .join("");
  }

  function escapeHtml(s) {
    return String(s || "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
  }

  /* ── 生成：大纲 ──────────────────────────────────────────────────── */
  async function runOutline() {
    const ctx = readCtx();
    if (!ctx) return;
    if (!state.chosen.title) return toast("先选一个标题", "warn");

    setStep(2, "busy");
    showStage("outline");
    els.outlineBox.value = "正在搭结构……";
    setBusy(true, "正在搭结构……");

    const p = Prompts.outline(ctx, state.chosen);
    try {
      const text = await AI.complete({ model: state.modelId, system: p.system, user: p.user, temperature: 0.8 });
      state.outline = cleanMarkdown(text);
      els.outlineBox.value = state.outline;
      setStep(2, "done");
      setStep(3, "active");
      if (window.innerWidth <= 1080) switchMobile("work");
    } catch (e) {
      const info = AI.explain(e);
      els.outlineBox.value = "";
      toast(info.text, "warn");
      console.error("[outline]", e);
    } finally {
      setBusy(false);
    }
  }

  /* ── 生成：正文（流式） ──────────────────────────────────────────── */
  async function runArticle() {
    const ctx = readCtx();
    if (!ctx) return;
    const outline = els.outlineBox.value.trim();
    if (!outline) return toast("大纲是空的，先写两句也行", "warn");

    state.outline = outline;
    els.samplePill.hidden = true;
    setStep(3, "busy");
    showStage("article");
    els.articleTitle.textContent = state.chosen.title || "正文成稿";
    state.article = "";
    state.undo = null;
    renderArticle();
    setBusy(true, "正在写正文……");

    const p = Prompts.article(ctx, state.chosen, outline);
    const ctrl = new AbortController();
    state.controller = ctrl;
    let last = 0;

    try {
      const text = await AI.stream({
        model: state.modelId,
        system: p.system,
        user: p.user,
        temperature: 0.85,
        signal: ctrl.signal,
        onDelta: (_d, full) => {
          const now = Date.now();
          if (now - last > 140) {
            last = now;
            state.article = cleanMarkdown(full);
            renderArticle();
          }
        },
      });
      state.article = cleanMarkdown(text);
      renderArticle();
      setStep(3, "done");
      setStep(4, "active");
      saveDraft(true);
      if (window.innerWidth <= 1080) switchMobile("work");
    } catch (e) {
      if (ctrl.signal.aborted) {
        toast("已停止，保留已经写出来的部分");
        if (state.article.trim()) setStep(3, "done");
      } else {
        const info = AI.explain(e);
        toast(info.text, "warn");
        console.error("[article]", e);
      }
    } finally {
      state.controller = null;
      setBusy(false);
    }
  }

  function cleanMarkdown(md) {
    return String(md || "")
      .replace(/^\s*```(?:markdown|md)?\s*\n?/i, "")
      .replace(/\n?```\s*$/, "")
      .replace(/^\s*【?正文】?[:：]?\s*\n/, "")
      .replace(/\n{3,}/g, "\n\n")
      .trimStart();
  }

  /* ── 渲染 ────────────────────────────────────────────────────────── */
  function renderArticle() {
    const title = state.chosen.title || "未命名稿件";
    const body = WxRender.renderBody(state.article, state.theme, { cjkSpacing: state.cjk });
    els.wechatPreview.innerHTML =
      WxRender.renderTitle(title, currentMeta(), state.theme) + body;

    if (state.view === "edit") {
      const box = els.articleBox;
      if (document.activeElement !== box) box.value = state.article;
    }
    renderStats();
  }

  function renderStats() {
    const a = WxRender.audit(state.article);
    const bits = [
      `<span><b>${a.chars}</b> 字</span>`,
      `<span>阅读 <b>${a.minutes}</b> 分钟</span>`,
      `<span><b>${a.paras}</b> 段</span>`,
      `<span><b>${a.heads}</b> 个小标题</span>`,
    ];
    if (a.longParas > 0) bits.push(`<span class="risk">${a.longParas} 段偏长</span>`);
    if (a.risks.length) bits.push(`<span class="risk">可疑用词：${a.risks.slice(0, 3).join("、")}</span>`);
    els.stats.innerHTML = bits.join("");
  }

  /* ── 复制 / 导出 ─────────────────────────────────────────────────── */
  async function copyToWechat() {
    if (!state.article.trim()) return toast("还没有正文可复制", "warn");
    const html = WxRender.renderBody(state.article, state.theme, { cjkSpacing: state.cjk });
    const plain = state.article;

    if (navigator.clipboard && window.ClipboardItem) {
      try {
        await navigator.clipboard.write([
          new ClipboardItem({
            "text/html": new Blob([html], { type: "text/html" }),
            "text/plain": new Blob([plain], { type: "text/plain" }),
          }),
        ]);
        return toast("已复制，去公众号编辑器里粘贴吧");
      } catch (e) {
        console.warn("clipboard api failed", e);
      }
    }
    // 退路：选中节点后 execCommand
    const holder = document.createElement("div");
    holder.innerHTML = html;
    holder.style.cssText = "position:fixed;left:-99999px;top:0;width:420px;";
    document.body.appendChild(holder);
    const range = document.createRange();
    range.selectNodeContents(holder);
    const sel = window.getSelection();
    sel.removeAllRanges();
    sel.addRange(range);
    let ok = false;
    try {
      ok = document.execCommand("copy");
    } catch (_e) {
      ok = false;
    }
    sel.removeAllRanges();
    holder.remove();
    toast(ok ? "已复制，去公众号编辑器里粘贴吧" : "复制失败，请手动全选预览区复制", ok ? undefined : "warn");
  }

  function download(filename, content, mime) {
    const blob = new Blob([content], { type: mime + ";charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = filename;
    a.click();
    setTimeout(() => URL.revokeObjectURL(url), 4000);
  }

  function safeName() {
    return (state.chosen.title || "稿件").replace(/[\\/:*?"<>|]/g, "").slice(0, 40);
  }

  /* ── 改稿 ────────────────────────────────────────────────────────── */
  function pushMsg(who, html, opts) {
    const wrap = document.createElement("div");
    wrap.className = "msg " + who;
    const whoText = who === "user" ? "你" : who === "err" ? "出错了" : "助手";
    wrap.innerHTML = `<span class="who">${whoText}</span><div class="body"></div>`;
    wrap.querySelector(".body").innerHTML = html;
    if (opts && opts.actions) {
      const acts = document.createElement("div");
      acts.className = "acts";
      opts.actions.forEach((a) => {
        const b = document.createElement("button");
        b.className = "linkbtn xs";
        b.type = "button";
        b.textContent = a.label;
        b.onclick = a.onClick;
        acts.appendChild(b);
      });
      wrap.appendChild(acts);
    }
    els.chatLog.appendChild(wrap);
    els.chatLog.scrollTop = els.chatLog.scrollHeight;
    return wrap;
  }

  async function revise(instruction, action) {
    if (!state.article.trim()) return toast("先生成正文，再让助手改", "warn");
    if (state.busy) return toast("等这条写完再说", "warn");

    pushMsg("user", escapeHtml(action ? `（快捷改稿）${action}` : instruction));
    const pending = pushMsg("ai", '<span class="spinner" style="border-color:rgba(0,0,0,.15);border-top-color:#0f6b57"></span> 正在改……');

    const prev = state.article;
    const p = Prompts.revise(state.article, instruction, action);
    setBusy(true, action === "体检" ? "正在体检……" : "正在改稿……");

    try {
      const text = await AI.complete({ model: state.modelId, system: p.system, user: p.user, temperature: 0.7 });
      const next = cleanMarkdown(text);
      if (next.length < 60) throw new Error("返回内容为空");

      state.undo = prev;
      state.article = next;
      renderArticle();
      saveDraft(true);

      pending.querySelector(".body").textContent = `已按「${action || instruction.slice(0, 14)}」改完，全文 ${WxRender.audit(next).chars} 字。`;
      const acts = document.createElement("div");
      acts.className = "acts";
      const undoBtn = document.createElement("button");
      undoBtn.className = "linkbtn xs";
      undoBtn.type = "button";
      undoBtn.textContent = "撤销这次修改";
      undoBtn.onclick = () => {
        if (!state.undo) return;
        state.article = state.undo;
        state.undo = null;
        renderArticle();
        toast("已撤销");
      };
      acts.appendChild(undoBtn);
      pending.appendChild(acts);
    } catch (e) {
      const info = AI.explain(e);
      pending.className = "msg err";
      pending.querySelector(".who").textContent = "出错了";
      pending.querySelector(".body").textContent = info.text;
      console.error("[revise]", e);
    } finally {
      setBusy(false);
      els.chatLog.scrollTop = els.chatLog.scrollHeight;
    }
  }

  async function runCheckup() {
    if (!state.article.trim()) return toast("先生成正文", "warn");
    if (state.busy) return;
    pushMsg("user", "帮我在发布前体检一下");
    const pending = pushMsg("ai", "正在读稿……");
    setBusy(true, "正在体检……");

    const p = Prompts.checkup(state.article);
    try {
      const data = await AI.json({ model: state.modelId, system: p.system, user: p.user, temperature: 0.4 });
      if (!data || !data.scores) throw new Error("体检结果解析失败");
      const order = ["钩子", "清晰", "信息密度", "手机阅读", "可信度"];
      const rows = order
        .filter((k) => typeof data.scores[k] === "number")
        .map(
          (k) => `<div class="score-row"><span>${k}</span><span class="score-bar"><i style="width:${Math.max(4, Math.min(100, data.scores[k] * 10))}%"></i></span><span class="val">${data.scores[k]}</span></div>`
        )
        .join("");
      const fixes = (data.fixes || [])
        .slice(0, 4)
        .map((f) => `<li>${escapeHtml(f)}</li>`)
        .join("");

      pending.querySelector(".body").innerHTML =
        `<div class="verdict"><h4>发前体检</h4>${rows}` +
        (data.verdict ? `<p style="margin:8px 0 0;font-size:12px;color:#56514a;">${escapeHtml(data.verdict)}</p>` : "") +
        (fixes ? `<ul>${fixes}</ul>` : "") +
        `</div>`;
    } catch (e) {
      const info = AI.explain(e);
      pending.className = "msg err";
      pending.querySelector(".who").textContent = "出错了";
      pending.querySelector(".body").textContent = info.text;
      console.error("[checkup]", e);
    } finally {
      setBusy(false);
      els.chatLog.scrollTop = els.chatLog.scrollHeight;
    }
  }

  /* ── 草稿箱 ──────────────────────────────────────────────────────── */
  function loadDrafts() {
    try {
      return JSON.parse(localStorage.getItem(DRAFT_KEY) || "[]");
    } catch (_e) {
      return [];
    }
  }

  function saveDraft(silent) {
    if (!state.article.trim()) return;
    if (!els.samplePill.hidden) return; // 示例稿不占草稿位
    const list = loadDrafts();
    const id = state.chosen.title + "|" + state.ctx.topic.slice(0, 30);
    const item = {
      id,
      ts: Date.now(),
      title: state.chosen.title || "未命名稿",
      topic: state.ctx.topic,
      article: state.article,
      outline: state.outline,
      chosen: state.chosen,
      titles: state.titles,
      theme: state.theme,
      ctx: state.ctx,
    };
    const rest = list.filter((d) => d.id !== id);
    rest.unshift(item);
    try {
      localStorage.setItem(DRAFT_KEY, JSON.stringify(rest.slice(0, 12)));
      renderDraftCount();
      if (!silent) toast("已存进草稿箱");
    } catch (_e) {
      /* 空间满了就算了 */
    }
  }

  function renderDraftCount() {
    $("#draftCount").textContent = String(loadDrafts().length);
  }

  function renderDraftList() {
    const list = loadDrafts();
    const box = $("#draftList");
    if (!list.length) {
      box.innerHTML = '<p class="draft-empty">还没有草稿。生成一篇之后会自动存一份。</p>';
      return;
    }
    box.innerHTML = list
      .map(
        (d, i) => `
      <div class="draft-item">
        <div>
          <h4>${escapeHtml(d.title)}</h4>
          <p>${new Date(d.ts).toLocaleString("zh-CN", { month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit" })} · ${WxRender.audit(d.article).chars} 字</p>
        </div>
        <div class="d-acts">
          <button class="linkbtn xs" data-open="${i}" type="button">打开</button>
          <button class="linkbtn xs" data-del="${i}" type="button" style="color:#b4552d;border-color:rgba(180,85,45,.3)">删除</button>
        </div>
      </div>`
      )
      .join("");

    box.querySelectorAll("[data-open]").forEach((b) => {
      b.onclick = () => {
        const d = loadDrafts()[Number(b.dataset.open)];
        if (!d) return;
        state.chosen = d.chosen || { title: d.title };
        state.article = d.article || "";
        state.outline = d.outline || "";
        state.titles = d.titles || [];
        state.ctx = d.ctx || state.ctx;
        state.theme = d.theme || "ink";
        els.topic.value = state.ctx.topic || "";
        els.outlineBox.value = state.outline;
        renderTitles();
        renderArticle();
        els.articleTitle.textContent = state.chosen.title || "正文成稿";
        showStage("article");
        setStep(3, "done");
        setStep(4, "active");
        closeDrawers();
        switchMobile("work");
        toast("草稿已打开");
      };
    });
    box.querySelectorAll("[data-del]").forEach((b) => {
      b.onclick = () => {
        const list2 = loadDrafts();
        list2.splice(Number(b.dataset.del), 1);
        localStorage.setItem(DRAFT_KEY, JSON.stringify(list2));
        renderDraftList();
        renderDraftCount();
      };
    });
  }

  /* ── 输入读取 ────────────────────────────────────────────────────── */
  function readCtx() {
    const topic = els.topic.value.trim();
    if (topic.length < 4) {
      toast("先写两句你想讲什么（至少 4 个字）", "warn");
      els.topic.focus();
      return null;
    }
    const activeChip = document.querySelector("#modeChips .chip.active");
    state.ctx = {
      topic,
      mode: (activeChip && activeChip.dataset.mode) || "干货科普",
      audience: els.audience.value,
      length: Number(els.length.value) || 1500,
      extra: els.extra.value.trim(),
    };
    if (!state.modelId) {
      toast("模型还没连上，刷新页面试试", "warn");
      return null;
    }
    return state.ctx;
  }

  /* ── 抽屉 ────────────────────────────────────────────────────────── */
  function openDrawer(sel) {
    $(sel).hidden = false;
    document.body.style.overflow = "hidden";
  }
  function closeDrawers() {
    $("#draftDrawer").hidden = true;
    $("#helpDrawer").hidden = true;
    document.body.style.overflow = "";
  }

  /* ── 事件绑定 ────────────────────────────────────────────────────── */
  function bind() {
    els.topic.addEventListener("input", () => {
      els.topicCount.textContent = els.topic.value.trim().length + " 字";
    });

    $("#modeChips").addEventListener("click", (e) => {
      const chip = e.target.closest(".chip");
      if (!chip) return;
      $$("#modeChips .chip").forEach((c) => c.classList.toggle("active", c === chip));
    });

    $("#themeChips").addEventListener("click", (e) => {
      const chip = e.target.closest(".chip");
      if (!chip) return;
      $$("#themeChips .chip").forEach((c) => c.classList.toggle("active", c === chip));
      state.theme = chip.dataset.theme;
      renderArticle();
      saveDraft(true);
    });

    $("#cjkSpace").addEventListener("change", (e) => {
      state.cjk = e.target.checked;
      renderArticle();
    });

    els.modelSelect.addEventListener("change", (e) => {
      state.modelId = e.target.value;
    });

    $("#btnStart").addEventListener("click", () => {
      pushHistoryReset();
      runIdeas();
    });
    $("#btnTitlesOnly").addEventListener("click", runIdeas);
    $("#btnRedoIdeas").addEventListener("click", runIdeas);
    $("#btnMakeOutline").addEventListener("click", runOutline);
    $("#btnRedoOutline").addEventListener("click", runOutline);
    $("#btnWriteArticle").addEventListener("click", runArticle);

    els.titleList.addEventListener("click", (e) => {
      const item = e.target.closest(".title-item");
      if (!item) return;
      const t = state.titles[Number(item.dataset.i)];
      if (!t) return;
      state.chosen.title = t.title;
      renderTitles();
      els.articleTitle.textContent = t.title;
    });

    $("#btnStop").addEventListener("click", () => {
      if (state.controller) state.controller.abort();
    });

    $("#viewSeg").addEventListener("click", (e) => {
      const btn = e.target.closest(".seg-btn");
      if (!btn) return;
      state.view = btn.dataset.view;
      $$("#viewSeg .seg-btn").forEach((b) => b.classList.toggle("active", b === btn));
      $("#phoneFrame").hidden = state.view !== "preview";
      $("#editorPane").hidden = state.view !== "edit";
      if (state.view === "edit") {
        els.articleBox.value = state.article;
        renderArticle();
      }
    });

    let editTimer = null;
    els.articleBox.addEventListener("input", () => {
      clearTimeout(editTimer);
      editTimer = setTimeout(() => {
        state.article = els.articleBox.value;
        const caret = els.articleBox.selectionStart;
        renderStats();
        // 预览同步但不抢焦点
        els.wechatPreview.innerHTML =
          WxRender.renderTitle(state.chosen.title || "未命名稿件", currentMeta(), state.theme) +
          WxRender.renderBody(state.article, state.theme, { cjkSpacing: state.cjk });
        els.articleBox.focus();
        els.articleBox.setSelectionRange(caret, caret);
        saveDraft(true);
      }, 320);
    });

    $("#btnCopyWechat").addEventListener("click", copyToWechat);
    $("#btnExportMd").addEventListener("click", () => {
      if (!state.article.trim()) return toast("还没有正文", "warn");
      download(safeName() + ".md", `# ${state.chosen.title}\n\n${state.article}`, "text/markdown");
    });
    $("#btnExportHtml").addEventListener("click", () => {
      if (!state.article.trim()) return toast("还没有正文", "warn");
      const html =
        `<!DOCTYPE html><html lang="zh-CN"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">` +
        `<title>${escapeHtml(state.chosen.title)}</title></head>` +
        `<body style="margin:0;background:#f6f3ec;padding:24px 12px;font-family:-apple-system,'PingFang SC',sans-serif;">` +
        `<div style="max-width:640px;margin:0 auto;background:#fff;padding:28px 22px;border-radius:12px;">` +
        WxRender.renderTitle(state.chosen.title, currentMeta(), state.theme) +
        WxRender.renderBody(state.article, state.theme, { cjkSpacing: state.cjk }) +
        `</div></body></html>`;
      download(safeName() + ".html", html, "text/html");
    });

    // 助手
    $("#quickActions").addEventListener("click", (e) => {
      const b = e.target.closest(".qa");
      if (!b) return;
      if (b.dataset.act === "体检") return runCheckup();
      revise("", b.dataset.act);
    });

    $("#chatForm").addEventListener("submit", (e) => {
      e.preventDefault();
      const v = els.chatInput.value.trim();
      if (!v) return;
      els.chatInput.value = "";
      revise(v);
    });
    els.chatInput.addEventListener("keydown", (e) => {
      if (e.key === "Enter" && !e.shiftKey) {
        e.preventDefault();
        $("#chatForm").requestSubmit();
      }
    });

    $("#hintChips").addEventListener("click", (e) => {
      const b = e.target.closest("button[data-fill]");
      if (!b) return;
      els.chatInput.value = b.dataset.fill;
      els.chatInput.focus();
    });

    // 示例
    $("#btnSample").addEventListener("click", () => {
      els.topic.value = "把我们组做 C6 Web App 这两个小时的踩坑，写成一篇学弟学妹看得懂的复盘";
      els.topicCount.textContent = els.topic.value.length + " 字";
      els.topic.focus();
    });
    $("#exampleGrid").addEventListener("click", (e) => {
      const card = e.target.closest(".example-card");
      if (!card) return;
      els.topic.value = card.dataset.topic;
      els.topicCount.textContent = card.dataset.topic.length + " 字";
      $$("#modeChips .chip").forEach((c) => c.classList.toggle("active", c.dataset.mode === card.dataset.mode));
      if (window.innerWidth <= 1080) switchMobile("input");
      els.topic.focus();
    });

    $("#btnDrafts").addEventListener("click", () => {
      renderDraftList();
      openDrawer("#draftDrawer");
    });
    $("#btnHelp").addEventListener("click", () => openDrawer("#helpDrawer"));
    $("#btnExamples").addEventListener("click", loadSample);

    $$("[data-close]").forEach((el) => el.addEventListener("click", closeDrawers));

    // 点标题旁的复制按钮
    document.addEventListener("click", (e) => {
      const b = e.target.closest("[data-copy]");
      if (!b) return;
      const key = b.dataset.copy;
      const val = key === "summary" ? state.chosen.summary : state.chosen.cover;
      if (!val) return;
      navigator.clipboard.writeText(val).then(
        () => toast("已复制"),
        () => toast("复制失败", "warn")
      );
    });

    // 移动端底栏
    $("#mobileNav").addEventListener("click", (e) => {
      const b = e.target.closest("button");
      if (b) switchMobile(b.dataset.view);
    });

    window.addEventListener("keydown", (e) => {
      if ((e.metaKey || e.ctrlKey) && e.key === "Enter") {
        if (!els.stageIdeas.hidden) runOutline();
        else if (!els.stageOutline.hidden) runArticle();
      }
    });
  }

  function pushHistoryReset() {
    state.article = "";
    state.outline = "";
    state.undo = null;
    els.samplePill.hidden = true;
  }

  /* ── 示例稿 ──────────────────────────────────────────────────────── */
  function loadSample() {
    const s = window.SAMPLE_ARTICLE;
    if (!s) return;
    state.chosen = { title: s.title, angle: "", summary: s.summary, cover: "排版四条规则" };
    state.outline = s.outline;
    state.article = s.markdown;
    state.titles = [];
    state.undo = null;
    els.articleTitle.textContent = s.title;
    els.outlineBox.value = s.outline;
    els.samplePill.hidden = false;
    renderArticle();
    showStage("article");
    setStep(4, "active");
    switchMobile("work");
    toast("这是一篇写好的示例稿，可以随便改；想写自己的点「开始创作」");
  }

  /* ── 启动 ────────────────────────────────────────────────────────── */
  async function boot() {
    document.body.dataset.view = "input";
    bind();
    renderDraftCount();
    initModels();
    els.topicCount.textContent = "0 字";
  }

  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", boot);
  else boot();
})();
