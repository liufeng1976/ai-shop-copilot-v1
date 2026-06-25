# AI Shop Copilot V1

国内电商 AI 客服副驾驶，面向抖音 / 抖店、淘宝 / 天猫客服场景。

当前版本仍是 RC 阶段：不接真实抖店或淘宝开放平台 API，不自动发送真实平台消息，不自动执行退款、退货、换货、补偿、改价、修改订单或关闭订单。系统定位是“AI 先生成客服回复草稿，人工审核后再发送”。

## 当前覆盖场景

- 售前商品咨询
- 商品规格、尺码、适配问题
- 物流查询、催发货、发货时效咨询
- 退款、退货、换货、售后政策咨询
- 差评与投诉前置安抚
- AI 草稿生成 + 人工审核
- 平台首响 SLA 与安全兜底回复

## 当前不做

- 不接真实抖店 / 淘宝 API
- 不做自动发送真实平台消息
- 不做自动铺货、自动选品、广告投放
- 不做 Agent 自治系统
- 不自动查询真实订单、物流、退款或支付数据
- 不承诺退款金额、补偿金额、改价或任何订单结果

## 核心能力

- Node.js 20+ / Express
- DeepSeek Provider；未配置密钥时使用 deterministic mock，保证本地测试可跑
- SQLite 持久化 KB 与 review queue
- API Key → tenant 解析，客户端 `shopId` 全拒绝
- API key 仅以 SHA-256 hash 形式保存和比较
- LocalVectorStore 严格按认证 tenant context 隔离
- Review queue 不保存 `buyerMessage`、raw context、prompt 或 vector context
- Webhook HMAC 签名校验、时间戳窗口校验、nonce 重放防护
- `requestId` / `platformMessageId` 幂等去重
- 错误率、LLM 失败率、人工转接率基础 metrics
- 国内电商意图分类器骨架：仅分类，不自动执行动作

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

## 平台接入状态

- Manual Adapter：可用，用于本地手工网关测试；不会自动发送到真实平台
- Douyin Adapter：抖音 / 抖店接口骨架，等待开放平台权限；当前返回 `PLATFORM_NOT_CONFIGURED`
- Taobao Adapter：淘宝 / 天猫接口骨架，等待开放平台权限；当前返回 `PLATFORM_NOT_CONFIGURED`

当前版本不支持自动发送和真实平台回发。审核通过后可生成 `ReplyCommand`，但真实平台 adapter 不会伪造发送成功。

OAuth 目前只实现 state 防 CSRF、state TTL、平台配置检测和统一错误处理。当前不保存 access token 明文；未来如需保存 token，必须使用 `encryptedToken` 字段并配套 key rotation。

## 国内电商意图分类器

`CommerceIntentClassifier` 已接入 `chatService`，用于为国内电商客服草稿选择安全策略。不调用真实订单、物流、退款或平台接口。

分类结果包含：

```js
{
  intent: "PRE_SALE",
  riskLevel: "LOW",
  allowDraft: true,
  allowAutoSend: false,
  callsExternalApis: false,
  policy: "CLASSIFICATION_ONLY_REQUIRES_HUMAN_REVIEW"
}
```

当前支持：

- `PRE_SALE`：商品咨询、规格、尺码、适配
- `LOGISTICS`：物流查询、催发货、发货时效
- `AFTER_SALE`：退款、退货、换货、售后政策
- `COMPLAINT_RISK`：差评、投诉、情绪安抚
- `ORDER_SENSITIVE`：订单状态、支付、地址、手机号等
- `FORBIDDEN_ACTION`：退款执行、改价、补偿承诺、修改订单、关闭订单
- `UNKNOWN`：无法判断

所有类别第一阶段均 `allowAutoSend = false`。

第二阶段 chat 输出会附带以下前端展示字段：

```js
{
  intent: "LOGISTICS",
  riskLevel: "MEDIUM",
  allowAutoSend: false,
  reviewRequired: true
}
```

各类意图的草稿边界：

- `PRE_SALE`：可生成普通售前草稿，仍进入人工审核
- `LOGISTICS`：只生成安抚和引导，不编造物流状态
- `AFTER_SALE`：只生成政策型草稿，不承诺退款、退货或换货结果
- `COMPLAINT_RISK`：生成安抚型草稿，并提示人工优先处理
- `ORDER_SENSITIVE`：提示订单、支付、地址、手机号等敏感信息需要人工核实
- `FORBIDDEN_ACTION`：不承诺退款金额、补偿金额、改价、修改订单或关闭订单，只生成安全人工核实草稿
- `UNKNOWN`：生成普通兜底草稿

所有草稿均必须进入 `reviewQueue`，由人工审核后再发送。当前阶段不会自动发送任何回复。

## Webhook 签名

平台网关 endpoint：

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
- `platformMessageId` 重复时不重复调用 LLM
- `messageText` 只在当前请求内存中使用，不进入日志、数据库、队列、向量库或幂等存储

## 3 分钟平台响应 SLA

收到平台消息后，系统立即创建一条 SLA 记录，只保存平台元数据：

```text
id, shop_id, platform, platform_message_id, conversation_id,
received_at, deadline_at, warn_at, fallback_at,
first_reply_sent_at, status
```

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

售后 / 订单相关兜底话术：

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
- 平台 SLA 首响与 fallback
- 国内电商意图分类
