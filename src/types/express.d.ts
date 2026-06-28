import type { AuthenticatedClient } from "../auth/authenticated-client";

declare global {
  namespace Express {
    export interface Request {
      requestId?: string;
      startedAt?: number;
      authenticatedClient?: AuthenticatedClient;
    }
  }
}

export {};
