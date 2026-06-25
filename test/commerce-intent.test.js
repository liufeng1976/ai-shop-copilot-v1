import test from "node:test";
import assert from "node:assert/strict";
import {
  CommerceIntentClassifier,
  COMMERCE_INTENTS
} from "../src/services/commerceIntentClassifier.js";

const classifier = new CommerceIntentClassifier();

test("commerce intent classifier detects pre-sale product questions", () => {
  const result = classifier.classify("这款衣服尺码怎么选，身高165体重100穿多大？");
  assert.equal(result.intent, COMMERCE_INTENTS.PRE_SALE);
  assert.equal(result.riskLevel, "LOW");
});

test("commerce intent classifier detects logistics questions", () => {
  const result = classifier.classify("我的快递到哪了，能帮我催发货吗？");
  assert.equal(result.intent, COMMERCE_INTENTS.LOGISTICS);
  assert.equal(result.riskLevel, "MEDIUM");
});

test("commerce intent classifier detects after-sale questions", () => {
  const result = classifier.classify("商品有质量问题，我想退货或者换货");
  assert.equal(result.intent, COMMERCE_INTENTS.AFTER_SALE);
  assert.equal(result.riskLevel, "MEDIUM");
});

test("commerce intent classifier detects complaint risk", () => {
  const result = classifier.classify("你们客服态度太差了，我要投诉并给差评");
  assert.equal(result.intent, COMMERCE_INTENTS.COMPLAINT_RISK);
  assert.equal(result.riskLevel, "MEDIUM");
});

test("commerce intent classifier detects order-sensitive questions", () => {
  const result = classifier.classify("帮我查一下订单状态，再把收货地址和手机号改一下");
  assert.equal(result.intent, COMMERCE_INTENTS.ORDER_SENSITIVE);
  assert.equal(result.riskLevel, "HIGH");
});

test("commerce intent classifier detects forbidden platform actions", () => {
  const result = classifier.classify("你直接给我退款100元并改价补偿");
  assert.equal(result.intent, COMMERCE_INTENTS.FORBIDDEN_ACTION);
  assert.equal(result.riskLevel, "HIGH");
});

test("commerce intent classifier returns unknown for unclear messages", () => {
  const result = classifier.classify("你好");
  assert.equal(result.intent, COMMERCE_INTENTS.UNKNOWN);
  assert.equal(result.allowDraft, false);
});

test("commerce intent classifier is classification-only and never auto-sends", () => {
  for (const message of [
    "这个商品适合什么规格？",
    "物流怎么还没到？",
    "我要退货",
    "我要投诉",
    "帮我查订单",
    "马上退款并赔偿"
  ]) {
    const result = classifier.classify(message);
    assert.equal(result.allowAutoSend, false);
    assert.equal(result.callsExternalApis, false);
    assert.equal(result.policy, "CLASSIFICATION_ONLY_REQUIRES_HUMAN_REVIEW");
  }
});
