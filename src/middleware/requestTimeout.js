export const REQUEST_TIMEOUT = Symbol("REQUEST_TIMEOUT");

export function createRequestTimeout({ timeoutMs = 10_000 } = {}) {
  return (request, response, next) => {
    const controller = new AbortController();
    let timer;
    request.abortSignal = controller.signal;
    request.timeoutPromise = new Promise((resolve) => {
      timer = setTimeout(() => {
        controller.abort(new Error("Request hard timeout"));
        resolve(REQUEST_TIMEOUT);
      }, timeoutMs);
      timer.unref?.();
    });
    response.once("finish", () => clearTimeout(timer));
    response.once("close", () => clearTimeout(timer));
    return next();
  };
}
