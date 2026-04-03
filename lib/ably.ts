const Ably = require("ably");

const globalForAbly = globalThis as unknown as {
  ablyRest: any;
};

function createAblyRest() {
  const apiKey = process.env.ABLY_API_KEY;

  if (!apiKey) {
    throw new Error("缺少 ABLY_API_KEY");
  }

  return new Ably.Rest({
    key: apiKey,
    queryTime: true,
  });
}

export const ablyRest = globalForAbly.ablyRest ?? createAblyRest();

if (process.env.NODE_ENV !== "production") {
  globalForAbly.ablyRest = ablyRest;
}

export async function publishRealtimeRefresh(data?: Record<string, unknown>) {
  await ablyRest.channels.get("line-chat-workbench").publish("refresh", {
    at: Date.now(),
    ...(data || {}),
  });
}