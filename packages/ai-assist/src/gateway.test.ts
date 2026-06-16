import { afterEach, describe, expect, it, vi } from "vitest";
import { GatewayProvider } from "./gateway";

const OPENAI_SHAPED = {
  id: "chatcmpl-1",
  model: "openai/gpt-4o-mini",
  choices: [{ message: { role: "assistant", content: "  hello world  " } }],
  usage: { prompt_tokens: 12, completion_tokens: 7 },
};

function mockFetchOk(json: unknown) {
  return vi.fn().mockResolvedValue({
    ok: true,
    status: 200,
    statusText: "OK",
    json: async () => json,
  });
}

describe("GatewayProvider", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("constructs and defaults the display name to 'gateway'", () => {
    const p = new GatewayProvider({
      baseUrl: "https://openrouter.ai/api/v1",
      apiKey: "k",
      model: "m",
    });
    expect(p.name).toBe("gateway");
  });

  it("uses a custom name when provided", () => {
    const p = new GatewayProvider({
      baseUrl: "https://x/api/v1",
      apiKey: "k",
      model: "m",
      name: "openrouter",
    });
    expect(p.name).toBe("openrouter");
  });

  it("posts to /chat/completions with Bearer auth and a correct body", async () => {
    const fetchMock = mockFetchOk(OPENAI_SHAPED);
    vi.stubGlobal("fetch", fetchMock);

    const provider = new GatewayProvider({
      baseUrl: "https://openrouter.ai/api/v1",
      apiKey: "secret-key-123",
      model: "config-default-model",
      headers: { "x-portkey-provider": "openai" },
    });

    const result = await provider.generateText({
      system: "be terse",
      prompt: "say hi",
      model: "options-override-model",
      temperature: 0.4,
      maxOutputTokens: 256,
    });

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const call = fetchMock.mock.calls[0]!;
    const url = call[0];
    const init = call[1];
    expect(url).toBe("https://openrouter.ai/api/v1/chat/completions");
    expect(init.method).toBe("POST");
    expect(init.headers.authorization).toBe("Bearer secret-key-123");
    expect(init.headers["content-type"]).toBe("application/json");
    expect(init.headers["x-portkey-provider"]).toBe("openai");

    const body = JSON.parse(init.body);
    // options.model overrides config default.
    expect(body.model).toBe("options-override-model");
    expect(body.temperature).toBe(0.4);
    expect(body.max_tokens).toBe(256);
    expect(body.messages).toEqual([
      { role: "system", content: "be terse" },
      { role: "user", content: "say hi" },
    ]);

    // Response maps to GenerateResult, text trimmed.
    expect(result.text).toBe("hello world");
    expect(result.model).toBe("openai/gpt-4o-mini");
    expect(result.usage).toEqual({ inputTokens: 12, outputTokens: 7 });
  });

  it("falls back to the config model and omits the system message", async () => {
    const fetchMock = mockFetchOk({
      choices: [{ message: { content: "ok" } }],
    });
    vi.stubGlobal("fetch", fetchMock);

    const provider = new GatewayProvider({
      baseUrl: "https://x/api/v1/",
      apiKey: "k",
      model: "config-default-model",
    });

    const result = await provider.generateText({ prompt: "no system here" });

    const call = fetchMock.mock.calls[0]!;
    const url = call[0];
    const init = call[1];
    // Trailing slash on baseUrl is normalized.
    expect(url).toBe("https://x/api/v1/chat/completions");

    const body = JSON.parse(init.body);
    expect(body.model).toBe("config-default-model");
    expect(body.messages).toEqual([
      { role: "user", content: "no system here" },
    ]);
    expect(body.temperature).toBeUndefined();
    expect(body.max_tokens).toBeUndefined();

    // model falls back to the requested model when absent in the response.
    expect(result.model).toBe("config-default-model");
    // usage omitted when absent.
    expect(result.usage).toBeUndefined();
  });

  it("throws on a non-2xx response with the status and error detail, not the key", async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: false,
      status: 429,
      statusText: "Too Many Requests",
      json: async () => ({ error: { message: "rate limit exceeded" } }),
    });
    vi.stubGlobal("fetch", fetchMock);

    const provider = new GatewayProvider({
      baseUrl: "https://x/api/v1",
      apiKey: "super-secret-key",
      model: "m",
    });

    await expect(provider.generateText({ prompt: "hi" })).rejects.toThrow(
      /429/,
    );
    await expect(provider.generateText({ prompt: "hi" })).rejects.toThrow(
      /rate limit exceeded/,
    );
    await expect(
      provider.generateText({ prompt: "hi" }),
    ).rejects.not.toThrow(/super-secret-key/);
  });
});
