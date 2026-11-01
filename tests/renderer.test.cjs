/* 渲染引擎自测：node tests/renderer.test.cjs
   目标：验证「粘进公众号还能看」依赖的三件事——行内样式、代码块换行、中文排版。*/
const assert = require("node:assert");
require("../assets/renderer.js");
const R = globalThis.WxRender;

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

const SAMPLE = `## 先说结论

这句话里有 **重点**，还有 \`inline code\`，以及 English words 混排。

> 单独截图也好用的一句话。

### 怎么做

1. 第一步，打开编辑器
2. 第二步，粘进去

- 无序要点
- 另一个要点

:::tip 这一段是补充说明
补充说明的正文。
:::

\`\`\`js
const a = 1;
const b = 2;
// 换行必须保住
\`\`\`

| 方案 | 成本 |
|---|---|
| A | 10 元 |

---

最后一段。`;

console.log("\n[渲染引擎]");
const html = R.renderBody(SAMPLE, "ink", { cjkSpacing: true });

ok("输出不含 <style>/<script>", () => {
  assert(!/<style|<script/i.test(html));
});

ok("所有标签都带 inline style（公众号会丢 class）", () => {
  const tags = html.match(/<(?!\/)[a-z0-9]+[^>]*>/gi) || [];
  const noStyle = tags.filter((t) => !/^<(section|br|tbody|thead|tr|table)/i.test(t) && !/style=/.test(t));
  assert.strictEqual(noStyle.length, 0, "缺少样式的标签：" + noStyle.slice(0, 3).join(" "));
});

ok("代码块保留换行与顺序", () => {
  assert(html.includes("const a = 1;"));
  const i1 = html.indexOf("const a = 1;");
  const i2 = html.indexOf("const b = 2;");
  assert(i1 < i2);
  assert(/white-space:pre-wrap/.test(html));
});

ok("标题层级正确（## → h2，### → h3）", () => {
  assert(/<h2[^>]*>先说结论<\/h2>/.test(html));
  assert(/<h3[^>]*>怎么做<\/h3>/.test(html));
});

ok("引用 / 列表 / 表格 / 分隔线都在", () => {
  assert(html.includes("<blockquote"));
  assert(html.includes("<ol"));
  assert(html.includes("<ul"));
  assert(html.includes("<table"));
  assert(/border-top:1px solid/.test(html));
});

ok("Callout 被转成带色块的提示框", () => {
  assert(html.includes("提示"));
  assert(/border-left:3px solid/.test(html));
});

ok("中英之间插入了细间距，全角标点后不插", () => {
  const h = R.renderBody("用AI写稿，30分钟搞定。", "ink", { cjkSpacing: true });
  assert(h.includes("用\u2009AI"), "汉字与字母之间应有细间距");
  assert(h.includes("30\u2009分钟"), "数字与汉字之间应有细间距");
  assert(!h.includes("，\u2009"), "全角标点后不该再插空");
});

ok("关闭中英间距后不插入", () => {
  const plain = R.renderBody("中文 English 混排", "ink", { cjkSpacing: false });
  assert(!plain.includes("\u2009"));
});

ok("HTML 特殊字符被转义（注入防护）", () => {
  const evil = R.renderBody("<img src=x onerror=alert(1)>", "ink", {});
  assert(!evil.includes("<img src=x"));
  assert(evil.includes("&lt;img"));
});

ok("四个主题都能出样式", () => {
  ["ink", "forest", "amber", "mono"].forEach((t) => {
    const h = R.renderBody("## 标题\n\n正文", t, {});
    assert(/color:#[0-9a-f]{3,6}/i.test(h), t + " 缺颜色");
  });
});

// 曾经的真实 bug：主题里的字体栈写成 "Songti SC" 双引号，
// 把 style="..." 属性提前截断，标题变成浏览器默认样式。
ok("字体栈里不能再出现双引号", () => {
  Object.entries(R.THEMES).forEach(([name, th]) => {
    [th.title.font, th.h2.border, th.body.color].forEach((v) => {
      assert(!String(v).includes('"'), name + " 主题里出现了双引号，会截断 style 属性");
    });
  });
});

ok("样式没有漏进正文文字（属性被截断的典型症状）", () => {
  const h = R.renderBody("## 一个标题\n\n一段正文", "ink", {});
  const textOnly = h.replace(/<[^>]+>/g, "");
  assert(!/serif"?>|Georgia|font-family/.test(textOnly), "样式片段漏成了可见文字：" + textOnly.slice(0, 80));
});

console.log("\n[体检]");
ok("字数统计忽略 Markdown 符号", () => {
  const a = R.audit("## 标题\n\n**加粗** 的正文。");
  assert(a.chars > 3 && a.chars < 20);
  assert(a.heads === 1);
});
ok("能抓到风险用词", () => {
  const a = R.audit("这是全网最强的方案，100% 有效。");
  assert(a.risks.includes("最强") && a.risks.includes("100%"));
});
ok("长段落能被识别", () => {
  const a = R.audit("中".repeat(200));
  assert.strictEqual(a.longParas, 1);
});

console.log(`\n${pass} 项通过${process.exitCode ? "，有失败项" : "，全绿"}\n`);
