# noobot-chat

Noobot 前端聊天界面，基于 **Vue 3 + Vite** 构建。

## 功能

- 多会话管理
- SSE 流式对话 + WebSocket 长连接
- 附件上传（文档/图片/音视频）
- 情景模式切换（全能/编程）
- 连接器选择与管理
- 工作区文件浏览
- 移动端适配 + 长内容展示

## 开发

```bash
cd client/noobot-chat
npm install
npm run dev
```

## 构建

```bash
npm run build
```

构建产物输出到 `dist/` 目录。

## 部署

部署配置位于 `deploy/` 目录，包含 Caddy 配置与脚本。配合项目根目录 `start.sh` 一键部署。

## 代理配置

开发时通过 Vite proxy 将 API 请求转发到后端（默认 `http://127.0.0.1:10061`）。

生产环境由 Caddy 反向代理：
- 前端静态资源 → `dist/`
- `/api/*` → 后端服务
- `/chat/ws` → WebSocket 服务
