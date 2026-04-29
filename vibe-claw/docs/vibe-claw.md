# Vibe Claw 项目文档

## 项目定位

Vibe Claw 是独立的大模型与 Agent 能力平台，最终目标是实现一个支持第三方调用、多 Agent 协作和工程化治理的智能体工程平台。

它不是单 Agent 聊天工具，也不是 Vibe IM 的附属功能。它应作为可被 Vibe IM、第三方业务系统、自动化平台或其他服务调用的通用智能能力底座，提供稳定、可审计、可复用的大模型访问、Agent 管理、多 Agent 协作、上下文管理、记忆管理、协议化对话、外部 API 和 token 治理能力。

它不直接承载具体业务流程，不绑定某个行业，不把业务语义写死在核心模型中。

当前模型接入优先级：

1. DeepSeek。
2. OpenAI 兼容接口模型。
3. 其他可配置供应商。

Vibe Claw 与 Vibe IM 的关系：

- Vibe IM 是即时通讯系统，负责用户、会话、消息、文件和实时通信。
- Vibe Claw 是智能能力系统，负责模型调用、Agent、记忆、上下文、协议输出和调用审计。
- 两者可以集成，但数据库、服务边界和核心概念必须独立。

## 当前实现快照

截至 2026-04-29，Vibe Claw 已具备面向正式对外 SaaS/API 服务的最小闭环能力，并已与 `docs/需求文档.md`、`docs/ACCEPTANCE.md`、`docs/api.md`、`docs/developer-api.md`、`README.md` 保持同口径：

- 独立服务：`vibe-claw` 在 `vibe-suite` 仓库内作为独立服务目录交付，拥有独立 Fastify API、后台管理页、迁移、测试和构建命令。
- 独立数据：支持内存存储和 PostgreSQL 存储；运行时只加载当前选定存储，不在内存和数据库之间迁移或污染数据。PostgreSQL 迁移已覆盖 Provider、Agent、Run、Conversation、Message、Memory、Lease、Token、Audit、Queue、Webhook、幂等记录、会话锁、用量和开发者 API 相关表。
- 存储运维：后台系统设置支持读取当前运行存储、配置内存/PostgreSQL 模式、保存 `.env.local`、请求服务重启、重置当前运行存储数据；重置只清当前存储业务数据，不切换模式、不迁移数据。
- 模型接入：支持本地 mock provider、OpenAI-compatible provider、DeepSeek 配置；Provider 通过 `apiKeyRef` 引用密钥，不在后台明文展示。
- Agent 管理：支持创建、查询、修改、归档 Agent；Agent 可绑定指定 Provider 和默认模型。
- 普通对话：支持 `POST /v1/agents/:id/messages`，自动保存会话、消息、Run、事件、token 使用和上下文压缩记录。
- 流式入口：支持 `POST /v1/agents/:id/messages/stream` 的 SSE 事件流，事件包含 `status`、`conversation`、`user_message_created`、`run_created`、`delta`、`assistant_message_completed`、`done`、`error`。
- 协议运行：支持注册协议、执行 protocol run、输入 JSON Schema 校验、模型输出 JSON 解析和输出 JSON Schema 校验。
- 记忆系统：支持 Agent 维度记忆写入、查询、状态更新、作用域隔离和模型上下文注入。
- 上下文压缩：支持 `none`、`recent_only`、`rolling_summary`、`hybrid`、`protocol_minimal` 等策略，并记录压缩审计。
- 租约：支持为 Agent 创建租约，租约可绑定过期时间、token 预算和调用限制字段。
- API token 生命周期：支持创建、查询、撤销、轮换、过期时间、IP allowlist、最后使用时间和最后使用 IP；创建和轮换只返回一次明文 token，列表不暴露 token hash。
- 多租户隔离：API token 带 `tenantId`、`projectId` 和 scopes；核心资源按 tenant/project 过滤，避免不同接入方互相读取。
- 幂等治理：Agent、Provider、Token、Run、Message、Memory、Lease 等关键写入路径支持 `Idempotency-Key`，相同 key 与不同 body 会返回冲突。
- 并发治理：同一 conversation 发送消息时使用会话锁，避免并发写入同一会话造成历史错乱；不同 Agent、不同会话可并行处理。
- 队列治理：异步 Run 进入队列，PostgreSQL 模式支持 claim/lease、锁过期、重试、退避和 `dead_letter`。
- Webhook：支持 Run callback、Webhook 订阅、HMAC 签名、投递日志、失败重试、`dead_letter` 和手动 replay。
- 用量与计费视图：支持 `/v1/usage`、`/v1/billing`、usage counter 持久化聚合、基础套餐/账单摘要；运行时强限额仍以进程内计数为主。
- 审计与观测：支持审计事件、结构化请求日志、Run 事件、基础 `/v1/metrics`、Prometheus `/v1/metrics/prometheus`、版本 `/v1/version`、开发者文档索引 `/v1/developer-docs` 和后台 API 响应面板。
- 开发者接入：支持 OpenAPI JSON、Node SDK、Python SDK、开发者文档索引、API 版本和兼容策略、错误结构归一、Webhook 订阅和工具列表 `/v1/tools`。
- 后台管理：支持概览、模型配置、Agent 管理、Agent 对话页、Agent 记忆页、调用记录、Token/租约、系统设置、开发者、审计、访问令牌弹窗、API 响应面板和危险操作自定义确认弹窗。Agent 对话页采用成熟聊天产品策略：本地乐观消息、Agent 思考占位、SSE 增量更新、成功后清空输入、失败后恢复原文、只在接近底部时自动跟随滚动。

当前明确边界：

