const KNOWLEDGE_RULES = Object.freeze([
  ["BUYER_MESSAGE", /buyer\s*message|\u4e70\u5bb6\u6d88\u606f|\u4e70\u5bb6\u7559\u8a00/i],
  ["CHAT_TRANSCRIPT", /chat\s*transcript|\u804a\u5929\u8bb0\u5f55|\u5bf9\u8bdd\u8bb0\u5f55|\u5ba2\u670d\u5bf9\u8bdd/i],
  ["ORDER_ID", /(?:order\s*(?:id|number)|\u8ba2\u5355\u53f7|\u8ba2\u5355\u7f16\u53f7)\s*[:\uFF1A#-]?\s*[a-z0-9-]{4,}/i],
  ["TRACKING_NUMBER", /(?:tracking\s*(?:id|number)|\u7269\u6d41\u5355\u53f7|\u5feb\u9012\u5355\u53f7|\u8fd0\u5355\u53f7)\s*[:\uFF1A#-]?\s*[a-z0-9-]{6,}/i],
  ["PHONE", /(?<!\d)(?:\+?86[-\s]?)?1[3-9]\d{9}(?!\d)|phone\s*[:\uFF1A]?\s*\+?[\d\s().-]{7,}/i],
  ["ADDRESS", /(?:\u6536\u8d27\u5730\u5740|\u5ba2\u6237\u5730\u5740|\u4e70\u5bb6\u5730\u5740|shipping\s*address|customer\s*address)\s*[:\uFF1A]?/i],
  ["PAYMENT", /\bpayment\b|\u652f\u4ed8/i],
  ["CUSTOMER_IDENTITY", /(?:\u5ba2\u6237\u59d3\u540d|\u4e70\u5bb6\u59d3\u540d|\u6536\u4ef6\u4eba\u59d3\u540d|customer\s*name)\s*[:\uFF1A]?/i],
  ["LOGISTICS_STATUS", /\u7269\u6d41\u72b6\u6001|\u5feb\u9012\u72b6\u6001|shipping\s*status|logistics\s*status/i],
  ["REFUND_TRANSACTION", /\u9000\u6b3e\u6d41\u6c34|\u9000\u6b3e\u5355\u53f7|\u9000\u6b3e\u4ea4\u6613|refund\s*(?:transaction|id|status)/i]
]);

const INPUT_RULES = Object.freeze([
  ["REFUND", /\brefund\b|\u9000\u6b3e|\u9000\u94b1/i],
  ["ORDER_STATUS", /\border\s*status\b|\u8ba2\u5355\u72b6\u6001/i],
  ["LOGISTICS_STATUS", /\b(?:logistics|shipping)\s*status\b|\u7269\u6d41\u72b6\u6001|\u5feb\u9012\u72b6\u6001/i],
  ["PAYMENT", /\bpayment\b|\u652f\u4ed8|\u4ed8\u6b3e/i],
  ["COMPENSATION", /\bcompensation\b|\u8d54\u507f|\u8865\u507f/i],
  ["ADDRESS", /\baddress\b|\u5730\u5740/i],
  ["PHONE", /\b(?:phone|mobile)\b|\u624b\u673a\u53f7|\u7535\u8bdd\u53f7/i],
  ["CUSTOMER_IDENTITY", /\bcustomer\s*(?:name|identity)\b|\u5ba2\u6237\u59d3\u540d|\u4e70\u5bb6\u59d3\u540d/i]
]);

const REPLY_RULES = Object.freeze([
  ["REFUND_PROMISE", /(?:refund|\u9000\u6b3e|\u9000\u8fd8).{0,20}(?:amount|\u5143|\uFFE5|\u00A5|\d+(?:\.\d{1,2})?)/i],
  ["ORDER_STATUS", /(?:order\s*status|\u8ba2\u5355\u72b6\u6001|\u8ba2\u5355).{0,20}(?:completed|cancelled|shipped|\u5df2\u5b8c\u6210|\u5df2\u53d6\u6d88|\u5df2\u53d1\u8d27|\u6b63\u5728\u5904\u7406)/i],
  ["LOGISTICS_STATUS", /(?:logistics|shipping|\u7269\u6d41|\u5feb\u9012).{0,20}(?:delivered|arrive|\u5df2\u5230|\u5230\u8fbe|\u6b63\u5728|\u9884\u8ba1|\u9001\u8fbe)/i],
  ["COMPENSATION_PROMISE", /(?:compensation|\u8d54\u507f|\u8865\u507f).{0,20}(?:will|\u4f1a|\u5c06|\u5143|\uFFE5|\u00A5|\d+(?:\.\d{1,2})?)/i]
]);

const REVIEW_SENSITIVE_RULES = Object.freeze([
  ["ORDER_ID", /(?:order\s*(?:id|number)|\u8ba2\u5355\u53f7|\u8ba2\u5355\u7f16\u53f7)\s*[:\uFF1A#-]?\s*[a-z0-9-]{4,}/i],
  ["TRACKING_NUMBER", /(?:tracking\s*(?:id|number)|\u7269\u6d41\u5355\u53f7|\u5feb\u9012\u5355\u53f7|\u8fd0\u5355\u53f7)\s*[:\uFF1A#-]?\s*[a-z0-9-]{6,}/i],
  ["PHONE", /(?<!\d)(?:\+?86[-\s]?)?1[3-9]\d{9}(?!\d)|phone\s*[:\uFF1A]?\s*\+?[\d\s().-]{7,}/i],
  ["ADDRESS", /(?:\u6536\u8d27\u5730\u5740|\u5ba2\u6237\u5730\u5740|\u4e70\u5bb6\u5730\u5740|shipping\s*address|customer\s*address)\s*[:\uFF1A]?/i],
  ["PAYMENT", /\bpayment\b|\u652f\u4ed8\u6d41\u6c34|\u652f\u4ed8\u5355\u53f7/i],
  ["CUSTOMER_IDENTITY", /(?:\u5ba2\u6237\u59d3\u540d|\u4e70\u5bb6\u59d3\u540d|\u6536\u4ef6\u4eba\u59d3\u540d|customer\s*name)\s*[:\uFF1A]?/i],
  ["LOGISTICS_STATUS", /\u7269\u6d41\u72b6\u6001|\u5feb\u9012\u72b6\u6001|shipping\s*status|logistics\s*status/i]
]);
const REVIEW_SAFE_RESULTS = new WeakSet();

export const REVIEW_REWRITE_REQUIRED =
  "\u8be5\u56de\u590d\u9700\u8981\u4eba\u5de5\u5ba2\u670d\u91cd\u65b0\u7f16\u8f91\u3002";

function evaluate(value, rules, emptyIsUnsafe = false) {
  if (typeof value !== "string" || !value.trim()) {
    return {
      safe: !emptyIsUnsafe,
      code: emptyIsUnsafe ? "EMPTY_CONTENT" : null
    };
  }
  const matched = rules.find(([, pattern]) => pattern.test(value));
  return matched
    ? { safe: false, code: matched[0] }
    : { safe: true, code: null };
}

function normalizeForEcho(value) {
  return String(value)
    .normalize("NFKC")
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, "");
}

function containsUserEcho(reply, buyerMessage) {
  const normalizedReply = normalizeForEcho(reply);
  const normalizedMessage = normalizeForEcho(buyerMessage);
  if (normalizedMessage.length < 6) return false;
  if (normalizedReply.includes(normalizedMessage)) return true;

  const fragmentLength = Math.min(24, Math.max(8, Math.floor(normalizedMessage.length * 0.6)));
  for (
    let index = 0;
    index + fragmentLength <= normalizedMessage.length;
    index += Math.max(1, Math.floor(fragmentLength / 2))
  ) {
    if (
      normalizedReply.includes(
        normalizedMessage.slice(index, index + fragmentLength)
      )
    ) {
      return true;
    }
  }
  return false;
}

export class ContentSafety {
  inspect(content) {
    return this.inspectKnowledge(content);
  }

  inspectKnowledge(content) {
    return evaluate(content, KNOWLEDGE_RULES, true);
  }

  scanInput(message) {
    return evaluate(message, INPUT_RULES);
  }

  preGate(message) {
    return this.scanInput(message);
  }

  scanReply(reply) {
    return evaluate(reply, REPLY_RULES);
  }

  scanReplyForUserEcho(reply, buyerMessage) {
    if (containsUserEcho(reply, buyerMessage)) {
      return { safe: false, code: "USER_MESSAGE_ECHO" };
    }
    return evaluate(reply, REVIEW_SENSITIVE_RULES);
  }

  sanitizeReviewReply(reply, buyerMessage) {
    const result = this.scanReplyForUserEcho(reply, buyerMessage);
    const reviewSafeResult = Object.freeze(result.safe
      ? { ...result, reply }
      : { ...result, reply: REVIEW_REWRITE_REQUIRED });
    REVIEW_SAFE_RESULTS.add(reviewSafeResult);
    return reviewSafeResult;
  }
}

export function isReviewSafeResult(value) {
  return (
    value !== null &&
    typeof value === "object" &&
    REVIEW_SAFE_RESULTS.has(value)
  );
}

export {
  INPUT_RULES,
  KNOWLEDGE_RULES,
  REPLY_RULES,
  REVIEW_SENSITIVE_RULES
};
