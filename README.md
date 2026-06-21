# AI Shop Copilot RC1 Safety Layer

电商客服 AI 的 RC1 production-ready safety layer。本阶段只加固上线阻塞的鉴权、多租户隔离、限流、CORS、审计和模型安全边界，不扩展业务功能。

> 当前是 **RC1 local/demo**，不是生产版本。内存知识库、审核队列、API Key 配置和 Mock 平台发送器均需在正式上线前替换为生产基础设施。

## 当前能力

- Node.js 20 + Express
- DeepSeek Provider；无密钥时使用 deterministic mock
- 按 `shopId` 隔离的私有静态 `LocalVectorStore`
- Chat Preview 与人工审核队列
- `X-API-Key` 全接口鉴权
- API Key 绑定租户，客户端 `shopId` 不作为可信来源
- API Key 仅以固定长度哈希参与比较和限流桶标识
- 按 API Key + 路由的每分钟限流
- CORS 来源白名单
- 高风险规则拦截与模型回复二次安全检查
- Mock 平台发送
- 抖店、淘宝 Adapter 占位接口

RC1 **不支持真实抖店或淘宝 API**，也不包含自动铺货、自动选品、广告投放、Agent 自治系统，以及订单、退款或补偿的自动执行。

## 本地商户

```text
apiKey = demo-secret-key
shopId = demo-shop
review_mode = MANUAL
threshold = 0.9
```

所有 `/api/v1/chat`、`/api/v1/kb`、`/api/v1/reviews` 请求必须携带：

```http
X-API-Key: demo-secret-key
```

Client-provided `shopId` is forbidden in every `/api/v1` body and query. Tenant identity comes only from `X-API-Key`.

## 启动

```bash
npm install
copy .env.example .env
npm test
npm start
```

服务默认监听 `http://localhost:3000`。

## 环境变量

```env
PORT=3000
DEEPSEEK_API_KEY=
DEEPSEEK_BASE_URL=https://api.deepseek.com
DEEPSEEK_MODEL=deepseek-v4-flash
DEEPSEEK_TIMEOUT_MS=5000
CORS_ORIGINS=http://localhost:3000,http://localhost:5173
RATE_LIMIT_PER_MINUTE=60
```

`CORS_ORIGINS` 使用逗号分隔。生产环境不会默认允许 `*`。

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
  -d "{\"buyerMessage\":\"你们支持七天无理由退货吗？\"}"
```

查看待审核项：

```bash
curl "http://localhost:3000/api/v1/reviews?status=PENDING" \
  -H "X-API-Key: demo-secret-key"
```

批准或拒绝：

```bash
curl -X POST http://localhost:3000/api/v1/reviews/REVIEW_ID/approve \
  -H "X-API-Key: demo-secret-key"

curl -X POST http://localhost:3000/api/v1/reviews/REVIEW_ID/reject \
  -H "X-API-Key: demo-secret-key"
```

## 隐私架构

- `buyerMessage` 只在当前请求内存中用于策略分类、静态知识检索和模型调用。
- 不写入数据库、文件、日志、缓存、审核队列或向量库。
- 不保存订单、客户姓名、电话、地址、物流或支付数据。
- 审计日志仅允许：
  `request_id`、`shop_id`、`action`、`status`、`latency_ms`、`token_usage`。
- 审计日志禁止记录 `buyerMessage`、AI 回复和知识库正文。
- 审核队列只保存脱敏后的 AI 草稿、置信度、静态知识引用及审核状态。
- Vector KB 仅允许 `faq`、`policy`、`tone` 静态商家文档。
- 禁止 query history、用户画像、行为 embedding 和会话记忆。

## 安全策略

- 退款金额、订单状态、物流状态、赔偿、支付、改价、删除或修改订单、地址、手机号、客户姓名等请求直接返回：
  `当前问题需要人工客服协助处理`
- 高风险请求不会调用 DeepSeek。
- DeepSeek 请求设置超时，并最多重试 2 次。
- 非法 JSON、字段缺失或置信度越界会安全降级为 `NEEDS_HUMAN`。
- 模型回复若包含退款、赔偿、物流或订单状态承诺，也会强制转人工。
- LLM classifier 仅预留接口，RC1 默认关闭。


## RC1 P1 production safeguards

- `demo-secret-key` is for local development only. If `NODE_ENV=production` and the demo key remains configured, application startup fails immediately.
- Clients must never send `shopId` in request bodies or query strings, even when it matches the API key tenant. Any client-provided `shopId` returns `403 CLIENT_SHOP_ID_FORBIDDEN`.
- Knowledge-base content is scanned before storage. Buyer messages, chat transcripts, order IDs, tracking numbers, phone numbers, addresses, payment data, customer names, logistics status, and refund transactions return `400 KB_CONTENT_REJECTED`.
- Rejected KB content is never echoed in the response or written to audit logs.
- DeepSeek timeout, exhausted retries, invalid JSON, schema failures, and out-of-range confidence all fail safe to human handling.

## RC1.5 enforced safety pipeline

Every protected API request follows one fixed chain:

1. `authMiddleware`
2. `tenantResolver`
3. per-key and per-route rate limiting
4. `contentSafety` pre-gate
5. rule-first `policyClassifier`
6. tenant-bound vector retrieval
7. DeepSeek generation
8. response safety post-check
9. sanitized audit logging

The chat pre-gate can stop a request before policy evaluation, vector retrieval, or
LLM generation. Client-supplied `shopId` is rejected from body, query, and headers.
Vector operations assert that the requested namespace matches the resolved tenant,
and the review queue stores only `id`, `shop_id`, `request_id`, `ai_reply`,
`confidence`, and `status`.

Requests have a 10-second hard deadline. Unexpected failures return the safe
fallback `当前问题需要人工客服协助处理` without exposing internal error details.
