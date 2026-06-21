import { PlatformAdapter } from "./platformAdapter.js";

export class TaobaoAdapter extends PlatformAdapter {
  async sendReply() {
    throw new Error("Taobao adapter is a V1 placeholder and is not connected");
  }
}
