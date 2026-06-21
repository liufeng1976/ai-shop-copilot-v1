# AI Shop Copilot V1

隐私优先的电商客服 AI 后端：使用每店铺隔离的私有静态知识库生成客服回复草稿，再按店铺审核模式决定直接待发送、进入人工审核或转人工处理。

## V1 范围

- Node.js 20 + Express
- DeepSeek Provider，默认 `deepseek-v4-flash`
- 无 API Key 时使用 deterministic mock LLM
- `LocalVectorStore` 静态知识库，按 `shopId` 物理分区
- Chat Preview API
- 人工审核队列
- Mock 平台发送
- 抖店、淘宝 Adapter 占位接口

不包含自动铺货、自动选品、广告投放、Agent 自治系统，以及订单、退款、补偿的自动执行。

## 隐私架构

- `buyerMessage` 只作为当前请求的局部变量传递给检索和模型调用。
- 不写入数据库、文件、日志、缓存、审核队列或向量库。
- 不接收或保存订单、姓名、电话、地址、物流及支付数据。
- 审计记录严格限定为：
  `request_id`、`shop_id`、`action`、`status`、`latency_ms`、`token_usage`。
- 审核队列只保存 AI 草稿、置信度、静态知识引用和审核状态。
- AI 草稿入队前会再次脱敏邮箱、电话号码和订单号，防止模型复述敏感信息。
- 知识库只允许 `faq`、`policy`、`product`、`script`、`tone_guide`。
- 禁止 query history、用户画像、行为 embedding 和会话记忆。

当前 V1 使用内存存储；重启服务后知识库、审核队列和审计记录会清空。

## 启动

```bash
npm install
copy .env.example .env
npm test
npm start
```

环境变量：

```env
DEEPSEEK_API_KEY=
DEEPSEEK_MODEL=deepseek-v4-flash
PORT=3000
```

`DEEPSEEK_API_KEY` 留空时自动使用 deterministic mock，方便本地演示和测试。

## Review mode

内置 `demo-shop`：

```text
review_mode = MANUAL
threshold = 0.9
```

- `AUTO`：非高风险且模型无需人工时返回 `SEND_READY`
- `MANUAL`：始终进入 `PENDING_REVIEW`
- `HYBRID`：`confidence >= threshold` 返回 `SEND_READY`，否则进入审核

退款金额、订单状态、物流状态、赔偿、支付、改价、删除订单及修改订单等高风险请求直接返回 `NEEDS_HUMAN`。

## API 示例

添加静态知识：

```bash
curl -X POST http://localhost:3000/api/v1/kb/documents \
  -H "Content-Type: application/json" \
  -d "{\"shopId\":\"demo-shop\",\"title\":\"售后政策\",\"sourceType\":\"policy\",\"content\":\"本店支持签收后7天内无理由退货，商品需保持完好。\"}"
```

列出知识：

```bash
curl "http://localhost:3000/api/v1/kb/documents?shopId=demo-shop"
```

生成回复预览：

```bash
curl -X POST http://localhost:3000/api/v1/chat/preview \
  -H "Content-Type: application/json" \
  -d "{\"shopId\":\"demo-shop\",\"buyerMessage\":\"你们支持七天无理由退货吗？\"}"
```

查看待审核项：

```bash
curl "http://localhost:3000/api/v1/reviews?shopId=demo-shop&status=PENDING"
```

批准或拒绝：

```bash
curl -X POST http://localhost:3000/api/v1/reviews/REVIEW_ID/approve
curl -X POST http://localhost:3000/api/v1/reviews/REVIEW_ID/reject
```

## DeepSeek 安全策略

Provider 使用 JSON mode，并要求模型只能依据 `STATIC KNOWLEDGE CONTEXT (NON-USER DATA)` 回答。非法 JSON、接口错误或 schema 不匹配都会安全降级为 `NEEDS_HUMAN`。模型被明确禁止编造库存、价格、物流、订单、退款或支付状态，也不得承诺退款金额、补偿或改价。
