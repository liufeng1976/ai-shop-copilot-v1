import { readFile } from "node:fs/promises";

const VECTOR_SIZE = 128;

function tokenize(text) {
  return String(text)
    .toLowerCase()
    .normalize("NFKC")
    .match(/[\p{L}\p{N}]+/gu) ?? [];
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

function cosineSimilarity(left, right) {
  let score = 0;
  for (let index = 0; index < left.length; index += 1) {
    score += left[index] * right[index];
  }
  return score;
}

export class LocalVectorStore {
  #documents = [];

  constructor(documents = []) {
    this.#documents = documents.map((document) => ({
      id: document.id,
      title: document.title,
      content: document.content,
      tags: document.tags ?? [],
      vector: embed(`${document.title} ${document.content} ${(document.tags ?? []).join(" ")}`)
    }));
  }

  static async fromJsonFile(fileUrl) {
    const raw = await readFile(fileUrl, "utf8");
    const documents = JSON.parse(raw);
    return new LocalVectorStore(documents);
  }

  search(query, limit = 3) {
    const queryVector = embed(query);
    return this.#documents
      .map(({ vector, ...document }) => ({
        ...document,
        score: cosineSimilarity(queryVector, vector)
      }))
      .sort((left, right) => right.score - left.score)
      .slice(0, limit);
  }

  get size() {
    return this.#documents.length;
  }
}
