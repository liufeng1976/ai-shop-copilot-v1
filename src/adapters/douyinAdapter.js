import { PlatformAdapter } from "./platformAdapter.js";

export class DouyinAdapter extends PlatformAdapter {
  constructor(options = {}) {
    super({ ...options, platform: "douyin", configured: false });
  }
}
