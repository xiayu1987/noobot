# Noobot Service

中文 | [English](./README.md)

`service/` 是 Noobot 的 Express 5 与 WebSocket 宿主。Agent 行为由独立的 `noobot-agent` workspace 负责；Service 只负责 HTTP/WS 准入、认证、配置下发、工作区访问和 Service 插件能力。

## 运行依赖

- Node.js 22.22.2+
- npm 9+
- 可选：启用相关能力时使用的 LibreOffice、FFmpeg、Docker 和 OpenVSCode Server 依赖

## 运行与测试

```bash
cd service
npm install
npm start

# 开发
npm run dev

# 测试
npm test
npm run test:routes
npm run test:tools
```

项目内 PM2 命令：

```bash
npm run pm2:start
npm run pm2:restart
npm run pm2:logs
npm run pm2:stop
```

完整部署使用仓库根目录的 `./start.sh` 或 `./restart-services.sh`。

## 配置

- 全局配置：`service/config/global.config.json`
- 全局模板：`service/config/global.config.example.json`
- 用户配置：`workspace/<userId>/config.json`
- 系统参数：`workspace/config-params.json`
- 用户参数：`workspace/<userId>/config-params.json`
- 环境文件：`service/.env`

字段和优先级以[配置说明](../CONFIGURATION.zh-CN.md)为准。

## 认证

- `GET /health` 和 `POST /internal/connect` 不要求 API key。
- 其他 Service 路由要求已签发的 API key；插件路由必须使用 Manifest 中声明并校验的认证策略。
- `POST /internal/connect` 使用 `userId + connectCode` 换取连接数据和 API key。
- 认证请求支持 `x-api-key`、`Authorization: Bearer <apiKey>` 或 `?apikey=...`。
- `/internal/admin/*` 还要求已配置的超级管理员角色。

## 主要 API 分组

- 对话与传输：`POST /chat`、`WS /chat/ws`、`WS /logs/ws`
- Session：`/internal/sessions/:userId`、`/internal/session/:userId/:sessionId`
- Session 修改：`messages/delete-from`、`messages/replace-turn`、`rename`
- 附件：`/internal/attachment/:userId/:attachmentId`，查询参数必须带完整 Session/source 身份
- 连接器：目录、用户实例、连接/断开和 Session 选择
- 用户工作区：`/internal/workspace/:userId`、重置和同步
- 管理端：用户、模板、配置参数和全工作区操作
- 插件：通过受限插件宿主绑定的 Manifest Service 路由

精确方法和路径以 `routes/` 下的路由模块及插件 Manifest 为准。

## 目录职责

```text
service/
├── app.js                 进程入口与组合根
├── bootstrap/             依赖创建、中间件、路由和服务启动
├── config/                全局配置文件
├── deps/                  Service 侧依赖适配
├── routes/                HTTP 路由模块
├── security/              HTTP 准入与安全策略
├── services/              Service 应用服务与插件宿主
├── ws/                    对话及日志 WebSocket 服务
└── scripts/               Service 工具脚本
```

Agent 执行、工具、Context、Session 领域逻辑、模型解析和记忆位于 `../agent/`。供应商适配与模型执行位于 `../model-runtime/`；Service 不得复制这些职责。
