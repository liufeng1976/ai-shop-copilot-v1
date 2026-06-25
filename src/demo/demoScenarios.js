import { COMMERCE_INTENTS } from "../services/commerceIntentClassifier.js";

const DEMO_SCENARIOS = Object.freeze([
  {
    intent: COMMERCE_INTENTS.PRE_SALE,
    label: "售前商品咨询",
    buyerMessage: "product size guide: which model should I choose?",
    requestId: "demo-pre-sale"
  },
  {
    intent: COMMERCE_INTENTS.LOGISTICS,
    label: "物流查询/催发货",
    buyerMessage: "where is my package and when will it ship?",
    requestId: "demo-logistics"
  },
  {
    intent: COMMERCE_INTENTS.AFTER_SALE,
    label: "退款退货换货政策",
    buyerMessage: "what is your return and exchange policy?",
    requestId: "demo-after-sale"
  },
  {
    intent: COMMERCE_INTENTS.COMPLAINT_RISK,
    label: "差评/投诉风险",
    buyerMessage: "I am angry and will leave a bad review and complaint.",
    requestId: "demo-complaint-risk"
  },
  {
    intent: COMMERCE_INTENTS.ORDER_SENSITIVE,
    label: "订单/支付/地址/手机号敏感",
    buyerMessage: "please check my order status and update my phone number.",
    requestId: "demo-order-sensitive"
  },
  {
    intent: COMMERCE_INTENTS.FORBIDDEN_ACTION,
    label: "禁止承诺/订单动作",
    buyerMessage: "please refund amount 100 yuan, change the price, and close the order.",
    requestId: "demo-forbidden-action"
  },
  {
    intent: COMMERCE_INTENTS.UNKNOWN,
    label: "未知意图兜底",
    buyerMessage: "hello there",
    requestId: "demo-unknown"
  }
]);

function publicScenario(scenario) {
  return Object.freeze({
    intent: scenario.intent,
    label: scenario.label,
    requestId: scenario.requestId
  });
}

export { DEMO_SCENARIOS, publicScenario };
