const INTENTS = Object.freeze({
  PRE_SALE: "PRE_SALE",
  LOGISTICS: "LOGISTICS",
  AFTER_SALE: "AFTER_SALE",
  COMPLAINT_RISK: "COMPLAINT_RISK",
  ORDER_SENSITIVE: "ORDER_SENSITIVE",
  FORBIDDEN_ACTION: "FORBIDDEN_ACTION",
  UNKNOWN: "UNKNOWN"
});

const INTENT_RULES = Object.freeze([
  {
    intent: INTENTS.FORBIDDEN_ACTION,
    riskLevel: "HIGH",
    patterns: [
      /(?:execute|process|do|issue|send|give)\s+(?:a\s+)?refund/i,
      /(?:refund|compensate|compensation).*(?:amount|\d+(?:\.\d{1,2})?|\$|yuan|rmb)/i,
      /(?:change|modify|adjust).*(?:price|order)/i,
      /(?:close|cancel|delete).*(?:order|transaction)/i,
      /(?:promise|guarantee).*(?:refund|compensation|ship|delivery|arrival)/i,
      /(?:执行|直接|马上|立刻)?退款/i,
      /退(?:我|给我)?\s*(?:\d+(?:\.\d{1,2})?\s*)?(?:元|块|￥|¥)/i,
      /(?:改价|改价格|修改价格|调价|便宜点|优惠到)/i,
      /(?:赔偿|补偿|赔付).*(?:\d+(?:\.\d{1,2})?\s*)?(?:元|块|￥|¥)?/i,
      /(?:修改订单|改订单|关闭订单|取消订单|删除订单)/i,
      /(?:承诺|保证).*(?:退款|赔偿|补偿|发货|到货)/i
    ]
  },
  {
    intent: INTENTS.ORDER_SENSITIVE,
    riskLevel: "HIGH",
    patterns: [
      /(?:order|payment|pay|paid|address|phone|mobile|customer|identity).*(?:status|check|change|update|number|info|information)?/i,
      /(?:check|look up|update|change).*(?:order|payment|address|phone|mobile)/i,
      /(?:订单状态|订单进度|订单号|订单编号|查订单|我的订单)/i,
      /(?:支付|付款|付钱|扣款|账单|发票)/i,
      /(?:地址|收货地址|改地址|修改地址)/i,
      /(?:手机号|手机号码|电话|联系方式)/i,
      /(?:身份证|实名|姓名|收件人|客户姓名)/i
    ]
  },
  {
    intent: INTENTS.COMPLAINT_RISK,
    riskLevel: "MEDIUM",
    patterns: [
      /(?:bad review|negative review|complaint|complain|report|platform intervention|angry|upset|terrible|scam|fraud)/i,
      /(?:customer service|support).*(?:bad|rude|terrible|unhelpful)/i,
      /(?:差评|投诉|举报|维权|平台介入|小二介入)/i,
      /(?:生气|气死|太差|垃圾|不满意|失望|欺骗|骗子)/i,
      /(?:态度|客服).*(?:差|不好|恶劣)/i
    ]
  },
  {
    intent: INTENTS.LOGISTICS,
    riskLevel: "MEDIUM",
    patterns: [
      /(?:logistics|shipping|shipment|package|parcel|tracking|tracking number|courier|delivery)/i,
      /(?:when|where).*(?:ship|shipped|arrive|delivered|package|parcel)/i,
      /(?:urge|rush|expedite).*(?:shipment|shipping|delivery|dispatch)/i,
      /(?:物流|快递|运单|单号|配送|派送|签收)/i,
      /(?:催发货|催一下|什么时候发货|多久发货|发货时效|发了吗|还没发)/i,
      /(?:什么时候到|多久到|到哪了|送到哪里|预计到达)/i
    ]
  },
  {
    intent: INTENTS.AFTER_SALE,
    riskLevel: "MEDIUM",
    patterns: [
      /(?:after[-\s]?sale|return|exchange|refund policy|return policy|warranty|defect|damaged|missing item|wrong item)/i,
      /(?:seven|7).*(?:day|days).*(?:return|exchange)/i,
      /(?:退货|换货|退款|售后|退换|退换货)/i,
      /(?:七天无理由|7天无理由|质量问题|坏了|破损|少件|漏发|错发)/i,
      /(?:售后政策|退货政策|换货政策|退款规则)/i
    ]
  },
  {
    intent: INTENTS.PRE_SALE,
    riskLevel: "LOW",
    patterns: [
      /(?:product|item|goods).*(?:spec|size|fit|compatible|model|color|material|recommend)/i,
      /(?:size|spec|specification|compatibility|model).*(?:guide|question|choose|fit|recommend)/i,
      /(?:商品规格|商品尺码|产品规格|产品尺码|规格怎么选|尺码怎么选|怎么选|推荐哪款)/i,
      /(?:商品|产品|宝贝).*(?:咨询|介绍|怎么样|好用吗|适合吗)/i,
      /(?:规格|型号|颜色|材质|成分|参数|功能|适配|兼容)/i,
      /(?:尺码|尺寸|大小|身高|体重|码数|穿多大)/i,
      /(?:有货吗|库存|现货|怎么选|推荐哪款)/i
    ]
  }
]);

export class CommerceIntentClassifier {
  classify(input = "") {
    const message = String(input).normalize("NFKC").trim();
    const matched = INTENT_RULES.find((rule) =>
      rule.patterns.some((pattern) => pattern.test(message))
    );
    const intent = matched?.intent ?? INTENTS.UNKNOWN;
    const riskLevel = matched?.riskLevel ?? "LOW";
    return Object.freeze({
      intent,
      riskLevel,
      allowDraft: intent !== INTENTS.UNKNOWN,
      allowAutoSend: false,
      callsExternalApis: false,
      policy: "CLASSIFICATION_ONLY_REQUIRES_HUMAN_REVIEW"
    });
  }
}

export { INTENTS as COMMERCE_INTENTS };
