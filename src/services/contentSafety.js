const UNSAFE_CONTENT_RULES = Object.freeze([
  ["BUYER_MESSAGE", /buyer\s*message|\u4e70\u5bb6\u6d88\u606f|\u4e70\u5bb6\u7559\u8a00/i],
  ["CHAT_TRANSCRIPT", /chat\s*transcript|\u804a\u5929\u8bb0\u5f55|\u5bf9\u8bdd\u8bb0\u5f55|\u5ba2\u670d\u5bf9\u8bdd/i],
  ["ORDER_ID", /(?:order\s*(?:id|number)|\u8ba2\u5355\u53f7|\u8ba2\u5355\u7f16\u53f7)\s*[:\uFF1A#-]?\s*[a-z0-9-]{4,}/i],
  ["TRACKING_NUMBER", /(?:tracking\s*(?:id|number)|\u7269\u6d41\u5355\u53f7|\u5feb\u9012\u5355\u53f7|\u8fd0\u5355\u53f7)\s*[:\uFF1A#-]?\s*[a-z0-9-]{6,}/i],
  ["PHONE", /(?<!\d)(?:\+?86[-\s]?)?1[3-9]\d{9}(?!\d)|phone\s*[:\uFF1A]?\s*\+?[\d\s().-]{7,}/i],
  ["ADDRESS", /(?:\u6536\u8d27\u5730\u5740|\u5ba2\u6237\u5730\u5740|\u4e70\u5bb6\u5730\u5740|shipping\s*address|customer\s*address)\s*[:\uFF1A]?/i],
  ["PAYMENT", /\bpayment\b|\u652f\u4ed8/i],
  ["CUSTOMER_NAME", /(?:\u5ba2\u6237\u59d3\u540d|\u4e70\u5bb6\u59d3\u540d|\u6536\u4ef6\u4eba\u59d3\u540d|customer\s*name)\s*[:\uFF1A]?/i],
  ["LOGISTICS_STATUS", /\u7269\u6d41\u72b6\u6001|\u5feb\u9012\u72b6\u6001|shipping\s*status|logistics\s*status/i],
  ["REFUND_TRANSACTION", /\u9000\u6b3e\u6d41\u6c34|\u9000\u6b3e\u5355\u53f7|\u9000\u6b3e\u4ea4\u6613|refund\s*(?:transaction|id|status)/i]
]);

export class ContentSafety {
  inspect(content) {
    if (typeof content !== "string" || !content.trim()) {
      return { safe: false, code: "EMPTY_CONTENT" };
    }
    const matched = UNSAFE_CONTENT_RULES.find(([, pattern]) => pattern.test(content));
    return matched
      ? { safe: false, code: matched[0] }
      : { safe: true, code: null };
  }
}

export { UNSAFE_CONTENT_RULES };
