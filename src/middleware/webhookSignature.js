export function createWebhookSignatureMiddleware(webhookSecurity) {
  return (request, response, next) => {
    const body = request.rawBody ?? JSON.stringify(request.body ?? {});
    const result = webhookSecurity.verify({
      timestamp: request.get("X-Webhook-Timestamp"),
      signature: request.get("X-Webhook-Signature"),
      nonce: request.get("X-Webhook-Nonce"),
      body
    });
    if (!result.ok) {
      return response.status(401).json({
        error: "Webhook rejected",
        code: result.code
      });
    }
    request.webhookVerified = true;
    return next();
  };
}
