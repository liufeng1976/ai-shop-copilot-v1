import { createAuthenticatedTenantContext } from "../services/authService.js";

const CLIENT_SHOP_HEADERS = ["x-shop-id", "shop-id", "shopid"];

export function createTenantResolver() {
  return (request, response, next) => {
    const resolvedShopId = request.auth?.shopId;
    const hasClientShopId =
      request.body?.shopId !== undefined ||
      request.query?.shopId !== undefined ||
      CLIENT_SHOP_HEADERS.some((header) => request.headers[header] !== undefined);

    if (!resolvedShopId) {
      return response.status(401).json({
        error: "Unauthorized",
        code: "TENANT_NOT_RESOLVED"
      });
    }
    if (
      hasClientShopId ||
      (request.shopId !== undefined && request.shopId !== resolvedShopId)
    ) {
      return response.status(403).json({
        error: "Forbidden",
        code: "CLIENT_SHOP_ID_FORBIDDEN"
      });
    }

    request.tenantContext = createAuthenticatedTenantContext(request.auth);
    request.shopId = request.tenantContext.shopId;
    request.apiKeyId = request.tenantContext.apiKeyHash;
    request.pipelineTrace.push("tenantResolver");
    return next();
  };
}
