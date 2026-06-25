# AI Shop Copilot V1

隐私优先的电商客服 AI 安全底座。当前版本聚焦生产级最小 SaaS 能力：租户鉴权、静态知识库、人工审核、安全降级、持久化、Webhook 防护、幂等和基础监控。

当前仍是 RC 阶段，不接真实抖店 / 淘宝开放平台，不做自动铺货、自动选品、广告投放、Agent 自治系统，也不自动执行订单、退款、补偿或改价。

## 核心能力

- Node.js 20+ / Express
- DeepSeek Provider；未配置密钥时使用 deterministic mock，保证本地测试可跑
- SQLite 持久化 KB 与 review queue，后续可替换为 Postgres repository
- API Key → tenant 解析，客户端 `shopId` 全拒绝
- API key 仅以 SHA-256 hash 形式保存和比较
- LocalVectorStore 严格按认证 tenant context 隔离
- Review queue 不保存 `buyerMessage`、raw context、prompt 或 vector context
- Webhook HMAC 签名校验、时间戳窗口校验、nonce 重放防护
- `requestId` / `platformMessageId` 幂等去重
- 错误率、LLM 失败率、人工转接率基础 metrics
- 全量安全测试覆盖

## 本地启动

```bash
npm install
copy .env.example .env
npm test
npm start
```

默认监听：

```text
http://localhost:3000
```

## 本地 demo 商户

```text
apiKey = demo-secret-key
shopId = demo-shop
review_mode = MANUAL
threshold = 0.9
```

`demo-secret-key` 仅限本地开发。`NODE_ENV=production` 时如果仍使用 demo key，应用会启动失败。

所有 `/api/v1` 请求都需要：

```http
X-API-Key: demo-secret-key
```

客户端不得在 body、query 或 header 中传 `shopId`。租户身份只能来自 `X-API-Key`。

## 环境变量

```env
PORT=3000
SQLITE_PATH=.data/app.sqlite
DEEPSEEK_API_KEY=
DEEPSEEK_BASE_URL=https://api.deepseek.com
DEEPSEEK_MODEL=deepseek-v4-flash
DEEPSEEK_TIMEOUT_MS=5000
CORS_ORIGINS=http://localhost:3000,http://localhost:5173
RATE_LIMIT_PER_MINUTE=60
WEBHOOK_SECRET=local-webhook-secret
```

生产环境不要使用默认 `WEBHOOK_SECRET`，也不要使用 demo API key。API key 应以 hash 形式配置到商户记录中，不在数据库或日志里保存明文。

## curl 示例

添加静态知识：

```bash
curl -X POST http://localhost:3000/api/v1/kb/documents \
  -H "X-API-Key: demo-secret-key" \
  -H "Content-Type: application/json" \
  -d "{\"title\":\"售后政策\",\"sourceType\":\"policy\",\"content\":\"本店支持签收后7天内无理由退货，商品需保持完好。\"}"
```

列出当前店铺知识：

```bash
curl http://localhost:3000/api/v1/kb/documents \
  -H "X-API-Key: demo-secret-key"
```

生成客服回复预览：

```bash
curl -X POST http://localhost:3000/api/v1/chat/preview \
  -H "X-API-Key: demo-secret-key" \
  -H "Content-Type: application/json" \
  -d "{\"requestId\":\"req-001\",\"buyerMessage\":\"你们支持七天无理由退货吗？\"}"
```

查看待审核项：

```bash
curl "http://localhost:3000/api/v1/reviews?status=PENDING" \
  -H "X-API-Key: demo-secret-key"
```

查看基础监控：

```bash
curl http://localhost:3000/api/v1/metrics \
  -H "X-API-Key: demo-secret-key"
```

## Webhook 签名

Webhook demo endpoint：

```text
POST /api/v1/webhooks/mock
```

RC2-A 平台网关 endpoint：

```text
POST /api/v1/webhooks/:platform/messages
```

必须同时携带：

```http
X-API-Key: demo-secret-key
X-Webhook-Timestamp: <unix-ms>
X-Webhook-Nonce: <unique nonce>
X-Webhook-Signature: HMAC_SHA256(secret, "<timestamp>.<rawBody>")
```

安全策略：