- 多 Agent 在同一个 Run 内仍以确定性顺序执行为主，尚未实现复杂并行 DAG、条件分支编排和自动 handoff。
- SSE 已提供稳定事件流入口和后台实时对话体验；上游 provider 原生 token 级透传、暂停/恢复/取消流仍是后续增强。
- 用量与成本已有持久化聚合查询；多实例全局强限额、跨实例并发控制和真实账单扣费仍需生产级配额服务或集中化限流组件。
- `secret://env`、`vault://`、`kms://` 等密钥引用已具备解析桥接，但真实 Vault/KMS SDK 集成属于部署增强。
- Agent 独立版本表、灰度发布、完整 Provider 熔断/健康路由、自动评测质量门禁仍属于后续增强。

## 独立项目硬边界

Vibe Claw 的产品和运行时边界必须独立，不是 Vibe IM 的子模块、插件或内置能力。当前代码以 `vibe-suite` 作为完整 git 仓库，`vibe-claw` 是仓库内独立服务目录，不再维护嵌套 git 仓库。

硬性约束：

- Vibe Claw 必须拥有独立服务目录、独立包配置和独立构建测试命令；未来如需拆仓，不得改变公开 API 契约。
- Vibe Claw 必须拥有独立数据库。
- Vibe Claw 必须拥有独立服务进程。
- Vibe Claw 必须拥有独立后台管理界面。
- Vibe Claw 必须拥有独立 API、鉴权、审计和部署流程。
- Vibe IM 只能通过 Vibe Claw 的公开 API 调用其能力。
- Vibe IM 不得读取、写入或迁移 Vibe Claw 数据库。
- Vibe Claw 不得依赖 Vibe IM 的用户、会话、消息、附件、好友或群聊表。
- 两者之间只能共享协议、API 契约和可选的外部身份映射。

本文件是 Vibe Claw 独立项目的正式产品、架构和工程纪律事实源。Vibe IM 只能通过 Vibe Claw 的公开 API 调用其能力，不得在 `vibe-im` 应用代码中实现 Vibe Claw 的服务、数据库、后台或运行时能力。

## 设计与编码纪律

Vibe Claw 的设计、编码、数据模型、API、后台交互、Agent 记忆、上下文压缩、协议对话、模型调用和运行治理，必须严格参考类似成功项目、成熟工程实践和行业稳定方案。

基本原则：

- 不允许无依据自创核心机制。
- 不允许为了短期演示引入无法解释、不可验证、不可维护的私有设计。
- 不允许把复杂问题包装成“智能自动处理”而缺少确定性状态、审计和失败出口。
- 不允许绕过成熟协议、标准 schema、通用鉴权、版本化迁移、日志审计和错误归一。
- 不允许在没有明确收益和验证路径时自研模型网关、记忆系统、上下文压缩、协议校验或后台组件。

优先参考方向：

- 模型访问与结构化输出：参考 OpenAI API、Anthropic API、DeepSeek API、OpenAI-compatible API、JSON Schema 和 contract-first 调用方式。
- Agent 与工具编排：OpenClaw 是重点参考对象，同时参考 LangGraph、AutoGen、CrewAI、OpenAI Assistants/Responses 的稳定思想，但只吸收确定性状态、工具边界、运行记录和协议化输出，不照搬复杂度。
- 记忆与上下文：参考 RAG、rolling summary、semantic memory、episodic memory、working memory、conversation buffer 等成熟模式，优先简单可验证实现。
- 后台管理：参考常见 SaaS dashboard、模型平台控制台和运维后台的布局，保持简洁、专业、可排障。
- API 与权限：参考 OAuth scope、API token scope、lease、rate limit、audit log 等成熟做法。
- 数据与迁移：参考 PostgreSQL、版本化 migration、软删除、审计事件和不可变运行记录。

OpenClaw 参考要求：

- 设计多 Agent 协作、任务拆解、Agent 调度、运行状态、工具边界、上下文传递和结果汇总前，必须先对照 OpenClaw 的成熟做法。
- 参考 OpenClaw 时只吸收可验证、可审计、可替换的工程模式，不把其实现细节、命名和复杂度原样搬入 Vibe Claw。
- 如果某个核心设计明显偏离 OpenClaw 或其他成熟方案，必须记录偏离原因、收益、风险和验证方式。
- 第三方调用、多 Agent 协作和协议输出的 API 设计，必须优先保持平台化、通用化和可版本化，而不是只满足 Vibe IM 单一接入方。

工程执行要求：

1. 做设计前先说明采用了哪些成熟模式，以及为什么适合当前阶段。
2. 能用标准协议、标准格式和成熟库解决的问题，不自创新格式或自写复杂实现。
3. 新增核心机制前必须写清楚边界、状态、失败分支、审计字段和验证方法。
4. MVP 优先选择简单稳定方案，只有真实需求证明必要时才引入复杂框架、向量数据库、多 Agent 编排或自定义调度。
5. 后续实现必须保留可替换性，避免把某个模型供应商、某种 Agent 框架或某个业务方绑定进核心。

### 回归、重构与清理纪律

回归测试、联调或线上反馈发现问题时，不允许默认采用“局部补丁”模式修修补补。必须优先判断问题是否来自设计缺陷、边界不清、职责错位、重复实现、状态模型不完整或缺少统一入口。

处理原则：

- 先判断根因，再决定修复方式。
- 优先采用长期正确、可解释、可验证的最优决策，而不是只让当前案例通过。
- 如果问题暴露出抽象、接口、状态机、数据模型或权限边界设计错误，应修正设计，不应叠加条件分支掩盖问题。
- 编码和重构必须有复用思想，相同概念只能有一个主要实现入口。
- 不允许复制校验、复制状态推进、复制模型调用、复制记忆处理、复制 token 统计或复制后台展示逻辑。
- 修复问题时同步识别并删除过时、无用、误导、重复、临时调试或已经失去入口的垃圾代码。
- 如果旧实现与新设计冲突，应明确迁移或删除，不能长期并存造成第二事实源。
- 每次重构后必须补充与风险相匹配的回归验证，验证范围应覆盖统一入口和主要调用路径。

