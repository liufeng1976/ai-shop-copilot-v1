import { timingSafeEqual } from "node:crypto";

const DEFAULT_MERCHANTS = Object.freeze([
  Object.freeze({ apiKey: "demo-secret-key", shopId: "demo-shop" })
]);

function secretsEqual(left, right) {
  const leftBuffer = Buffer.from(String(left));
  const rightBuffer = Buffer.from(String(right));
  return (
    leftBuffer.length === rightBuffer.length &&
    timingSafeEqual(leftBuffer, rightBuffer)
  );
}

export class AuthService {
  constructor(merchants = DEFAULT_MERCHANTS) {
    this.merchants = merchants.map(({ apiKey, shopId }) => ({
      apiKey: String(apiKey),
      shopId: String(shopId)
    }));
  }

  authenticate(apiKey) {
    if (!apiKey) return null;
    const merchant = this.merchants.find((candidate) =>
      secretsEqual(candidate.apiKey, apiKey)
    );
    return merchant ? { apiKey: merchant.apiKey, shopId: merchant.shopId } : null;
  }

  middleware() {
    return (request, response, next) => {
      const merchant = this.authenticate(request.get("X-API-Key"));
      if (!merchant) {
        return response.status(401).json({
          error: "Unauthorized",
          code: "AUTH_INVALID_API_KEY"
        });
      }
      request.auth = merchant;
      return next();
    };
  }

  enforceTenant() {
    return (request, response, next) => {
      const claimedShopIds = [
        request.body?.shopId,
        request.query?.shopId
      ].filter((value) => value !== undefined);
      if (claimedShopIds.some((shopId) => String(shopId) !== request.auth.shopId)) {
        return response.status(403).json({
          error: "Forbidden",
          code: "TENANT_MISMATCH"
        });
      }
      return next();
    };
  }
}

export { DEFAULT_MERCHANTS };
