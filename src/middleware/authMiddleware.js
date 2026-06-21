export function createAuthMiddleware(authService) {
  return (request, response, next) => {
    const merchant = authService.authenticate(request.get("X-API-Key"));
    if (!merchant) {
      return response.status(401).json({
        error: "Unauthorized",
        code: "AUTH_INVALID_API_KEY"
      });
    }

    request.pipelineTrace = ["authMiddleware"];
    request.auth = merchant;
    return next();
  };
}
