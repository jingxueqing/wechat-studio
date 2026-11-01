/* ==========================================================================
   renderer.js — Markdown → 公众号可用 HTML
   为什么自己写：公众号编辑器只认「行内样式」，会丢掉 <style>、<script>、class 规则，
   所以所有样式必须 inline 到每个标签上；同时要处理中文排版（中英间距、行高、两端对齐）。
   ========================================================================== */
(function (global) {
  "use strict";

  /* ── 主题 ──────────────────────────────────────────────────────────── */
  const THEMES = {
    ink: {
      label: "墨黑",
      title: { font: "'Songti SC','Source Han Serif SC',Georgia,serif", color: "#161513", weight: 700 },
      body: { color: "#3c3831", size: 15, line: 1.9 },
      h2: { color: "#161513", size: 18, border: "#161513", bg: "transparent", pad: "0 0 0 10px" },
      h3: { color: "#161513", size: 16 },
      accent: "#8a6a2f",
      strong: "#161513",
      quote: { border: "#d9d1c0", bg: "#faf8f2", color: "#6b655a" },
      code: { bg: "#f6f4ee", color: "#3c3831", inlineBg: "#f0ede4" },
      hr: "#e2dbcc",
      callout: { note: { bg: "#f6f4ee", border: "#cfc6b2", label: "#8a8477" }, warn: { bg: "#fbf0ea", border: "#d9a48b", label: "#a85732" }, tip: { bg: "#f1f6f2", border: "#a9c3b3", label: "#3f7a5f" } },
    },
    forest: {
      label: "墨绿",
      title: { font: "'Songti SC','Source Han Serif SC',Georgia,serif", color: "#123a2e", weight: 700 },
      body: { color: "#2f3b35", size: 15, line: 1.9 },
      h2: { color: "#0f6b57", size: 18, border: "#0f6b57", bg: "#f2f8f5", pad: "8px 12px" },
      h3: { color: "#0f6b57", size: 16 },
      accent: "#0f6b57",
      strong: "#0c5747",
      quote: { border: "#9dc4b6", bg: "#f5faf8", color: "#4a5c54" },
      code: { bg: "#f3f7f5", color: "#2f3b35", inlineBg: "#eaf2ee" },
      hr: "#d8e6e0",
      callout: { note: { bg: "#f5faf8", border: "#a9c9bd", label: "#3f7a66" }, warn: { bg: "#fbf1ea", border: "#dcae92", label: "#a85732" }, tip: { bg: "#eef7f3", border: "#8fc4ae", label: "#0f6b57" } },
    },
    amber: {
      label: "暖阳",
      title: { font: "'Songti SC','Source Han Serif SC',Georgia,serif", color: "#4a2f14", weight: 700 },
      body: { color: "#413324", size: 15, line: 1.9 },
      h2: { color: "#8a4b16", size: 18, border: "#c98b3c", bg: "#fdf6ea", pad: "8px 12px" },
      h3: { color: "#8a4b16", size: 16 },
      accent: "#b4701f",
      strong: "#7d3f0f",
      quote: { border: "#e0c08a", bg: "#fdf8ef", color: "#6b5843" },
      code: { bg: "#faf5ec", color: "#413324", inlineBg: "#f4ebdb" },
      hr: "#ecdcbf",
      callout: { note: { bg: "#fdf8ef", border: "#e0c08a", label: "#8a6a35" }, warn: { bg: "#fdf0e8", border: "#e2a87f", label: "#a85732" }, tip: { bg: "#f5f8ee", border: "#b9ca92", label: "#5e7440" } },
    },
    mono: {
      label: "极简",
      title: { font: "-apple-system,'PingFang SC','Microsoft YaHei',sans-serif", color: "#111", weight: 600 },
      body: { color: "#333", size: 15, line: 1.85 },
      h2: { color: "#111", size: 17, border: "#111", bg: "transparent", pad: "0 0 0 0" },
      h3: { color: "#111", size: 15.5 },
      accent: "#111",
      strong: "#111",
      quote: { border: "#ddd", bg: "#fafafa", color: "#5c5c5c" },
      code: { bg: "#f5f5f5", color: "#333", inlineBg: "#f0f0f0" },
      hr: "#e6e6e6",
      callout: { note: { bg: "#f7f7f7", border: "#ccc", label: "#777" }, warn: { bg: "#faf3f0", border: "#d9b3a2", label: "#a85732" }, tip: { bg: "#f4f7f4", border: "#b9c7b9", label: "#54704f" } },
    },
  };

  /* ── 工具 ──────────────────────────────────────────────────────────── */
  const esc = (s) =>
    String(s)
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;");

  // 只处理汉字与拉丁字母/数字的交界；全角标点自带视觉空白，不再额外插空
  const CJK = "\\u4e00-\\u9fff\\u3400-\\u4dbf";
  const LATIN = "A-Za-z0-9@#$%&=+\\\\/";

  /** 中英文/数字之间插入 1/4 空（中文排版惯例），只在文本节点上做，不碰标签 */
  function applyCjkSpacing(htmlText) {
    return htmlText.replace(/([^<>]*)/g, (seg) => {
      if (!seg.trim()) return seg;
      return seg
        .replace(new RegExp("([" + CJK + "])([" + LATIN + "])", "g"), "$1\u2009$2")
        .replace(new RegExp("([" + LATIN + "])([" + CJK + "])", "g"), "$1\u2009$2");
    });
  }

  /* ── 行内解析 ──────────────────────────────────────────────────────── */
  function inline(text, th) {
    const stash = [];
    const keep = (h) => "\u0000" + (stash.push(h) - 1) + "\u0000";

    let s = esc(text);

    // 行内代码
    s = s.replace(/`([^`]+)`/g, (_, code) =>
      keep(
        `<span style="background:${th.code.inlineBg};color:${th.code.color};padding:1px 5px;border-radius:4px;font-family:'SF Mono',Menlo,Consolas,monospace;font-size:0.9em;">${code}</span>`
      )
    );

    // 图片
    s = s.replace(/!\[([^\]]*)\]\(([^)\s]+)(?:\s+&quot;([^&]*)&quot;)?\)/g, (_, alt, src) =>
      keep(
        `<img src="${src}" alt="${alt}" style="max-width:100%;height:auto;display:block;margin:1.2em auto;border-radius:6px;" />`
      )
    );

    // 链接
    s = s.replace(/\[([^\]]+)\]\(([^)\s]+)\)/g, (_, label, href) =>
      keep(
        `<a href="${href}" style="color:${th.accent};text-decoration:none;border-bottom:1px solid ${th.accent};">${label}</a>`
      )
    );

    // 粗体 / 斜体 / 删除线
    s = s.replace(/\*\*([^*]+)\*\*/g, `<strong style="color:${th.strong};font-weight:600;">$1</strong>`);
    s = s.replace(/(^|[^*])\*([^*\n]+)\*(?!\*)/g, `$1<em style="color:${th.accent};font-style:normal;border-bottom:1px dashed ${th.accent};">$2</em>`);
    s = s.replace(/~~([^~]+)~~/g, `<span style="color:#9a9488;text-decoration:line-through;">$1</span>`);

    // 还原
    s = s.replace(/\u0000(\d+)\u0000/g, (_, i) => stash[Number(i)]);
    return s;
  }

  /* ── 块级解析 ──────────────────────────────────────────────────────── */
  function renderBlocks(md, th, opts) {
    const out = [];
    const lines = String(md || "").replace(/\r\n?/g, "\n").split("\n");
    let i = 0;
    const bodyStyle = `font-size:${th.body.size}px;line-height:${th.body.line};color:${th.body.color};letter-spacing:0.02em;text-align:justify;word-break:break-word;`;

    const p = (html) => `<p style="margin:0 0 1.45em;${bodyStyle}">${html}</p>`;

    while (i < lines.length) {
      let line = lines[i];

      // 空行
      if (!line.trim()) { i++; continue; }

      // 分隔线
      if (/^\s*([-*_])\1{2,}\s*$/.test(line)) {
        out.push(
          `<div style="margin:2em 0;text-align:center;line-height:0;"><span style="display:inline-block;width:100%;border-top:1px solid ${th.hr};"></span></div>`
        );
        i++; continue;
      }

      // 代码块
      const fence = line.match(/^\s*```\s*([A-Za-z0-9+-]*)\s*$/);
      if (fence) {
        i++;
        const buf = [];
        while (i < lines.length && !/^\s*```\s*$/.test(lines[i])) { buf.push(lines[i]); i++; }
        i++; // 跳过结束 fence
        out.push(
          `<div style="margin:0 0 1.2em;padding:13px 14px;background:${th.code.bg};border-radius:8px;overflow-x:auto;">` +
            `<code style="font-family:'SF Mono',Menlo,Consolas,monospace;font-size:12.5px;line-height:1.75;color:${th.code.color};white-space:pre-wrap;word-break:break-all;display:block;">${esc(buf.join("\n"))}</code></div>`
        );
        continue;
      }

      // Callout :::tip 文案 :::
      const call = line.match(/^\s*:::\s*(note|tip|warn|warn\b|danger)\s*(.*)$/i);
      if (call) {
        const kind = /danger|warn/i.test(call[1]) ? "warn" : call[1].toLowerCase() === "tip" ? "tip" : "note";
        const buf = [];
        if (call[2]) buf.push(call[2]);
        i++;
        while (i < lines.length && !/^\s*:::\s*$/.test(lines[i])) { buf.push(lines[i]); i++; }
        i++;
        const c = th.callout[kind];
        const labelText = kind === "warn" ? "注意" : kind === "tip" ? "提示" : "说明";
        out.push(
          `<div style="margin:1.3em 0;padding:12px 14px;background:${c.bg};border-left:3px solid ${c.border};border-radius:0 8px 8px 0;">` +
            `<p style="margin:0 0 4px;font-size:11px;letter-spacing:0.12em;color:${c.label};font-weight:700;">${labelText}</p>` +
            `<p style="margin:0;${bodyStyle}">${inline(buf.join(" "), th)}</p></div>`
        );
        continue;
      }

      // 标题
      const h = line.match(/^\s*(#{1,6})\s+(.*)$/);
      if (h) {
        const level = h[1].length;
        const text = inline(h[2].trim(), th);
        if (level <= 1) {
          out.push(`<h1 style="margin:0 0 .7em;font-family:${th.title.font};font-size:23px;line-height:1.45;font-weight:${th.title.weight};color:${th.title.color};letter-spacing:0.01em;">${text}</h1>`);
        } else if (level === 2) {
          out.push(
            `<h2 style="margin:2.2em 0 .8em;font-family:${th.title.font};font-size:${th.h2.size}px;line-height:1.5;font-weight:700;color:${th.h2.color};background:${th.h2.bg};border-left:4px solid ${th.h2.border};padding:${th.h2.pad};border-radius:2px;">${text}</h2>`
          );
        } else {
          out.push(
            `<h3 style="margin:1.6em 0 .55em;font-size:${th.h3.size}px;line-height:1.55;font-weight:700;color:${th.h3.color};">${text}</h3>`
          );
        }
        i++; continue;
      }

      // 引用
      if (/^\s*>\s?/.test(line)) {
        const buf = [];
        while (i < lines.length && /^\s*>\s?/.test(lines[i])) { buf.push(lines[i].replace(/^\s*>\s?/, "")); i++; }
        out.push(
          `<blockquote style="margin:1.3em 0;padding:2px 0 2px 14px;border-left:3px solid ${th.quote.border};background:${th.quote.bg};border-radius:0 6px 6px 0;">` +
            `<p style="margin:10px 14px 10px 0;${bodyStyle}color:${th.quote.color};">${inline(buf.join(" "), th)}</p></blockquote>`
        );
        continue;
      }

      // 表格
      if (/^\s*\|.*\|\s*$/.test(line) && i + 1 < lines.length && /^\s*\|[\s:|-]+\|\s*$/.test(lines[i + 1])) {
        const rows = [];
        const header = line.trim().replace(/^\||\|$/g, "").split("|").map((c) => c.trim());
        i += 2;
        while (i < lines.length && /^\s*\|.*\|\s*$/.test(lines[i])) {
          rows.push(lines[i].trim().replace(/^\||\|$/g, "").split("|").map((c) => c.trim()));
          i++;
        }
        const ths = header
          .map((c) => `<th style="border:1px solid ${th.hr};padding:7px 9px;background:${th.quote.bg};font-size:13px;font-weight:600;text-align:left;color:${th.body.color};">${inline(c, th)}</th>`)
          .join("");
        const trs = rows
          .map(
            (r) =>
              "<tr>" +
              header
                .map((_, ci) => `<td style="border:1px solid ${th.hr};padding:7px 9px;font-size:13px;text-align:left;color:${th.body.color};">${inline(r[ci] || "", th)}</td>`)
                .join("") +
              "</tr>"
          )
          .join("");
        out.push(`<div style="overflow-x:auto;margin:0 0 1.3em;"><table style="width:100%;border-collapse:collapse;font-size:13px;"><thead><tr>${ths}</tr></thead><tbody>${trs}</tbody></table></div>`);
        continue;
      }

      // 列表
      const li0 = line.match(/^(\s*)([-*+]|\d+[.)])\s+(.*)$/);
      if (li0) {
        const ordered = /\d/.test(li0[2]);
        const items = [];
        while (i < lines.length) {
          const l = lines[i];
          const m = l.match(/^(\s*)([-*+]|\d+[.)])\s+(.*)$/);
          if (m) { items.push({ indent: m[1].length, text: m[3] }); i++; continue; }
          // 续行
          if (l.trim() && /^\s{2,}/.test(l) && items.length) {
            items[items.length - 1].text += " " + l.trim();
            i++; continue;
          }
          break;
        }
        const tag = ordered ? "ol" : "ul";
        const lis = items
          .map((it) => {
            const nested = it.indent >= 2 ? "margin-left:1.1em;list-style-type:circle;" : "";
            return `<li style="margin:.4em 0;${bodyStyle}${nested}">${inline(it.text, th)}</li>`;
          })
          .join("");
        out.push(`<${tag} style="margin:0 0 1.2em;padding-left:1.35em;${bodyStyle}">${lis}</${tag}>`);
        continue;
      }

      // 段落（合并连续非空行）
      const buf = [line];
      i++;
      while (i < lines.length && lines[i].trim() && !/^\s*(#{1,6}\s|>|```|:::|[-*+]\s|\d+[.)]\s|\||([-*_])\2{2,})/.test(lines[i])) {
        buf.push(lines[i]); i++;
      }
      out.push(p(inline(buf.join(" ").trim(), th)));
    }

    return out.join("\n");
  }

  /* ── 对外 ──────────────────────────────────────────────────────────── */
  /** 渲染正文（不含标题） */
  function renderBody(markdown, themeName, opts) {
    const th = THEMES[themeName] || THEMES.ink;
    const o = opts || {};
    let html = renderBlocks(markdown, th, o);
    if (o.cjkSpacing !== false) html = applyCjkSpacing(html);
    // 公众号正文容器
    return (
      `<section style="font-family:-apple-system,BlinkMacSystemFont,'PingFang SC','Microsoft YaHei',sans-serif;">` +
      html +
      (o.footer ? `<p style="margin-top:2em;padding-top:12px;border-top:1px solid ${th.hr};font-size:12px;color:#9a9488;line-height:1.7;">${esc(o.footer)}</p>` : "") +
      `</section>`
    );
  }

  /** 渲染标题区（预览用，不参与复制） */
  function renderTitle(title, meta, themeName) {
    const th = THEMES[themeName] || THEMES.ink;
    return (
      `<div style="margin:0 0 18px;">` +
      `<h1 style="margin:0 0 10px;font-family:${th.title.font};font-size:22px;line-height:1.45;font-weight:${th.title.weight};color:${th.title.color};letter-spacing:0.01em;">${esc(title || "未命名稿件")}</h1>` +
      `<div style="font-size:12px;color:#a09a8e;letter-spacing:0.04em;">${esc(meta || "")}</div>` +
      `</div>`
    );
  }

  /* ── 体检 ──────────────────────────────────────────────────────────── */
  /* 只挑「确实容易踩广告法/诱导分享红线」的词，宁可漏报也不要误报
     （早期版本把「第一」也算进去，结果「第一步」被标红，纯噪音） */
  const RISK_WORDS = [
    "最强", "最佳", "顶级", "唯一", "100%", "绝对有效", "包治", "根治",
    "永久有效", "月入", "稳赚", "保本", "限时秒杀", "免费领取", "转发抽奖",
    "关注领红包", "史上最", "国家级", "销量第一", "全国第一",
  ];

  function audit(markdown) {
    const text = String(markdown || "")
      .replace(/```[\s\S]*?```/g, " ")
      .replace(/[#>*`_~\-|]/g, " ");
    const cjk = (text.match(/[\u4e00-\u9fff]/g) || []).length;
    const latinWords = (text.match(/[A-Za-z]+/g) || []).length;
    const chars = cjk + latinWords;
    const minutes = Math.max(1, Math.round(chars / 400));

    const paras = String(markdown || "")
      .split(/\n{2,}/)
      .map((p) => p.trim())
      .filter((p) => p && !p.startsWith("#") && !p.startsWith("```") && !p.startsWith(":::"));
    const longParas = paras.filter((p) => (p.match(/[\u4e00-\u9fff]/g) || []).length > 180).length;

    const risks = [];
    RISK_WORDS.forEach((w) => {
      if (text.includes(w)) risks.push(w);
    });

    const heads = (String(markdown || "").match(/^#{2,3}\s+/gm) || []).length;

    return {
      chars,
      minutes,
      paras: paras.length,
      longParas,
      heads,
      risks,
      title: (String(markdown || "").match(/^#\s+(.+)$/m) || [])[1] || "",
    };
  }

  global.WxRender = { renderBody, renderTitle, audit, THEMES, applyCjkSpacing };
})(typeof window !== "undefined" ? window : globalThis);
