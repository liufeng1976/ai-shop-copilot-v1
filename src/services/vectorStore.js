import { randomUUID } from "node:crypto";

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

  #assertTenant(shopId, resolvedShopId = shopId) {
    if (!shopId || String(shopId) !== String(resolvedShopId)) {
      throw new Error("Cross-shop vector access denied");
    }
  }

  addDocument({ shopId, title, sourceType, content }, resolvedShopId = shopId) {
    this.#assertTenant(shopId, resolvedShopId);
    if (!shopId || !title || !sourceType || !content) {
      throw new TypeError("shopId, title, sourceType and content are required");
    }
    if (FORBIDDEN_SOURCE_TYPES.has(sourceType) || !ALLOWED_SOURCE_TYPES.has(sourceType)) {
      throw new TypeError(`sourceType is not allowed: ${sourceType}`);
    }

    const document = {
      id: randomUUID(),
      shopId: String(shopId),
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

  listDocuments(shopId, resolvedShopId = shopId) {
    this.#assertTenant(shopId, resolvedShopId);
    const partition = this.#shops.get(String(shopId));
    return partition ? [...partition.values()].map(publicDocument) : [];
  }

  deleteDocument(shopId, id, resolvedShopId = shopId) {
    this.#assertTenant(shopId, resolvedShopId);
    const partition = this.#shops.get(String(shopId));
    return partition ? partition.delete(id) : false;
  }

  search(shopId, query, limit = 3, resolvedShopId = shopId) {
    this.#assertTenant(shopId, resolvedShopId);
    const partition = this.#shops.get(String(shopId));
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

export const STATIC_SOURCE_TYPES = Object.freeze([...ALLOWED_SOURCE_TYPES]);
