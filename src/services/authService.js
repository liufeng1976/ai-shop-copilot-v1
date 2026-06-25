import { createHash, timingSafeEqual } from "node:crypto";

const DEMO_API_KEY_HASH =
  "5f1f9d2aeeb8dc29dd47db2bfc0390b9ada7ded6707b592e9bba01fa7601761a";
const DEFAULT_MERCHANTS = Object.freeze([
  Object.freeze({ apiKeyHash: DEMO_API_KEY_HASH, shopId: "demo-shop" })
]);
const AUTHENTICATED_TENANT_CONTEXTS = new WeakSet();

function hashSecret(value) {
  return createHash("sha256").update(String(value)).digest();
}

function hashSecretHex(value) {
  return hashSecret(value).toString("hex");
}

function secretsEqual(left, right) {
  return timingSafeEqual(hashSecret(left), hashSecret(right));
}

export class AuthService {
  constructor(
    merchants = DEFAULT_MERCHANTS,
    { nodeEnv = process.env.NODE_ENV } = {}
  ) {
    if (
      nodeEnv === "production" &&
      merchants.some(({ apiKey, apiKeyHash }) => {
        const hash = apiKeyHash ?? hashSecretHex(apiKey);
        return hash === DEMO_API_KEY_HASH;
      })
    ) {
      throw new Error("demo-secret-key is forbidden in production");
    }
    this.merchants = merchants.map(({ apiKey, apiKeyHash, shopId }) => ({
      apiKeyHash: apiKeyHash
        ? Buffer.from(String(apiKeyHash), "hex")
        : hashSecret(apiKey),
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
          apiKeyId: hashSecretHex(apiKey),
          shopId: merchant.shopId
        }
      : null;
  }
}

export function createAuthenticatedTenantContext({ shopId, apiKeyId }) {
  if (!shopId || !apiKeyId) {
    throw new TypeError("Authenticated merchant identity is required");
  }
  const tenantContext = Object.freeze({
    shopId: String(shopId),
    tenantId: String(shopId),
    apiKeyHash: String(apiKeyId),
    resolvedBy: "auth"
  });
  AUTHENTICATED_TENANT_CONTEXTS.add(tenantContext);
  return tenantContext;
}

export function isAuthenticatedTenantContext(value) {
  return (
    value !== null &&
    typeof value === "object" &&
    AUTHENTICATED_TENANT_CONTEXTS.has(value)
  );
}

export { DEFAULT_MERCHANTS, DEMO_API_KEY_HASH, hashSecretHex, secretsEqual };
