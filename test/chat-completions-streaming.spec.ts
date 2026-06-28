import { ChatCompletionsService } from "../src/v1/chat-completions.service";

describe("Chat completions streaming", () => {
  it("streams accumulated delta content from the final response stream", async () => {
    const service = new ChatCompletionsService(
      {} as never,
      {
        async run() {
          return {
            content: "",
            finishReason: "stop",
            usage: {
              promptTokens: 0,
              completionTokens: 0,
              totalTokens: 0,
            },
          };
        },
        async *streamFinal() {
          yield {
            content: "hello",
            finishReason: null,
          };
          yield {
            content: " ",
            finishReason: null,
          };
          yield {
            content: "world",
            finishReason: null,
          };
          yield {
            content: "",
            finishReason: "stop",
          };
        },
      } as never,
    );

    const chunks = [];
    for await (const chunk of service.streamRequest({
      requestId: "req-stream-test",
      routeId: "default",
      publicModel: "route/default",
      orchestrator: "orchestrator.default",
      streamFinalOnly: true,
      stream: true,
      request: {
        model: "route/default",
        stream: true,
        messages: [{ role: "user", content: "stream please" }],
      },
    })) {
      chunks.push(chunk);
    }

    const content = chunks
      .map((chunk) => chunk.choices[0]?.delta.content ?? "")
      .join("");
    const finalChunk = chunks.at(-1);

    expect(content).toBe("hello world");
    expect(finalChunk?.choices[0]).toMatchObject({
      delta: {},
      finish_reason: "stop",
    });
  });
});
