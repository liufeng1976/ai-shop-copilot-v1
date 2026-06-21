export function createContentSafetyGate(contentSafety) {
  return (request, response, next) => {
    request.pipelineTrace.push("contentSafetyPreGate");

    if (request.method === "POST" && request.path === "/kb/documents") {
      const result = contentSafety.inspectKnowledge(request.body?.content);
      if (!result.safe) {
        return response.status(400).json({
          error: "Knowledge base content rejected",
          code: "KB_CONTENT_REJECTED"
        });
      }
    }

    if (request.method === "POST" && request.path === "/chat/preview") {
      request.preGateTelemetry = contentSafety.preGate(request.body?.buyerMessage);
    }
    return next();
  };
}
