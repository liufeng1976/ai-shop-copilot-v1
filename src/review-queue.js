import { randomUUID } from "node:crypto";
import { containsForbiddenRequestFields, redactSensitiveText } from "./privacy.js";

export class ReviewQueue {
  #items = new Map();

  enqueue({ draftReply, knowledgeRefs = [] }) {
    const item = {
      id: randomUUID(),
      status: "pending",
      draftReply: redactSensitiveText(draftReply),
      knowledgeRefs: knowledgeRefs.map(String),
      createdAt: new Date().toISOString(),
      reviewedAt: null,
      sentAt: null
    };

    if (containsForbiddenRequestFields(item)) {
      throw new Error("Privacy invariant violated while creating review item");
    }

    this.#items.set(item.id, item);
    return structuredClone(item);
  }

  list() {
    return [...this.#items.values()].map((item) => structuredClone(item));
  }

  get(id) {
    const item = this.#items.get(id);
    return item ? structuredClone(item) : null;
  }

  approve(id) {
    const item = this.#items.get(id);
    if (!item) return null;
    if (item.status !== "pending") {
      throw new Error("Only pending reviews can be approved");
    }
    item.status = "approved";
    item.reviewedAt = new Date().toISOString();
    return structuredClone(item);
  }

  markSent(id) {
    const item = this.#items.get(id);
    if (!item) return null;
    if (item.status !== "approved") {
      throw new Error("Only approved reviews can be sent");
    }
    item.status = "sent";
    item.sentAt = new Date().toISOString();
    return structuredClone(item);
  }
}
