export interface OpenAiErrorBody {
  error: {
    message: string;
    type: string;
    param: string | null;
    code: string;
  };
}

export interface OpenAiErrorDetails {
  status: number;
  message: string;
  type: string;
  param?: string | null;
  code: string;
}
