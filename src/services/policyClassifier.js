const HIGH_RISK_RULES = Object.freeze([
  ["REFUND", /refund|\u9000\u6b3e|\u9000\u94b1/i],
  ["ORDER", /\border\b|\u8ba2\u5355/i],
  ["PAYMENT", /payment|\u652f\u4ed8|\u4ed8\u6b3e/i],
  ["LOGISTICS", /logistics|shipping\s*status|\u7269\u6d41|\u5feb\u9012\u72b6\u6001/i],
  ["ADDRESS", /address|\u5730\u5740/i],
  ["PHONE", /phone|mobile|\u624b\u673a\u53f7|\u7535\u8bdd\u53f7\u7801/i],
  ["COMPENSATION", /compensation|\u8d54\u507f|\u8865\u507f/i],
  ["PRICE_CHANGE", /price\s*change|change(?:\s+the)?\s+price|\u6539\u4ef7|\u4fee\u6539\u4ef7\u683c/i],
  ["CANCEL", /cancel|\u53d6\u6d88/i],
  ["DELETE", /delete|\u5220\u9664/i],
  ["MODIFY", /modify|change\s*order|\u4fee\u6539|\u53d8\u66f4/i],
  ["CUSTOMER_NAME", /customer\s*name|\u5ba2\u6237\u59d3\u540d|\u4e70\u5bb6\u59d3\u540d|\u6536\u4ef6\u4eba\u59d3\u540d/i]
]);

const UNSAFE_REPLY_RULES = Object.freeze([
  /(?:refund|\u9000\u6b3e|\u9000\u8fd8).{0,20}(?:amount|\u5143|\uFFE5|\u00A5|\d+(?:\.\d{1,2})?)/i,
  /(?:compensation|\u8d54\u507f|\u8865\u507f).{0,20}(?:\u5143|\uFFE5|\u00A5|\d+(?:\.\d{1,2})?|will|\u4f1a|\u5c06)/i,
  /(?:logistics|shipping|\u7269\u6d41|\u5feb\u9012).{0,20}(?:delivered|arrive|\u5df2\u5230|\u5230\u8fbe|\u6b63\u5728|\u9884\u8ba1|\u9001\u8fbe)/i,
  /(?:order\s*status|\u8ba2\u5355\u72b6\u6001|\u8ba2\u5355).{0,20}(?:completed|cancelled|shipped|\u5df2\u5b8c\u6210|\u5df2\u53d6\u6d88|\u5df2\u53d1\u8d27|\u6b63\u5728\u5904\u7406)/i
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

export const HUMAN_HANDOFF_REPLY =
  "\u5f53\u524d\u95ee\u9898\u9700\u8981\u4eba\u5de5\u5ba2\u670d\u534f\u52a9\u5904\u7406";