### 决策记录纪律

重大设计、数据库模型、API 契约、Agent 运行状态、记忆策略、上下文压缩策略、协议模式、后台交互和集成方式变更，必须记录决策依据。

决策记录至少包含：

- 目标问题。
- 参考的成熟项目、标准协议或行业最佳实践。
- 备选方案。
- 选择当前方案的原因。
- 放弃其他方案的原因。
- 风险和限制。
- 验证方式。
- 后续可替换路径。

禁止只留下代码或配置而没有设计依据。无法说明参考来源、取舍和验证方式的核心设计，不应进入实现阶段。

### 安全与隐私纪律

模型输入、模型输出、Agent 记忆、上下文、系统提示、开发者提示、API token、租约、调用日志、供应商错误、协议输入输出和后台审计信息都按敏感资产处理。

安全要求：

- 默认最小权限。
- 后台展示敏感信息必须脱敏。
- API token 必须可撤销、可轮换、可限制作用域。
- API key 必须加密存储或通过环境变量引用，不得明文展示。
- 访问记忆、上下文、会话和运行记录必须鉴权。
- 不得把未授权用户数据、其他系统私有数据或无关会话内容注入模型上下文。
- 模型调用、记忆读取、记忆写入、协议运行和后台敏感操作必须可审计。
- 供应商错误原文进入用户界面前必须归一化和脱敏。

### 状态机纪律

Agent run、protocol run、lease、memory、model config、API token、conversation 和 provider call 必须有明确状态、状态转移和失败出口。

禁止：

- 只用 `success` / `failed` 表达复杂运行过程。
- 用临时布尔值替代状态机。
- 依赖自然语言描述判断系统状态。
- 失败后无明确下一步动作。
- 状态变化不写审计事件。

每个状态机至少说明：

- 初始状态。
- 终态。
- 可重试状态。
- 可取消状态。
- 失败状态。
- 超时处理。
- 状态变化触发条件。
- 对应后台展示文案。

### 可观测性纪律

每次模型调用、Agent 运行、协议运行、记忆检索、上下文压缩、租约调用和外部 API 调用，都必须能被追踪和排障。

每次调用至少记录：

```text
request_id
run_id
agent_id
caller
model_provider
model_name
status
latency_ms
input_tokens
output_tokens
total_tokens
context_summary
memory_ids
protocol_name
protocol_version
error_type
audit_event_id
created_at
```

后台必须能基于这些字段定位：

- 谁调用了哪个 Agent。
- 使用了哪个模型。
- 注入了哪些上下文和记忆。
- 消耗了多少 token。
- 卡在哪个状态。
- 失败属于供应商问题、协议问题、权限问题、上下文预算问题还是系统问题。

## 设计目标

- 多模型：支持不同大模型供应商、模型、密钥、调用参数和计费统计。
- 多 Agent：支持创建、查询、管理、租用、组合、调用和禁用 Agent。
- 多 Agent 协作：支持任务拆解、角色分工、运行编排、上下文传递、结果汇总、失败恢复和协作审计。
- 独立记忆：每个 Agent 拥有独立记忆、上下文策略和运行配置。
- 协议对话：同时支持普通自然语言对话和结构化协议对话。
- 外部调用：通过 API 向第三方系统提供 Agent 创建、租用、调用、协作编排、注入上下文和读取结果能力。
- 接入治理：支持 API token、scope、rate limit、callback/webhook、调用审计和错误归一。
- token 治理：支持多种上下文压缩、摘要、裁剪和预算控制策略。
- 可审计：完整保存请求、响应、上下文组成、token 消耗、错误和治理结果。
- 可运营：后台支持模型配置、Agent 配置、会话记录、调用记录、token 消耗和异常排查。
- 业务无关：核心数据结构只表达模型、Agent、记忆、上下文、会话、调用、协议和审计。

## 非目标

Vibe Claw 不负责：

- IM 用户体系、好友、群聊、消息投递和文件权限。
- 具体行业业务表、业务流程、业务审批或业务状态机。
- 直接替代 Vibe IM 的聊天 UI。
- 在核心层硬编码行业 prompt、行业字段或垂直业务规则。
- 让 Agent 自由无限循环、自行扩权或绕过审计调用外部系统。

## 核心模块

### 模型供应商

模型供应商模块负责统一封装不同大模型访问能力。

当前已实现能力：

- 供应商配置：名称、类型、base URL、默认模型、`apiKeyRef`、超时、重试次数、启用状态。
- 供应商类型：`mock` 和 `openai-compatible`；DeepSeek 通过 OpenAI-compatible 协议接入。
- 密钥引用：支持环境变量名、`env:`、`secret://env/`、`vault://`、`kms://` 风格引用；后台展示必须脱敏。
- 模型选择：Agent 可绑定 Provider 和默认模型；Run/消息调用可按配置选择模型。
- 调用适配：普通对话、协议化结构输出、SSE 事件流入口；工具调用字段保留扩展空间。
- 错误归一：认证失败、限流、超时、供应商异常、内容安全拦截、输出不合规。
- 成本统计：输入 token、输出 token、总 token、估算成本、调用耗时。

模型配置必须可由后台管理，不应写死在代码中。API key 等敏感信息只能通过密钥引用方式配置，后台和 API 响应不得明文展示。完整 Provider 熔断、健康探测、按成本/延迟自动路由仍是后续增强。

### Agent 管理

Agent 是 Vibe Claw 的核心可租用智能单元。

当前 Agent 字段：

