import { createHash, timingSafeEqual } from "node:crypto";

const DEFAULT_MERCHANTS = Object.freeze([
  Object.freeze({ apiKey: "demo-secret-key", shopId: "demo-shop" })
]);

function hashSecret(value) {
  return createHash("sha256").update(String(value)).digest();
}

function secretsEqual(left, right) {
  return timingSafeEqual(hashSecret(left), hashSecret(right));
}

export class AuthService {
  constructor(merchants = DEFAULT_MERCHANTS) {
    this.merchants = merchants.map(({ apiKey, shopId }) => ({
      apiKeyHash: hashSecret(apiKey),
      shopId: String(shopId)
    }));
  }

  authenticate(apiKey) {
    if (!apiKey) return null;
    const merchant = this.merchants.find((candidate) =>
      timingSafeEqual(candidate.apiKeyHash, hashSecret(apiKey))
    );
    return merchant
      ? {
          apiKeyId: hashSecret(apiKey).toString("hex"),
          shopId: merchant.shopId
        }
      : null;
  }
}

export { DEFAULT_MERCHANTS, secretsEqual };
