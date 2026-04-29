# 数据库文档

## 总原则

Vibe IM 只使用 PostgreSQL 作为应用数据库。

数据库变更必须通过 `app/db/migrations/*.sql` 版本化迁移，禁止在运行时代码中直接新增表或索引。

当前数据库只服务纯 IM 功能，保留用户、会话、成员、消息、附件、好友和登录会话等通用表。

## 连接配置

应用读取 `DATABASE_URL`。

本地默认：

```text
postgresql://vibe_im:vibe_im_local_password@localhost:5432/vibe_im
```

## 迁移

迁移文件位置：

```text
app/db/migrations
```

手动执行：

```bash
npm --prefix app run db:migrate
```

健康检查：

```bash
npm --prefix app run db:healthcheck
```

## 核心表

- `users`：真人用户。
- `sessions`：登录会话和传输密钥。
- `friendships`：好友关系。
- `friend_requests`：好友申请预留。
- `conversations`：单聊和群聊。
- `conversation_members`：会话成员和阅读游标。
- `groups`：群聊资料。
- `messages`：消息。
- `attachments`：图片和文件元数据。

## 消息序号

消息写入使用事务级 advisory lock 保护同一会话内的 `messages.seq` 分配。

要求：

- `messages.seq` 在同一 conversation 内单调递增。
- 上层模块不能绕过 `chat-service` 手写消息。
- WebSocket 广播由 `realtime` 订阅 chat event 处理。

## 文件存储

文件正文存储在本地 `uploads/`，数据库只保存：

- 文件名。
- MIME 类型。
- 文件大小。
- 本地存储路径。
- 文件类型。
- 所属用户。