```text
tenant_id
project_id
id
name
description
status
default_model
provider_id
instruction
created_at
updated_at
```

后续版本字段：

```text
agent_version_id
conversation_mode
memory_policy
context_policy
token_policy
release_channel
rollback_target
```

Agent 状态：

```text
active       可用
disabled     禁用
archived     归档
```

Agent 能力：

- 普通对话：自然语言输入输出。
- 协议对话：要求模型按指定 schema、contract 或 protocol 输出。
- 临时上下文注入：调用时传入一次性上下文，不长期入库。
- 长期记忆注入：明确写入 Agent 记忆库。
- 会话级上下文：在同一个会话内维持短期上下文。
- 调用级预算：每次调用可指定 token、模型和超时上限。
- 租约调用：外部系统可通过 Agent lease 使用临时调用上下文和预算字段。

当前边界：

- Agent 版本表、草稿/发布/灰度/回滚还未形成独立数据模型。
- 当前多 Agent 执行强调确定性顺序与可审计事件，不支持 Agent 自主无限派生或未授权调用外部系统。

### 多 Agent 协作

多 Agent 协作是 Vibe Claw 的最终核心能力之一，但必须以工程化、可审计、可中断、可恢复的方式实现，不能做成不可控的自主循环。

当前实现状态：

- 已支持多个 Agent 独立创建、配置、调用、记忆隔离和会话隔离。
- 已支持异步 Run 队列、Run 事件、取消、失败记录、重试和 webhook 回调。
- 已支持同一会话串行锁，避免同一个 conversation 内并发消息互相覆盖。
- 已支持不同 Agent、不同 conversation、不同 tenant/project 的调用并行进行。
- 尚未实现一个 Run 内的复杂并行 DAG、条件分支、自动 handoff 和人工确认节点。

协作基础概念：

```text
workflow        一次协作流程定义
run             一次协作运行实例
agent_role      Agent 在协作中的角色
handoff         Agent 之间的任务移交
shared_context  协作共享上下文
run_event       协作过程事件
artifact        协作产物
```

协作模式优先级：

1. 单 Agent API 调用闭环。
2. 固定顺序的多 Agent 协作。
3. 带条件分支的多 Agent 协作。
4. 受限工具调用和人工确认节点。
5. 更复杂的动态调度。

多 Agent 协作必须具备：

- 明确入口：第三方调用方通过 API 创建 run，而不是直接操纵内部状态。
- 明确角色：每个 Agent 在 run 中有稳定角色、输入、输出和权限边界。
- 明确状态：每个 run、step、handoff 和 tool call 都有状态机。
- 明确上下文：共享上下文、私有记忆、外部注入内容和临时摘要必须分层。
- 明确停止条件：成功、失败、取消、超时、人工介入和 token 超限都有出口。
- 明确审计：能追踪每个 Agent 做了什么、读了什么、输出了什么、消耗了多少 token。
- 明确第三方契约：API 输入输出、错误码、事件回调和版本兼容必须稳定。

禁止：

- 让 Agent 自行决定无限派生新 Agent。
- 让 Agent 绕过平台 API 直接调用外部系统。
- 把多个 Agent 的记忆混成不可追踪的公共记忆池。
- 只保存最终回答，不保存中间运行事件。
- 为某个接入方硬编码协作流程，导致平台能力不可复用。

### 记忆系统

记忆系统必须参考成熟方案，但先采用简单、可验证、可回滚的实现。

当前已实现：

- Agent 记忆可通过 API 和后台写入、查询和更新状态。
- 记忆带 tenant/project/agent 作用域，避免跨租户或跨 Agent 泄漏。
- 支持 `profile`、`semantic`、`episodic`、`working` 等类型字段。
- 支持 `active`、`archived`、`rejected` 状态。
- 普通对话构建上下文时会读取可用记忆并注入模型上下文。
- 记忆注入和上下文压缩会记录审计信息，便于排障。

当前边界：

- 记忆检索以简单规则为主，尚未接入复杂向量数据库和高阶相关性排序。
- 不自动把全部会话写入长期记忆，长期记忆仍需显式写入或受规则控制。

记忆分层：

```text
profile_memory      Agent 稳定画像、偏好和长期规则
semantic_memory     可检索知识片段
episodic_memory     重要历史事件和对话结论
working_memory      当前会话临时工作记忆
```

记忆写入要求：

- 必须有来源：人工写入、API 写入、对话提取、系统总结。
- 必须有作用域：agent、conversation、tenant 或调用方租约。
- 必须有状态：active、archived、rejected。
- 必须可追踪：创建时间、创建者、来源调用、摘要、原文引用。
- 默认不把所有对话自动写入长期记忆，必须经过规则或人工确认。

记忆读取要求：

- 根据当前任务、Agent、会话和 token 预算检索。
- 记忆注入前必须排序、去重、裁剪和摘要。
- 注入到模型前必须记录本次使用了哪些记忆。

### 上下文管理

上下文管理负责把系统提示、开发者提示、用户输入、历史消息、记忆、外部注入内容和协议要求组合成一次模型调用。

当前已实现：

- 普通消息调用会组合 Agent instruction、历史消息、外部 context、附件文本摘要和 Agent 记忆。
- 支持通过 `compression` 参数选择上下文压缩策略。
- 支持 conversation 级历史续聊，历史消息按时间恢复。
- 支持附件元数据和文本内容作为一次性上下文发送。后台发送成功后清空输入和附件，失败时恢复原输入文本。
- 协议运行会优先保留协议契约、输入 schema、输出 schema 和输出约束。

上下文组成顺序建议：

```text
system_policy
agent_instruction
developer_instruction
protocol_contract
memory_context
conversation_summary
recent_messages
external_context
user_input
output_requirements
```

上下文策略：

