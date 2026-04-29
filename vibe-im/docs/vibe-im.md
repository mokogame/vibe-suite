# Vibe IM 项目文档

## 项目定位

Vibe IM 当前定位为纯净的即时通讯系统。

保留目标：

- 真人用户账号体系。
- 好友、单聊、群聊。
- 文字、图片、文件消息。
- WebSocket 实时同步。
- 历史消息、未读数、离线补拉。
- 管理后台用户管理。
- PostgreSQL 数据库和本地文件存储。

## 技术约束

- 前端和后端统一采用 Next.js。
- 数据库只使用 PostgreSQL。
- 实时通信使用 WebSocket。
- 前端用户只允许账号密码登录。
- 默认中文界面。
- MVP 按单租户、自有服务器部署、本地文件存储设计。

默认数据库连接：

```text
DATABASE_URL=postgresql://vibe_im:vibe_im_local_password@localhost:5432/vibe_im
```

常用命令：

```bash
npm --prefix app run dev
npm --prefix app run db:migrate
npm --prefix app run db:healthcheck
npm --prefix app run build
```

开发服务使用 `.next-dev` 作为 Next.js 开发产物目录，`build/start` 使用 `.next-build` 作为生产构建产物目录，避免本地构建覆盖正在运行的开发服务。`npm --prefix app run dev` 会先检查 `2900` 端口；交互式终端发现已有 Vibe IM 服务时，会提示选择重启替换或维持并退出；非交互式环境中，健康服务默认维持退出，异常服务默认重启替换。开发模式下自定义 `server.mjs` 和 `lib/` 由 Node watch 自动重启，页面、组件和样式仍由 Next.js HMR 更新。

## 功能范围

### 账号

- 管理员创建真人用户。
- 用户登录、退出、查看资料、修改昵称和密码。
- 管理员可启用、禁用用户。

### 好友

- 通过 `username` 搜索用户。
- 添加好友。
- 好友用于管理常用联系人，不作为发起单聊或群聊邀请的前置条件。

### 单聊

- 可通过有效 `username` 发起单聊。
- 不要求好友关系，但禁止与自己发起单聊。
- 支持文字、图片、文件消息。
- 支持历史消息分页和未读数。

### 群聊

- 创建群聊。
- 可通过有效 `username` 邀请用户入群，成员自动加入。
- 群聊邀请不要求好友关系；系统校验目标用户、成员上限和重复成员。
- 群主或管理员移除成员。
- 群主解散群。
- 支持文字、图片、文件消息。

### 消息

- 每条消息有唯一 ID、会话 ID、发送者、服务端时间、类型和会话内递增序号。
- 会话内消息以 `seq` 排序。
- 文字消息在 HTTP/WebSocket payload 中使用应用层加密。
- 附件下载必须校验会话成员权限。

### 文件

- 图片最大 10 MB。
- 普通文件最大 50 MB。
- 文件存储在本地 `uploads/`。
- PostgreSQL 只保存附件元数据和存储路径。

## 架构边界

- `app/lib/chat.js`：聊天数据库事实源，负责会话、成员、消息、附件和阅读游标。
- `app/lib/chat-service.js`：发送消息和群成员操作的业务入口。
- `app/lib/realtime.js`：WebSocket 连接、请求响应和聊天事件分发。
- `app/lib/db.js`：PostgreSQL 连接、迁移、会话和用户基础能力。
- `app/pages/api/*`：HTTP API。
- `app/pages/index.jsx`：IM 主界面。
- `app/pages/admin.jsx`：后台用户管理。
