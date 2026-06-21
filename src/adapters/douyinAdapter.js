import { PlatformAdapter } from "./platformAdapter.js";

export class DouyinAdapter extends PlatformAdapter {
  async sendReply() {
    throw new Error("Douyin adapter is a V1 placeholder and is not connected");
  }
}