- 固定窗口：保留最近 N 条消息。
- 摘要窗口：旧消息压缩为摘要，新消息保留原文。
- 记忆检索：按相关度检索长期记忆。
- 协议优先：协议对话中 schema 和输出约束优先保留。
- 预算优先：超过 token 预算时按策略裁剪，而不是直接失败。

### Token 压缩

Vibe Claw 至少支持以下 token 压缩模式：

```text
none              不压缩
recent_only       只保留最近上下文
rolling_summary   滚动摘要
semantic_recall   语义检索记忆
hybrid            摘要 + 最近消息 + 语义记忆
protocol_minimal  协议模式最小上下文
```

当前已实现策略以确定性裁剪和摘要为主，支持 `none`、`recent_only`、`rolling_summary`、`hybrid`、`protocol_minimal`。`semantic_recall` 作为复杂语义召回增强保留在后续路线中。

压缩结果必须可审计：

- 原始输入长度。
- 压缩后长度。
- 被保留内容。
- 被摘要内容。
- 被丢弃内容类别。
- 压缩策略名称和版本。

### 防失忆与压缩恢复

Vibe Claw 不能依赖单次模型上下文承载长期事实。上下文窗口、滚动摘要和语义检索都只是运行时输入组织方式，不能替代可审计的记忆、会话摘要、协议状态和外部事实源。

防失忆目标：

- 压缩后不丢失用户明确确认的长期偏好、规则和结论。
- 压缩后不丢失当前任务目标、约束、待办和阻塞点。
- 压缩后不丢失协议运行状态、工具调用结果和失败原因。
- 压缩后能说明哪些内容被保留、摘要、检索、裁剪或丢弃。

推荐分层：

```text
durable_memory        长期稳定记忆，保存确认过的规则、偏好和结论
conversation_summary  会话滚动摘要，保存阶段性上下文
task_state            当前任务状态，保存目标、约束、待办、阻塞和验证
recent_messages       最近原文消息，保留语气、细节和未稳定信息
external_facts        外部系统事实源，通过 API 或工具实时读取
```

写入规则：

- 长期记忆必须显式写入，不能把全部对话自动沉淀为长期事实。
- 任务状态应在目标、约束、计划、阻塞、验证结果变化时更新。
- 会话摘要必须保留事实来源、更新时间和摘要策略版本。
- 工具调用结果、协议输出和外部系统返回值需要区分“事实”“推断”和“模型表述”。
- 被用户纠正的旧结论必须归档或标记过期，不能与新结论同时作为有效事实。

恢复规则：

- 每次模型调用前先读取任务状态，再读取相关长期记忆和会话摘要，最后拼接最近消息。
- 当 token 预算不足时，优先保留系统/开发者约束、协议契约、当前任务状态、最近用户指令和可验证事实。
- 摘要不能覆盖权限、状态机、API 契约、数据库事实、用户确认过的硬约束和未解决风险。
- 如果摘要与长期记忆、外部事实源或最新用户指令冲突，必须停止使用冲突内容并触发重新读取或澄清。

审计要求：

- 每次压缩必须记录压缩前后 token、策略名称、策略版本、输入来源和输出摘要。
- 每次恢复上下文必须记录注入了哪些记忆、摘要、任务状态和外部事实。
- 允许后台查看压缩链路，定位失忆来自未写入、未检索、错误摘要、错误裁剪还是事实源冲突。

## 对话模式

### 普通对话

普通对话用于自然语言问答、创作、分析和开放式任务。

当前入口：

```text
POST /v1/agents/:id/messages
POST /v1/agents/:id/messages/stream
```

输入：

```json
{
  "conversationId": "",
  "message": "",
  "context": [],
  "compression": "hybrid",
  "leaseId": ""
}
```

输出：

```json
{
  "message": "",
  "usage": {
    "inputTokens": 0,
    "outputTokens": 0,
    "totalTokens": 0
  }
}
```

写入类请求建议携带 `Idempotency-Key`，避免客户端重试造成重复消息。服务端会保存 conversation、user message、agent message、run、run events、usage 和压缩审计。

### 协议对话

协议对话用于要求模型输出稳定结构的场景，类似 contract-first / protocol-first 调用方式。

协议对话必须包含：

- 协议名称。
- 协议版本。
- 输入 schema。
- 输出 schema。
- 校验规则。
- 失败处理策略。

当前入口：

```text
POST /v1/agents/:id/protocols
GET  /v1/agents/:id/protocols
POST /v1/agents/:id/protocol-runs
```

输入：

```json
{
  "conversationId": "",
  "protocol": "vibe-example/v1",
  "input": {},
  "context": [],
  "options": {}
}
```

输出：

```json
{
  "protocol": "vibe-example/v1",
  "valid": true,
  "result": {},
  "rawText": "",
  "issues": [],
  "usage": {
    "inputTokens": 0,
    "outputTokens": 0,
    "totalTokens": 0
  }
}
```

协议输出不能只依赖自然语言约定。服务端必须做结构化解析和校验，校验失败时返回明确错误或进入修复流程。

## 外部 API

Vibe Claw 已提供面向外部系统的稳定 `/v1` API。后台管理也通过公开 API 工作，避免形成第二套内部入口。

基础 API：

