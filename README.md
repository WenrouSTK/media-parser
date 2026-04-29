# media-parser

小红书链接解析下载 H5。粘贴分享链接 → 解析原图/原视频 → 保存到手机。

## 快速开始（本地）

```bash
cd media-parser
npm install
npm start
# 浏览器访问 http://localhost:3000
```

## 部署到服务器（Coolify）

服务器：`81.71.129.63`（已装 Coolify）
域名方案：`sslip.io`（临时免域名 HTTPS）

### 方式 1：Git 仓库部署（推荐）

1. 把 `media-parser/` 推到 GitHub（新 repo 或子目录）
2. Coolify → **+ New** → **Resource** → **Public Repository**
3. 填仓库地址，**Build Pack** 选 `Dockerfile`，**Base Directory** 填 `/media-parser`（如果是子目录）
4. **Port** 填 `3000`
5. **Domains** 填 `media-parser.81-71-129-63.sslip.io`（sslip.io 会自动解析到 81.71.129.63）
6. 点 **Deploy**，等 Coolify 自动 build + 拿 Let's Encrypt 证书

### 方式 2：直接上传文件

1. Coolify → **+ New** → **Resource** → **Docker Compose** 或 **Dockerfile**
2. 把整个目录打包上传

### 验证

部署完成后：
- 健康检查：`https://media-parser.81-71-129-63.sslip.io/api/health`
- 主页：`https://media-parser.81-71-129-63.sslip.io/`

手机浏览器打开主页，粘贴小红书链接测试。

## 技术栈

- Express + undici（原生 fetch）
- 纯 HTML 前端（单文件）
- 小红书 adapter：抠 `window.__INITIAL_STATE__`

## 已知限制

- 小红书 DOM 结构会变，失效时需调整 `adapters/xhs.js`
- 视频 URL 有时效性（几小时），解析后尽快下载
- iOS Safari 点保存 = 新页打开 → 长按存储
- 只做了小红书，其他平台待加
