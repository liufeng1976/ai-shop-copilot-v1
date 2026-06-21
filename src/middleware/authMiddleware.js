export function createAuthMiddleware(authService) {
  return (request, response, next) => {
    const merchant = authService.authenticate(request.get("X-API-Key"));
    if (!merchant) {
      return response.status(401).json({
        error: "Unauthorized",
        code: "AUTH_INVALID_API_KEY"
      });
    }

    request.shopId = merchant.shopId;
    request.apiKeyId = merchant.apiKeyId;
    return next();
  };
}

export function rejectShopIdOverride(request, response, next) {
  if (
    request.body?.shopId !== undefined ||
    request.query?.shopId !== undefined
  ) {
    return response.status(403).json({
      error: "Forbidden",
      code: "CLIENT_SHOP_ID_FORBIDDEN"
    });
  }
  return next();
}