```text
GET    /health
GET    /openapi.json
GET    /admin
GET    /admin/:section
GET    /v1/providers
POST   /v1/providers
GET    /v1/providers/:id
PATCH  /v1/providers/:id
GET    /v1/agents
POST   /v1/agents
GET    /v1/agents/:id
PATCH  /v1/agents/:id
POST   /v1/agents/:id/archive
GET    /v1/agents/:id/conversations
POST   /v1/agents/:id/messages
POST   /v1/agents/:id/messages/stream
POST   /v1/agents/:id/protocols
GET    /v1/agents/:id/protocols
POST   /v1/agents/:id/protocol-runs
GET    /v1/conversations/:id
GET    /v1/conversations/:id/messages
POST   /v1/agents/:id/memories
GET    /v1/agents/:id/memories
PATCH  /v1/memories/:id
POST   /v1/agents/:id/leases
GET    /v1/agents/:id/leases
GET    /v1/runs
POST   /v1/runs
GET    /v1/runs/:id
POST   /v1/runs/:id/cancel
GET    /v1/runs/:id/events
GET    /v1/queue
GET    /v1/metrics
GET    /v1/metrics/prometheus
GET    /v1/version
GET    /v1/developer-docs
GET    /v1/usage
GET    /v1/billing
GET    /v1/tools
GET    /v1/webhook-subscriptions
POST   /v1/webhook-subscriptions
PATCH  /v1/webhook-subscriptions/:id
GET    /v1/webhook-deliveries
POST   /v1/webhook-deliveries/:id/replay
GET    /v1/tokens
POST   /v1/tokens
POST   /v1/tokens/:id/rotate
POST   /v1/tokens/:id/revoke
GET    /v1/audit-events
GET    /v1/admin/storage-config
POST   /v1/admin/storage-config
POST   /v1/admin/restart
POST   /v1/admin/reset-data
```

运维 API 语义：

- `/v1/admin/storage-config` 只写入计划配置到 `.env.local`，不会在运行中迁移数据，也不会把内存数据写入数据库。
- `/v1/admin/restart` 只请求当前进程退出，生产环境必须由 PM2、systemd、Docker、Kubernetes 或 PaaS 进程管理器拉起新进程。
- `/v1/admin/reset-data` 只重置当前正在运行的存储模式：内存模式清空内存集合，PostgreSQL 模式清空业务表并保留 schema/migration 状态。
- 从内存切到 PostgreSQL 后，服务完全使用 PostgreSQL 现有数据；从 PostgreSQL 切到内存后，服务从全新内存数据开始。

租用 Agent 的含义：

- 外部系统获取某个 Agent 的调用权或临时运行上下文。
- 租约可带过期时间、调用次数、token 预算和允许协议范围。
- 租约不等于管理员权限，不能修改 Agent 全局配置，除非明确授权。

API 安全要求：

- 外部 API 必须鉴权。
- API token 必须可撤销、可轮换、可限制作用域、可配置过期时间和 IP allowlist。
- API token 创建和轮换时只返回一次明文 token，后续列表和查询不得返回 token hash 或明文 token。
- API token 使用时必须记录 last used time 和 last used IP。
- 敏感请求和模型输出必须记录审计。
- 不允许未授权读取其他 Agent 的记忆和会话。
- API token 必须绑定 scopes、tenantId 和 projectId。
- 写入接口应支持 `Idempotency-Key`，避免客户端超时重试造成重复副作用。
- 限流、配额和并发超限应返回明确 429 响应。
- 同一 conversation 的消息写入必须串行化，不允许并发覆盖历史。
- Webhook 订阅、投递重放、系统设置、服务重启和数据重置必须受 scope 控制。
- 后台危险操作必须使用自定义确认弹窗，不依赖浏览器系统确认框。

## 后台管理

后台管理界面要求简洁、专业、可排障。

当前后台页面：

- 概览：只在概览页展示系统摘要、统计卡片、系统状态和快捷操作，其他页面不占用概览布局空间。
- 模型配置：供应商、模型、密钥引用、启用状态、默认参数。
- Agent 列表：名称、状态、默认模型、Provider、Instruction 缩略内容、操作按钮。
- Agent 对话：从 Agent 列表进入，显示历史消息、消息时间、附件、输入框和发送按钮，可继续对话。
- Agent 记忆：从 Agent 列表进入，查看、创建和管理对应 Agent 的记忆。
- 调用记录：请求、响应、token、状态、最近调用时间、关联 Agent、会话入口和协议校验结果。
- Token / 租约管理：API token 创建、轮换、撤销、过期、作用域、IP allowlist；Agent 租约创建、过期和预算管理。
- 系统设置：存储模式配置、当前运行存储、计划配置、服务重启、当前存储数据重置。
- 开发者：OpenAPI、开发者文档索引、版本兼容、Webhook 订阅、用量、账单、Prometheus 指标和工具列表。
- 审计：后台敏感操作、模型调用、token 操作、webhook 投递等审计事件。
- 访问令牌：通过菜单入口弹窗配置当前浏览器访问后台 API 的 Bearer token。
- API 响应面板：右下角按需展开，状态持久记忆，复制按钮只在面板打开时显示。
- 表单校验：保存前统一校验必填、URL、日期和数值字段，不符合时高亮具体字段并阻止提交。
- 聊天体验：发送后本地立即追加用户消息和 Agent 思考气泡；SSE 返回后更新当前气泡，不重建整页；聊天滚动不会因为状态刷新回到顶部或弹跳。

对话记录展示要求：

- 以会话流方式展示用户输入、Agent 输出和系统事件。
- 每轮展示模型、token 消耗、耗时和协议校验状态。
- 支持查看本轮注入的上下文、记忆和压缩摘要。
- 错误调用必须能看到失败原因和原始供应商错误摘要。

表格展示要求：

- 所有表格单元格默认不换行。
- 宽度不足时显示缩略内容。
- API key、token、密钥引用等敏感字段必须脱敏。
- 创建和修改操作统一通过按钮入口和弹窗完成。
- Agent 的会话记录和记忆管理不作为孤立全局页面割裂展示，优先从 Agent 行操作进入对应工作页。

## 数据库边界

Vibe Claw 必须使用独立数据库或独立 schema，不与 Vibe IM 的用户、会话、消息和文件表混用。

