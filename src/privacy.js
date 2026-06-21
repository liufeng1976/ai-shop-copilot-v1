const REDACTION_RULES = [
  {
    label: "email",
    pattern: /\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b/gi
  },
  {
    label: "phone",
    pattern: /(?<!\d)(?:\+?86[-\s]?)?1[3-9]\d{9}(?!\d)/g
  },
  {
    label: "phone",
    pattern: /(?<!\d)(?:\+?1[-.\s]?)?(?:\(\d{3}\)|\d{3})[-.\s]?\d{3}[-.\s]?\d{4}(?!\d)/g
  },
  {
    label: "order",
    pattern: /\b(?:order|订单|单号)\s*(?:id|号|编号)?\s*[:：#-]?\s*[A-Z0-9-]{5,}\b/gi
  }
];

export function redactSensitiveText(value) {
  if (typeof value !== "string") {
    return "";
  }

  return REDACTION_RULES.reduce(
    (text, { label, pattern }) => text.replace(pattern, `[REDACTED_${label.toUpperCase()}]`),
    value
  );
}

export function containsForbiddenRequestFields(value) {
  if (!value || typeof value !== "object") {
    return false;
  }

  const forbidden = new Set([
    "buyermessage",
    "order",
    "orders",
    "orderdata",
    "customer",
    "customerprofile",
    "customerdata",
    "buyer"
  ]);

  return Object.entries(value).some(([key, nested]) => {
    if (forbidden.has(key.toLowerCase())) {
      return true;
    }
    return containsForbiddenRequestFields(nested);
  });
}
