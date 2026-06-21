import { randomUUID } from "node:crypto";
import { isAuthenticatedTenantContext } from "./authService.js";

const VECTOR_SIZE = 256;
const ALLOWED_SOURCE_TYPES = new Set(["faq", "policy", "tone"]);
const FORBIDDEN_SOURCE_TYPES = new Set([
  "buyer_message",
  "order",
  "customer",
  "payment",
  "logistics",
  "product",
  "script",
  "tone_guide"
]);

function tokenize(text) {
  const normalized = String(text).toLowerCase().normalize("NFKC");
  const words = normalized.match(/[a-z0-9]+/g) ?? [];
  const chinese = [...normalized.replace(/[^\p{Script=Han}]/gu, "")];
  const bigrams = chinese
    .slice(0, -1)
    .map((character, index) => `${character}${chinese[index + 1]}`);
  return [...words, ...chinese, ...bigrams];
}

function hashToken(token) {
  let hash = 2166136261;
  for (const character of token) {
    hash ^= character.codePointAt(0);
    hash = Math.imul(hash, 16777619);
  }
  return Math.abs(hash);
}

function embed(text) {
  const vector = new Float64Array(VECTOR_SIZE);
  for (const token of tokenize(text)) {
    vector[hashToken(token) % VECTOR_SIZE] += 1;
  }
  const magnitude = Math.sqrt(vector.reduce((sum, value) => sum + value ** 2, 0));
  if (magnitude > 0) {
    for (let index = 0; index < vector.length; index += 1) {
      vector[index] /= magnitude;
    }
  }
  return vector;
}

function similarity(left, right) {
  let score = 0;
  for (let index = 0; index < left.length; index += 1) {
    score += left[index] * right[index];
  }
  return score;
}

function publicDocument(document) {
  const { vector: _vector, ...safeDocument } = document;
  return structuredClone(safeDocument);
}

export class LocalVectorStore {
  #shops = new Map();

  #assertTenant(tenantContext, expectedShopId) {
    if (
      !tenantContext ||
      typeof tenantContext !== "object" ||
      !isAuthenticatedTenantContext(tenantContext) ||
      tenantContext.resolvedBy !== "auth" ||
      !tenantContext.apiKeyHash ||
      !tenantContext.tenantId ||
      !tenantContext.shopId ||
      (expectedShopId !== undefined &&
        String(tenantContext.shopId) !== String(expectedShopId))
    ) {
      throw new ForbiddenTenantAccessError();
    }
    return String(tenantContext.shopId);
  }

  addDocument(tenantContext, { title, sourceType, content, shopId } = {}) {
    const tenantShopId = this.#assertTenant(tenantContext, shopId);
    if (!title || !sourceType || !content) {
      throw new TypeError("title, sourceType and content are required");
    }
    if (FORBIDDEN_SOURCE_TYPES.has(sourceType) || !ALLOWED_SOURCE_TYPES.has(sourceType)) {
      throw new TypeError(`sourceType is not allowed: ${sourceType}`);
    }

    const document = {
      id: randomUUID(),
      shopId: tenantShopId,
      title: String(title),
      sourceType,
      content: String(content),
      createdAt: new Date().toISOString(),
      vector: embed(`${title}\n${content}`)
    };
    const partition = this.#shops.get(document.shopId) ?? new Map();
    partition.set(document.id, document);
    this.#shops.set(document.shopId, partition);
    return publicDocument(document);
  }

  listDocuments(tenantContext, shopId) {
    const tenantShopId = this.#assertTenant(tenantContext, shopId);
    const partition = this.#shops.get(tenantShopId);
    return partition ? [...partition.values()].map(publicDocument) : [];
  }

  deleteDocument(tenantContext, id, shopId) {
    const tenantShopId = this.#assertTenant(tenantContext, shopId);
    const partition = this.#shops.get(tenantShopId);
    return partition ? partition.delete(id) : false;
  }

  search(tenantContext, query, limit = 3, shopId) {
    const tenantShopId = this.#assertTenant(tenantContext, shopId);
    const partition = this.#shops.get(tenantShopId);
    if (!partition) return [];
    const queryVector = embed(query);
    return [...partition.values()]
      .map((document) => ({
        ...publicDocument(document),
        score: similarity(queryVector, document.vector)
      }))
      .filter((document) => document.score > 0)
      .sort((left, right) => right.score - left.score)
      .slice(0, limit);
  }
}

export class ForbiddenTenantAccessError extends Error {
  constructor() {
    super("Forbidden tenant access");
    this.name = "ForbiddenTenantAccessError";
    this.code = "FORBIDDEN_TENANT_ACCESS";
  }
}

export const STATIC_SOURCE_TYPES = Object.freeze([...ALLOWED_SOURCE_TYPES]);
