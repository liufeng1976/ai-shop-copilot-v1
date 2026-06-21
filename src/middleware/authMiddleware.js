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
  const claimedShopIds = [
    request.body?.shopId,
    request.query?.shopId
  ].filter((value) => value !== undefined);

  if (claimedShopIds.some((shopId) => String(shopId) !== request.shopId)) {
    return response.status(403).json({
      error: "Forbidden",
      code: "TENANT_MISMATCH"
    });
  }
  return next();
}
