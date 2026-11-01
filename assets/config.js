/**
 * 云服务公开配置。
 * 这些值由 WorkBuddy 云服务下发，publishableKey 只标识「哪个应用」、本身不带权限，
 * 服务端会校验来源域名（Origin），因此可以安全地放在前端。
 * 真正的环境 ID 与模型供应商密钥始终保存在服务端，从不下发。
 */
window.APP_CONFIG = {
  cloud: {
    endpoint: "https://wechat-studio-57144.app.workbuddy.host",
    publishableKey: "wbpk_y91YB4mtZ71Pf3TAxt9U6x_WwvbUCqqxKe7Kk44B4nnEB2FxCi8JiQB",
  },
  app: {
    name: "稿台",
    version: "1.0.0",
  },
};
