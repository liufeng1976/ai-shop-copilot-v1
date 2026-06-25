import { PlatformAdapter } from "./platformAdapter.js";

export class TaobaoAdapter extends PlatformAdapter {
  constructor(options = {}) {
    super({ ...options, platform: "taobao", configured: false });
  }
}
