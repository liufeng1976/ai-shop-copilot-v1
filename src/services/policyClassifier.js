const HIGH_RISK_RULES = Object.freeze([
  ["REFUND_AMOUNT", /退款金额|退多少钱|退款多少|refund amount/i],
  ["ORDER_STATUS", /订单状态|订单到哪|order status/i],
  ["LOGISTICS_STATUS", /物流状态|物流到哪|快递到哪|logistics status/i],
  ["COMPENSATION", /赔偿|补偿|compensation/i],
  ["PAYMENT", /支付|付款|payment/i],
  ["PRICE_CHANGE", /改价|修改价格|price change/i],
  ["DELETE_ORDER", /删除订单|取消订单|delete order/i],
  ["MODIFY_ORDER", /修改订单|变更订单|modify order/i],
  ["ADDRESS", /地址|收货地址|address/i],
  ["PHONE", /手机号|手机号码|电话号码|phone number/i],
  ["CUSTOMER_NAME", /客户姓名|买家姓名|收件人姓名|customer name/i]
]);

const UNSAFE_REPLY_RULES = Object.freeze([
  /(?:退款|退还).{0,12}(?:元|￥|¥|\d+(?:\.\d{1,2})?)/i,
  /(?:赔偿|补偿).{0,16}(?:元|￥|¥|\d+(?:\.\d{1,2})?|已经|会|将)/i,
  /(?:物流|快递).{0,16}(?:已到|到达|正在|将在|预计|送达)/i,
  /订单.{0,16}(?:已完成|已取消|已发货|正在处理|将在|预计)/i
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