当前核心表/数据集合：

```text
schema_migrations
model_providers
agents
agent_memories
agent_conversations
agent_messages
agent_protocols
agent_leases
agent_versions
agent_runs
agent_run_steps
run_events
run_artifacts
compression_audits
run_queue_tasks
idempotency_records
conversation_locks
api_tokens
audit_events
usage_counters
webhook_subscriptions
webhook_deliveries
model_configs
agent_run_contexts
```

数据库原则：

- 迁移版本化。
- API key 不明文保存。
- 大型上下文、附件或长文本可拆分存储，但元数据必须入库。
- 运行记录不可随意覆盖，修正应追加事件。
- 删除高风险，优先禁用、归档或软删除。
- tenant/project 作用域字段必须进入核心资源表。
- 队列任务必须支持 claim/lease、锁过期、重试次数、下次执行时间和 dead letter。

当前边界：

- `schema_migrations` 是迁移状态表，数据重置不得清理该表或破坏已应用 migration。
- `model_configs`、`agent_versions`、`agent_run_contexts` 已作为 schema 层预留和部分支撑能力存在，但完整产品化流程仍需后续增强。
- 存储模式切换不做数据迁移：内存模式和 PostgreSQL 模式各自独立，切换后只读取目标存储自己的数据。
- 数据重置只清理当前运行存储中的业务数据，不改变存储模式，不复制另一种存储的数据。

## 可靠性要求

- 每次模型调用必须有 timeout。
- 供应商错误必须归一化。
- 重试必须有次数上限。
- 协议输出必须校验。
- token 超限必须有明确处理策略。
- Agent 调用必须可追踪到模型、上下文、记忆、输入、输出和调用方。
- 后台不能依赖手工改数据库恢复状态。
- 异步 Run 必须可排队、可 claim、可重试、可 dead letter。
- webhook 必须记录投递状态、响应码、响应摘要、失败原因和重放结果。
- 写入接口必须支持幂等，避免网络重试造成重复副作用。
- 同一会话必须通过锁保证消息顺序。
- 对外错误必须有稳定结构，敏感内部错误需要脱敏。
- 对外错误响应必须包含稳定 `code`、`message`、`details`、`requestId` 字段。
- 服务必须暴露基础健康检查、Prometheus 指标、版本信息和开发者文档索引。
- 服务重启和数据重置是管理员危险操作，必须二次确认、记录审计，并清楚提示部署环境对重启能力的依赖。

## 当前交付范围

当前阶段已经完成面向外部 SaaS/API 服务的最小闭环，数据模型、API 命名、状态机和审计字段已经为第三方调用与后续多 Agent 协作预留稳定扩展路径：

1. DeepSeek / OpenAI-compatible / mock Provider 配置。
2. Agent 创建、查询、编辑、归档和 Provider 绑定。
3. 普通对话调用、会话历史、附件上下文和 SSE 事件流入口。
4. 协议注册、协议运行、输入输出 JSON Schema 校验。
5. 会话记录、Run 记录、Run 事件和调用审计。
6. token 使用统计、基础成本估算、限流和配额。
7. Agent 记忆写入、读取、状态更新和上下文注入。
8. 后台模型配置、Agent 管理、Agent 对话、Agent 记忆、调用记录、Token/租约和审计。
9. 外部 API token 鉴权、scope 权限、tenant/project 隔离。
10. 异步 Run 队列、PostgreSQL claim/lease、重试、退避和 dead letter。
11. webhook 投递、签名、日志、失败重试和手动重放。
12. 幂等写入和会话并发锁。
13. OpenAPI、开发者文档索引、版本信息、Node SDK、Python SDK、API 文档、需求文档、验收文档和错误结构归一。
14. API token 创建、撤销、轮换、过期、IP allowlist、last used 记录和脱敏展示。
15. usage counter 持久化聚合、用量查询、基础账单摘要和 Prometheus 指标。
16. Webhook 订阅、事件匹配、签名投递和投递记录管理。
17. 后台系统设置、存储模式配置、服务重启和当前存储数据重置。
18. 工具注册表 `/v1/tools` 和显式工具调用数据结构。
19. 后台聊天输入框成功发送后自动清空、失败恢复原文、滚动锚定和 Agent 思考态。
20. 文档口径已对齐：`README.md`、`docs/需求文档.md`、`docs/ACCEPTANCE.md`、`docs/api.md`、`docs/developer-api.md` 与本文档描述一致。

后续增强：

- 多供应商复杂路由。
- 模型驱动的自动工具调用、工具审批流和工具执行沙箱。
- 多 Agent 自主协作的完整调度器、并行 DAG、条件分支和 handoff。
- 复杂向量数据库检索。
- 多实例全局强限额、分布式并发控制和真实账单扣费。
- 组织/成员/角色级权限模型。
- Agent 版本、灰度发布、回滚和评测质量门禁。
- Provider 熔断、健康探测和成本/延迟自动路由。
- Vault/KMS 真实 SDK 集成和密钥轮换策略。
- 云平台 restart hook、滚动重启和后台操作审计报表。

## 与 Vibe IM 的集成建议

集成时，Vibe IM 不应直接调用底层模型供应商。正确路径：

```text
Vibe IM
-> Vibe Claw API
-> Agent
-> Context / Memory / Protocol
-> Model Provider
```

### 自动接入目标

Vibe IM 需要能够自动接入 Vibe Claw，但自动接入不能破坏两个项目的独立边界。

目标能力：

