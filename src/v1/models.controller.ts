import { Controller, Get, Req } from "@nestjs/common";
import { Request } from "express";

import { OpenAiHttpError } from "../errors/openai-http-error";
import { ModelsService } from "./models.service";
import { ModelsResponse } from "./openai-types";

@Controller("v1/models")
export class ModelsController {
  constructor(private readonly models: ModelsService) {}

  @Get()
  list(@Req() request: Request): ModelsResponse {
    const client = request.authenticatedClient;
    if (!client) {
      throw OpenAiHttpError.authentication();
    }

    return this.models.list(client);
  }
}
