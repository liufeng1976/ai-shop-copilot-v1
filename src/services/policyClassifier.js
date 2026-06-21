const HIGH_RISK_RULES = Object.freeze([
  ["REFUND", /refund|退款|退钱/i],
  ["ORDER", /\border\b|订单/i],
  ["PAYMENT", /payment|支付|付款/i],
  ["LOGISTICS", /logistics|shipping status|物流|快递状态/i],
  ["ADDRESS", /address|地址/i],
  ["PHONE", /phone|mobile|手机号|电话号码/i],
  ["COMPENSATION", /compensation|赔偿|补偿/i],
  ["PRICE_CHANGE", /price change|改价|修改价格/i],
  ["CANCEL", /cancel|取消/i],
  ["DELETE", /delete|删除/i],
  ["MODIFY", /modify|change order|修改|变更/i],
  ["CUSTOMER_NAME", /customer name|客户姓名|买家姓名|收件人姓名/i]
]);

const UNSAFE_REPLY_RULES = Object.freeze([
  /(?:refund|退款|退还).{0,20}(?:amount|元|￥|¥|\d+(?:\.\d{1,2})?)/i,
  /(?:compensation|赔偿|补偿).{0,20}(?:元|￥|¥|\d+(?:\.\d{1,2})?|will|会|将)/i,
  /(?:logistics|shipping|物流|快递).{0,20}(?:delivered|arrive|已到|到达|正在|预计|送达)/i,
  /(?:order status|订单状态|订单).{0,20}(?:completed|cancelled|shipped|已完成|已取消|已发货|正在处理)/i
]);

export class PolicyClassifier {
  constructor({ llmClassifier = null, enableLlmClassifier = false } = {}) {
    this.llmClassifier = llmClassifier;
    this.enableLlmClassifier = enableLlmClassifier;
  }

  async classify(message) {
    const matched = HIGH_RISK_RULES.find(([, pattern]) => pattern.test(message));
    if (matched) return { highRisk: true, code: matched[0] };
    if (this.enableLlmClassifier && this.llmClassifier) {
      return this.llmClassifier.classify(message);
    }
    return { highRisk: false, code: null };
  }

  inspectReply(reply) {
    const unsafe = UNSAFE_REPLY_RULES.some((pattern) => pattern.test(reply));
    return {
      safe: !unsafe,
      code: unsafe ? "UNSAFE_REPLY_COMMITMENT" : null
    };
  }
}

export const HUMAN_HANDOFF_REPLY = "需要人工客服协助处理该问题。";
