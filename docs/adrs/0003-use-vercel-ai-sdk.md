# ADR 0003: Usar Vercel AI SDK para chamadas de LLM e tools

## Status

Accepted

## Contexto

O gateway precisa chamar diferentes LLMs, suportar streaming, tool calling e providers variados. Implementar cada protocolo diretamente aumentaria o custo de manutencao.

## Decisao

Usaremos Vercel AI SDK como camada principal de chamada a LLMs, streaming e tool calling.

## Consequencias

Positivas:

- reduz codigo especifico por provider;
- oferece primitives comuns para geracao de texto, streaming e tools;
- integra bem com TypeScript;
- facilita suporte futuro a providers adicionais.

Negativas:

- o gateway fica dependente das abstracoes e ciclos de versao do SDK;
- alguns recursos especificos de provider podem exigir `providerOptions`;
- sera necessario isolar o SDK atras de servicos/adapters internos para preservar flexibilidade.

## Specs relacionadas

- [Spec 002](../specs/002-llm-orchestration-routing.md)
- [Spec 004](../specs/004-provider-adapters-openrouter.md)
- [Spec 005](../specs/005-streaming-tools-response-normalization.md)
- [Spec 007](../specs/007-orchestrator-capability-matching.md)
