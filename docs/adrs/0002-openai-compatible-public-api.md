# ADR 0002: Expor API OpenAI-compatible como contrato publico inicial

## Status

Accepted

## Contexto

O objetivo e permitir que clientes existentes usem o gateway com baixa friccao. A compatibilidade com OpenAI e amplamente suportada por SDKs, ferramentas e providers como OpenRouter.

## Decisao

O contrato publico inicial sera uma API compativel com OpenAI, com foco no endpoint `/v1/chat/completions` e no endpoint `/v1/models`.

## Consequencias

Positivas:

- adocao simples por clientes existentes;
- troca de `baseURL` e token tende a ser suficiente para muitos casos;
- boa compatibilidade com OpenRouter e outros providers OpenAI-compatible.

Negativas:

- o formato Chat Completions pode nao representar todos os recursos modernos da API Responses;
- algumas capacidades internas de orquestracao precisam ser escondidas ou adaptadas ao envelope OpenAI;
- sera necessario manter compatibilidade de erros, streaming e chunks.

## Specs relacionadas

- [Spec 001](../specs/001-openai-compatible-api.md)
- [Spec 005](../specs/005-streaming-tools-response-normalization.md)

