# C6 源码地址（交付物）

**提交人：** JingXueQing（景雪晴） ｜ 学号/ID：2024102110351

## 一、GitHub 仓库（公开，已上线）

**https://github.com/jingxueqing/wechat-studio**

| 项 | 内容 |
|---|---|
| 可见性 | Public（未登录也能看、能 clone） |
| 默认分支 | `main` |
| 提交 | 10 条（7 条代码/文档经 `git push`，3 条收尾文档经 Contents API） |
| 标签 | `v1.0.0` |
| 许可证 | MIT（仓库内 `LICENSE`） |
| Topics | `wechat` `wechat-mp` `markdown-to-wechat` `inline-style` `ai-writing` `vanilla-js` `llm` |
| Homepage | 已指向线上应用地址 |

```bash
git clone https://github.com/jingxueqing/wechat-studio.git
cd wechat-studio
node tests/renderer.test.cjs   # 15 项
node tests/ai.test.cjs         # 10 项
```

仓库根目录：

```
wechat-studio/
├── index.html              314 行   单页骨架（输入 / 工作台 / 助手三栏）
├── assets/
│   ├── app.css             779 行   设计系统 + 响应式 + 四套主题
│   ├── app.js              863 行   业务状态机（四步流水线、改稿、体检、草稿箱）
│   ├── renderer.js         346 行   公众号行内样式排版引擎（自研核心）
│   ├── ai.js               200 行   LLM 调用层（流式 / JSON / 错误翻译 / 退避重试）
│   ├── prompts.js          170 行   五组提示词
│   ├── sample.js            71 行   示例稿
│   ├── config.js            16 行   云服务公开配置
│   └── wbcloud.sdk.js              官方云 SDK（自托管）
├── tests/
│   ├── renderer.test.cjs   146 行   渲染引擎 15 项
│   ├── ai.test.cjs          69 行   AI 层 10 项
│   └── llm.smoke.cjs       100 行   线上链路冒烟（需联网）
├── AI_LOG.md               12 轮迭代，12 类真实失败含根因与修复
├── ATTRIBUTION.md          借鉴来源与自研边界
├── LICENSE                 MIT
└── README.md               产品说明 / 本地运行 / 边界
```

合计 **3080 行**（页面/样式/脚本 2765 + 测试 315），25 项自测全绿；另有文档 501 行。

### git 提交历史（GitHub `main` 实际状态，共 10 条）

```
8968752 docs: AI_LOG 补失败 10（git 端口被挡，改用 Contents API 提交）   ← API
d02a375 docs: ATTRIBUTION 与交付版同步                                  ← API
7ccf01c docs: AI_LOG 补第 11 轮（GitHub 补推与判断失误复盘）             ← API
9dbe60d docs: 开源仓库补齐 AI_LOG / ATTRIBUTION / LICENSE，README 更新
6a26e67 fix: 空状态说明换行与体检卡滚动定位
8a1352e docs: README、云 LLM 冒烟测试与交付说明
3773baa feat: 创作流水线状态机、改稿与体检
0cf65dc feat: 提示词与 LLM 调用层
a0e85a4 feat: 公众号行内样式排版引擎 + 15 项自测
e17be06 feat: 三栏创作台骨架与设计系统
```

> 末三条是收尾时**通过 GitHub Contents API 提交**的（当时 `git push` 的 443 长连接被代理挡住，见第三节第 4 点）。
> 交付目录内的本地仓库**包含远端全部 10 条提交**（走到 `8968752` 时文件树 `0315ab9…` 与远端逐字节相同），此后本地又追加了 4 条收尾修正，所以本地 HEAD 是 `4b65fca`。
>
> **远端 10 条，本地 14 条**：多出的 4 条是最后一遍复验时补的修正——① 仓库 `README.md` 把「10 轮 / 8 类失败」改成与 `AI_LOG.md` 一致的轮次；② `tests/llm.smoke.cjs` 头注释写清 401 的成因（云端只信任已发布页面的真实会话）；③ `AI_LOG.md` 补第 12 轮复验记录；④ `AI_LOG.md` 里 bundle 体积改成约数（每次重建都会差几十字节）。
> 这 3 条**没能推上去**：`github.com:443` 又回到 `CONNECT 502`，本机也没有 Git 凭据（`fatal: could not read Username`）。
> 所以 GitHub 上的 README 还写着旧的轮次数，其余文件与本地一致；**bundle 里是含这 3 条修正的完整版本**。

> 这是单人单次会话完成的项目，提交历史按**模块**梳理以便阅读，不是逐分钟实录。
> 逐轮的迭代、12 类失败与修复过程在 `AI_LOG.md`（交付目录同名 `JingXueQing_C6_AI日志.md`）里。

---

## 二、离线备份（防仓库丢失 / 换机器还原）

| 位置 | 路径 | 说明 |
|---|---|---|
| 交付目录内源码 | `C6-交付_JingXueQing_公众号创作台/wechat-studio/` | 含 `.git`，与 GitHub 同一条历史 + 4 条未推的收尾修正 |
| git bundle | `C6-交付_JingXueQing_公众号创作台/JingXueQing_C6_源码.bundle` | 88KB（90,641 字节），`git bundle verify` 通过，含完整历史（14 条）+ `v1.0.0` |

```bash
git clone "C6-交付_JingXueQing_公众号创作台/JingXueQing_C6_源码.bundle" wechat-studio
```

---

## 三、推送过程（如实记录，含踩的坑）

1. **11-01 20:30**：直接 `git push` → 90 秒无响应被终止；`curl https://github.com/` 返回 `000`（超时）。当时判断为「本机到 github.com 不通」，记为未完成。
2. **11-02 09:45**：复测 `curl github.com` → `200 0.93s`。**说明昨天不全是网络问题**，于是改测凭据：`gh` 未安装、`~/.git-credentials` 不存在、`git credential fill` 报 `could not read Username` —— 根因是**机器上没有任何 GitHub 凭据**。
3. **11-02 14:43**：拿到 token 后 `POST /user/repos` 建公开仓库（201），再 `git push` → 第一次被环境中断（SIGTERM），**改到后台重跑后成功**（`[new branch] main -> main`），第二次推送带上文档提交与 `v1.0.0` 标签。
4. **11-02 15:05**：再想推最后两次文档提交时，`github.com:443` 开始返回 `CONNECT tunnel failed, response 502`（`curl github.com` 也就 `000` 超时），但 `api.github.com` 仍是 `200`。**于是改用 Contents API 提交这两份文档**（`PUT /repos/:owner/:repo/contents/:path`），两次都返回 `200`，远端文件与本地逐字节一致（树 `6ead32a…`）。

> **关于 token**：只在命令的环境变量里用过，**没有写进 `.git/config`、没有写进任何文件**；`git remote -v` 现在是干净地址，`grep -r "ghp_"` 在仓库与交付目录内均为空。

**这个坑的教训**（已写进 AI 日志第 13 节）：把「网络不通」和「没有凭据」当成同一件事，会让人停在错误的结论上——两种失败的报错完全不一样，前者是超时 / `000`，后者是 `could not read Username`。**报错文本本身就是分类依据。**

---

## 四、一句话说明（发群用）

> C6 的产品是「稿台」：写两句想法 → AI 选题、起标题、搭大纲、写全文、排成公众号版式 → 复制粘贴直接发。
> 应用：https://wechat-studio-57144.app.workbuddy.host/?sharecode=LOMYO4IMBO
> 源码：https://github.com/jingxueqing/wechat-studio （纯静态、无构建、零运行时依赖，3080 行 + 25 项自测全绿，MIT）
