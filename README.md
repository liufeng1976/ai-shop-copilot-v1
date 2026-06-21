# AI Shop Copilot V1

面向电商客服的隐私优先 AI 回复助手。系统从私有静态知识库检索店铺规则，调用 DeepSeek 生成回复草稿，再交给人工审核；只有审核通过的草稿才能通过 Mock 平台发送。

## V1 范围

- Node.js + Express 后端
- DeepSeek Chat Completions API
- 私有静态知识库 `LocalVectorStore`
- `POST /api/v1/chat/preview`
- 人工审核队列
- Mock 平台发送
- 隐私不落盘测试

明确不包含自动铺货、自动选品、Agent 系统和广告投放。

## 快速开始

```bash
npm install
copy .env.example .env
npm test
npm start
```

默认 `DEEPSEEK_MODE=mock`，无需密钥即可本地开发。接入真实 DeepSeek 时：

```env
DEEPSEEK_MODE=live
DEEPSEEK_API_KEY=your-key
DEEPSEEK_MODEL=deepseek-v4-flash
```

`REVIEW_API_KEY` 必须配置为足够长的随机密钥；未配置时服务拒绝启动。

## API

### 生成客服回复预览

```http
POST /api/v1/chat/preview
Content-Type: application/json

{
  "buyerMessage": "这个商品可以退货吗？"
}
```

买家消息只在当前请求中用于知识检索和模型调用，不写入知识库、审核队列或日志。请求中的订单和客户资料会被忽略，不进入任何持久化服务。

### 审核与发送

```http
GET  /api/v1/reviews
POST /api/v1/reviews/:id/approve
POST /api/v1/reviews/:id/send
```

上述接口必须携带 `x-review-api-key` 请求头。发送接口只接受已批准的审核项。Mock 发送器返回回执，但不保存发送负载。

## 隐私边界

- `LocalVectorStore` 只加载 `data/knowledge.json` 中的静态商家知识。
- 审核队列只保存脱敏后的 AI 草稿、知识条目 ID 和状态时间。
- 不保存 `buyerMessage`、订单对象或客户资料。
- AI 草稿入队前会脱敏邮箱、电话号码和订单号。
- 错误响应和应用日志不输出请求体。
- 审核、批准和发送接口由独立 API Key 保护。

运行 `npm test` 可验证上述约束。