- Vibe IM 管理员可配置 Vibe Claw API 地址和访问 token。
- Vibe IM 可通过 Vibe Claw 公开 API 同步可用 Agent 列表。
- Vibe IM 可把 Vibe Claw Agent 映射为 IM 中可见的外部智能联系人。
- Vibe IM 用户可与 Agent 发起单聊。
- 单聊消息由 Vibe IM 保存为 IM 聊天记录，由 Vibe Claw 负责 Agent 调用和模型交互。
- Agent 回复完成后，Vibe IM 将结果作为聊天消息展示。
- 接入失败、调用失败、超时和协议校验失败必须通过 Vibe IM 的系统提示或系统消息清晰展示。

自动接入流程建议：

```text
Vibe IM 配置 Vibe Claw endpoint/token
-> Vibe IM 调用 Vibe Claw /v1/agents 获取可用 Agent
-> Vibe IM 建立本地外部联系人映射
-> 用户向 Agent 发起单聊
-> Vibe IM 将用户消息发送到 Vibe Claw /v1/agents/:id/messages 或 /v1/agents/:id/messages/stream
-> Vibe Claw 返回 runId / conversationId，并通过事件流或轮询暴露运行状态
-> Vibe IM 展示 Agent 状态和进度
-> Vibe Claw 完成后返回最终回复
-> Vibe IM 写入 Agent 回复消息
```

### Agent 状态可见性

接入方必须能清晰看到 Agent 当前状态。Vibe Claw 应提供状态事件，Vibe IM 负责把这些事件映射为用户可理解的聊天状态。

推荐状态，当前 SSE 和 Run events 已覆盖其中核心状态，细分 UI 文案可由接入方映射：

```text
idle                空闲
queued              已排队
typing              正在输入
building_context    正在整理上下文
retrieving_memory   正在检索记忆
calling_model       正在和大模型交互
validating_output   正在校验输出
completed           已完成
failed              失败
cancelled           已取消
```

Vibe IM 展示要求：

- `typing` 显示为“正在输入”。
- `building_context` / `retrieving_memory` / `calling_model` / `validating_output` 显示为 Agent 当前处理阶段。
- 长耗时调用必须持续更新状态，不能让用户只看到静止 loading。
- 失败状态必须展示可理解原因，例如“模型超时”“协议输出校验失败”“上下文超出预算”。
- 状态展示属于运行态信息，不应污染历史消息中的发送者身份快照。

### 思考过程展示边界

Vibe IM 可以展示 Agent 的“思考过程”，但这里的“思考过程”指可审计、可解释的结构化运行过程，不是模型内部隐藏推理原文。

允许展示：

- 当前阶段：整理上下文、检索记忆、调用模型、校验输出。
- 简短进度说明：正在读取哪些类别的上下文、采用哪个协议、是否进入校验。
- 可公开的计划摘要、步骤摘要和结果摘要。
- 协议校验问题和修复尝试摘要。
- token 使用、耗时、模型名称等运行元信息。

不允许展示：

- 模型原始隐藏 chain-of-thought。
- 未脱敏的 API key、系统提示、内部开发者提示。
- 未授权的其他用户上下文、记忆或会话内容。
- 供应商返回中不适合终端用户查看的内部错误原文。

推荐事件结构：

```json
{
  "runId": "",
  "agentId": "",
  "conversationId": "",
  "status": "calling_model",
  "title": "正在和大模型交互",
  "summary": "已完成上下文整理，正在请求 DeepSeek 生成回复。",
  "visible": true,
  "createdAt": ""
}
```

Vibe IM 可以：

- 创建或绑定 Agent。
- 将 IM 消息作为外部上下文传给 Vibe Claw。
- 把 Agent 输出作为消息发送到 IM。
- 查询 Agent 调用结果和 token 消耗。
- 展示 Agent 当前状态、运行阶段和可公开的进度摘要。

Vibe IM 不应该：

- 读取或写入 Vibe Claw 内部数据库。
- 绕过 Vibe Claw 直接调用模型。
- 把 IM 会话历史无筛选地永久写入 Agent 长期记忆。
- 在 IM 核心表中硬编码 Agent 运行状态。
- 展示模型隐藏推理原文或未脱敏内部提示。

## 验证口径

实现后至少需要覆盖：

- 模型配置健康检查。
- Agent 普通对话回归。
- Agent 协议对话校验失败和成功回归。
- token 预算和压缩策略回归。
- 记忆写入、读取、归档回归。
- API token 权限回归。
- 后台基础页面构建和关键操作回归。
- tenant/project 隔离回归。
- Idempotency-Key 重试和冲突回归。
- conversation lock 并发回归。
- 异步队列 claim/lease、重试和 dead letter 回归。
- webhook 投递、签名、失败和 replay 回归。
- SSE 对话流回归。
- Vibe IM 通过公开 API 同步 Agent 列表回归。
- Vibe IM 与 Agent 单聊消息闭环回归。
- Agent 状态事件、正在输入和模型交互阶段展示回归。

工作规则：
1. 先扫描需求文档，生成 TODO_CHECKLIST.md。
2. 每个需求拆成可验证任务，标记：
   - 未开始
   - 开发中
   - 已完成
   - 已验证
3. 不允许在所有任务“已验证”前停止。
4. 每完成一个模块，必须：
   - 实现代码
   - 自测
   - 修复报错
   - 更新 TODO_CHECKLIST.md
5. 如果发现需求不清楚，不要停止等待我确认，按最合理方案实现，并在 ASSUMPTIONS.md 记录假设。
6. 如果遇到技术阻塞，不要停止，必须先尝试至少 3 种方案，并记录在 BLOCKERS.md。
7. 最终停止条件只有一个：
   - 所有需求完成
   - 所有测试通过
   - 无 TypeScript / lint / build 错误
   - 生成 FINAL_REPORT.md

交付前必须执行：

npm install
npm run lint
npm run typecheck
npm run build
npm test

如果项目没有这些命令，请先检查 package.json，使用现有等价命令。
如果缺少测试，请为核心逻辑补充最小可用测试。