- 签名错误返回 `WEBHOOK_BAD_SIGNATURE`
- 时间戳超出窗口返回 `WEBHOOK_TIMESTAMP_EXPIRED`
- nonce 重复返回 `WEBHOOK_REPLAY_DETECTED`
- `platformMessageId` 重复时返回第一次处理结果，不重复执行业务逻辑

平台消息会被标准化为内存中的 `PlatformMessage`：

```text
platform, shopId, platformMessageId, conversationId, receivedAt,
messageText, senderRole, idempotencyKey
```

`messageText` 只在当前请求内存中使用，不进入日志、数据库、队列、向量库或幂等存储。

## 平台接入状态

- Manual Adapter：可用，用于本地手工网关测试；不会自动发送到真实平台
- Douyin Adapter：接口骨架，等待开放平台权限；当前返回 `PLATFORM_NOT_CONFIGURED`
- Taobao Adapter：接口骨架，等待开放平台权限；当前返回 `PLATFORM_NOT_CONFIGURED`
- Amazon Adapter：网关预留骨架；当前返回 `PLATFORM_NOT_CONFIGURED`

当前版本不支持自动发送和真实平台回发。审核通过后可生成 `ReplyCommand`，但真实平台 adapter 不会伪造发送成功。

OAuth 目前只实现 state 防 CSRF、state TTL、平台配置检测和统一错误处理。当前不保存 access token 明文；未来如需保存 token，必须使用 `encryptedToken` 字段并配套 key rotation。

## 3分钟平台响应 SLA

RC2-B 增加首次回复 SLA 监控，用来满足平台“买家消息 3 分钟内响应”的要求。

收到平台消息后，系统立即创建一条 SLA 记录，只保存平台元数据：

```text
id, shop_id, platform, platform_message_id, conversation_id,
received_at, deadline_at, warn_at, fallback_at,
first_reply_sent_at, status
```

不会保存 `buyerMessage`、原始 webhook payload、订单、客户姓名、电话、地址、支付或物流信息。

默认时间线：

- `warn_at = received_at + 90s`
- `fallback_at = received_at + 150s`
- `deadline_at = received_at + 180s`

SLA watcher 默认每 10 秒扫描一次：

- 到 90 秒仍未首响：生成脱敏 escalation event
- 到 150 秒仍未首响：发送固定安全兜底首响
- 到 180 秒仍未首响：标记 `EXPIRED`

普通兜底话术：

```text
您好，您的问题已收到，正在为您核实，请稍等。
```

高风险兜底话术：

```text
您好，您的问题涉及订单/售后信息，需要人工客服核实后为您处理，请稍等。
```

兜底回复不调用 LLM，不读取或保存买家原文。若 fallback 已发出，人工审核通过后仍可发送正式补充回复；SLA 的 `first_reply_sent_at` 保留第一次回复时间，不被人工补充回复覆盖。

## 隐私与安全原则

- `buyerMessage` 只能在当前请求内存中使用
- 不写入数据库、文件、日志、缓存、review queue 或 vector store
- 不保存订单、客户姓名、电话、地址、物流或支付数据
- Audit log 只允许 `request_id`、`shop_id`、`action`、`status`、`latency_ms`、`token_usage`
- Vector KB 只允许静态商家文档：FAQ、售后政策、品牌语气
- 禁止 query history、用户画像、行为 embedding、会话记忆
- 默认 fail-safe：无法确认安全时返回 `NEEDS_HUMAN`

## 高风险策略

以下内容直接进入人工处理，不调用 LLM：

- 退款金额
- 订单状态
- 物流状态
- 赔偿
- 支付
- 改价
- 删除 / 修改订单
- 地址
- 手机号
- 客户姓名

固定回复：

```text
当前问题需要人工客服协助处理
```

DeepSeek 返回非法 JSON、缺字段、低置信度、超时、重试失败或包含承诺性退款 / 赔偿 / 物流 / 订单状态内容时，也会强制降级为人工处理。

## 测试

```bash
npm test
```

当前测试覆盖：

- 鉴权与租户隔离
- KB / review SQLite 持久化
- API key hash 管理
- Webhook 签名、时间戳和重放防护
- requestId / platformMessageId 幂等
- buyerMessage 零持久化
- 高风险问题不调用 LLM
- DeepSeek fallback
- metrics 不暴露用户文本
