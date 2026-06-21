export class PlatformAdapter {
  async sendReply(_payload) {
    throw new Error("sendReply must be implemented by a platform adapter");
  }
}
