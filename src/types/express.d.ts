declare namespace Express {
  export interface Request {
    requestId?: string;
    authenticatedClient?: {
      id: string;
      allowedModels: string[];
    };
  }
}
