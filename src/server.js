import { createApp } from "./app.js";
import { loadConfig } from "./config.js";

const config = loadConfig();
const app = await createApp({ config });

app.listen(config.port, () => {
  console.log(`AI Shop Copilot listening on port ${config.port}`);
});
