import { Injectable } from "@nestjs/common";

import { OpenAiHttpError } from "../errors/openai-http-error";

export interface ChatCompletionLogEvent {
  event: "chat_completion.completed" | "chat_completion.failed";
  requestId: string;
  clientId: string;
  routeId: string;
  publicModel: string;
  orchestrator: string;
  stream: boolean;
  status: "success" | "error";
  latencyMs: number;
  usage?: {
    prompt_tokens: number;
    completion_tokens: number;
    total_tokens: number;
  };
  error?: {
    type: string;
    code: string;
    param: string | null;
    status: number;
  };
}

export interface LlmInvocationLogEvent {
  event: "llm_invocation.completed" | "llm_invocation.failed";
  phase: "orchestrator_planning" | "delegation" | "final_synthesis";
  requestId: string;
  routeId: string;
  publicModel: string;
  internalModel: string;
  provider?: string;
  role: "orchestrator" | "delegate";
  status: "success" | "error";
  latencyMs: number;
  finishReason?: string;
  usage?: {
    prompt_tokens: number;
    completion_tokens: number;
    total_tokens: number;
  };
  error?: {
    type: string;
    code: string;
    param: string | null;
    status: number;
  };
}

export interface RoutingLogEvent {
  event:
    | "routing.execution_graph.validated"
    | "routing.execution_graph.executed";
  requestId: string;
  routeId: string;
  publicModel: string;
  finalTargetType?: "delegate" | "orchestrator_fallback";
  finalTargetModel?: string;
  preFinalTaskCount?: number;
  dependencyCount?: number;
  delegationAttemptCount?: number;
  parallelBatchCount?: number;
  maxParallelTasks?: number;
}

@Injectable()
export class OperationalLoggerService {
  logChatCompletion(event: ChatCompletionLogEvent): void {
    console.log(JSON.stringify(event));
  }

  logLlmInvocation(event: LlmInvocationLogEvent): void {
    console.log(JSON.stringify(event));
  }

  logRouting(event: RoutingLogEvent): void {
    console.log(JSON.stringify(event));
  }

  normalizeError(error: unknown): ChatCompletionLogEvent["error"] {
    if (error instanceof OpenAiHttpError) {
      return {
        type: error.type,
        code: error.code,
        param: error.param,
        status: error.status,
      };
    }

    return {
      type: "server_error",
      code: "internal_error",
      param: null,
      status: 500,
    };
  }
}
