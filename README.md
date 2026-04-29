# Vibe Suite

`vibe-suite` 是 Vibe 系列项目的上层工作区，只负责组织独立项目，不承载业务代码。

目录结构：

```text
vibe-suite/
  vibe-im/
  vibe-claw/
```

- `vibe-im`：纯即时通讯系统。
- `vibe-claw`：支持第三方调用、多 Agent 协作和工程化治理的智能体工程平台。

两个项目保持独立代码、独立依赖、独立服务进程、独立数据库边界和独立部署流程。项目之间只能通过公开 API、协议契约和可选身份映射集成。
