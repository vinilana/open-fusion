# PRD: Open Fusion LLM Gateway

## 1. Visao geral

Open Fusion sera um gateway de LLMs exposto como uma API compativel com OpenAI. A aplicacao recebe chamadas de clientes que ja falam o protocolo OpenAI, autentica e normaliza a requisicao, encaminha a conversa para uma LLM configurada como orquestradora e permite que essa orquestradora direcione a execucao para outras LLMs conforme politicas declaradas em um arquivo JSON unico de configuracao.

O backend sera construido em NestJS. A integracao com modelos, tool calling, streaming e abstracoes de provider sera feita por meio do Vercel AI SDK. O primeiro provider oficialmente suportado sera OpenRouter, mas a arquitetura deve permitir novos providers sem alterar a superficie publica da API.

## 2. Objetivos

- Expor uma API inicial compativel com OpenAI para uso por SDKs e clientes existentes.
- Centralizar configuracoes de providers, modelos, orquestrador, rotas, politicas, limites e credenciais em um unico arquivo JSON.
- Usar uma LLM orquestradora para decidir quando responder diretamente ou delegar para outros modelos configurados.
- Dar suporte oficial inicial ao OpenRouter.
- Isolar providers atras de adapters para permitir suporte futuro a OpenAI, Anthropic, Google, Azure OpenAI, AWS Bedrock, provedores locais ou outros gateways.
- Preservar observabilidade minima para depuracao, auditoria e controle de custo.

## 3. Nao objetivos iniciais

- Interface web administrativa.
- Persistencia em banco de dados.
- Configuracao distribuida ou multi-tenant avancada.
- Fine tuning, treinamento ou hosting proprio de modelos.
- Compatibilidade completa com toda a API OpenAI no primeiro release.
- Marketplace de tools externas.

## 4. Publico alvo

- Equipes que ja usam clientes compativeis com OpenAI e querem trocar o endpoint por um gateway proprio.
- Desenvolvedores que precisam rotear chamadas entre modelos por custo, capacidade, latencia ou qualidade.
- Produtos que desejam introduzir orquestracao por LLM sem acoplar o cliente final a multiplos providers.

## 5. Escopo MVP

O MVP deve entregar:

- Endpoint `POST /v1/chat/completions` com suporte a respostas normais e streaming SSE.
- Endpoint `GET /v1/models` retornando modelos expostos pelo gateway.
- Autenticacao por `Authorization: Bearer <token>` para clientes do gateway.
- Leitura de um arquivo JSON de configuracao no boot.
- Validacao de schema da configuracao.
- Provider adapter oficial para OpenRouter via Vercel AI SDK.
- Orquestrador configuravel por JSON.
- Tool interna de delegacao para modelos candidatos.
- Resposta em formato compativel com Chat Completions.
- Logs estruturados com request id, provider, modelo, latencia, status e uso de tokens quando disponivel.

## 6. Fluxo principal

1. Cliente chama `POST /v1/chat/completions` usando formato OpenAI.
2. Gateway autentica o token do cliente.
3. Gateway valida e normaliza a requisicao.
4. Gateway seleciona a configuracao de rota aplicavel.
5. Gateway chama o modelo orquestrador definido na rota ou na configuracao global.
6. O orquestrador pode responder diretamente ou chamar uma tool interna para delegar uma subtarefa a outro modelo.
7. O gateway executa a chamada delegada usando o provider adapter configurado.
8. O orquestrador sintetiza a resposta final ou, em fluxo streaming roteado, faz o match entre a requisicao e as capabilities declaradas pelos delegados permitidos, propondo um alvo final e tarefas internas opcionais. O backend valida mecanicamente o alvo, a capability declarada, o grafo, autorizacao, limites e fallback antes do stream final. Quando houver tarefas internas independentes, multiplos agentes delegados podem executar em paralelo antes do stream final.
9. Gateway retorna resposta ou stream em formato compativel com OpenAI.

## 7. Requisitos funcionais

- RF-001: aceitar chamadas Chat Completions compativeis com OpenAI no endpoint `/v1/chat/completions`.
- RF-002: expor `/v1/models` com os modelos publicamente roteaveis pelo gateway.
- RF-003: suportar `stream: true` usando Server-Sent Events no formato esperado por clientes OpenAI.
- RF-004: permitir definir um orquestrador global no JSON de configuracao.
- RF-005: permitir sobrescrever o orquestrador por rota/modelo exposto.
- RF-006: permitir configurar modelos delegaveis com provider, model id, parametros padrao, limites e capabilities declaradas usadas pelo orquestrador para match de roteamento.
- RF-007: permitir o orquestrador chamar uma tool interna para delegar trabalho a modelos permitidos, com match de capabilities feito pela LLM orquestradora, enforcement deterministico de grafo interno, paralelismo de agentes quando dependencias permitirem, alvo final unico validado pelo backend e fallback explicito para o modelo do orquestrador quando permitido pela rota.
- RF-008: suportar OpenRouter como provider oficial inicial.
- RF-009: validar a configuracao no boot e falhar de forma explicita se ela for invalida.
- RF-010: mascarar segredos em logs, erros e respostas.

## 8. Requisitos nao funcionais

- RNF-001: o gateway deve ser stateless no MVP.
- RNF-002: a configuracao deve ser carregada de um arquivo JSON unico.
- RNF-003: a arquitetura deve permitir novos providers por adapters.
- RNF-004: erros internos de provider devem ser normalizados para o envelope de erro OpenAI quando possivel.
- RNF-005: streaming nao deve bloquear o event loop com transformacoes pesadas.
- RNF-006: logs devem ser estruturados e correlacionaveis por request id.
- RNF-007: timeouts, retries e limites de delegacao devem ser configuraveis.

## 9. Referencias de especificacao

- [Spec 001: API compativel com OpenAI](./specs/001-openai-compatible-api.md)
- [Spec 002: Orquestracao e roteamento por LLM](./specs/002-llm-orchestration-routing.md)
- [Spec 003: Configuracao JSON unica](./specs/003-single-json-configuration.md)
- [Spec 004: Providers e OpenRouter](./specs/004-provider-adapters-openrouter.md)
- [Spec 005: Streaming, tools e normalizacao de respostas](./specs/005-streaming-tools-response-normalization.md)
- [Spec 006: Routed streaming with internal delegations](./specs/006-streaming-final-with-internal-delegations.md)
- [Spec 007: Match de capabilities pelo orquestrador](./specs/007-orchestrator-capability-matching.md)
- [Spec 008: Observabilidade, resiliencia e seguranca](./specs/008-observability-resilience-security.md)
- [Spec 009: Hardening operacional apos revisao critica](./specs/009-critical-review-operational-hardening.md)

## 10. Referencias de ADR

- [ADR 0001: Usar NestJS no backend](./adrs/0001-use-nestjs-backend.md)
- [ADR 0002: Expor API OpenAI-compatible como contrato publico inicial](./adrs/0002-openai-compatible-public-api.md)
- [ADR 0003: Usar Vercel AI SDK para chamadas de LLM e tools](./adrs/0003-use-vercel-ai-sdk.md)
- [ADR 0004: Usar JSON unico para configuracao inicial](./adrs/0004-single-json-configuration.md)
- [ADR 0005: Usar uma LLM orquestradora para roteamento](./adrs/0005-llm-orchestrator-routing.md)
- [ADR 0006: Suportar OpenRouter como primeiro provider oficial](./adrs/0006-openrouter-first-provider.md)
- [ADR 0007: Criar camada de provider adapters](./adrs/0007-provider-adapter-layer.md)

## 11. Fontes externas

- OpenAI API Reference: https://developers.openai.com/api/reference/overview/
- OpenAI text generation guide: https://developers.openai.com/api/docs/guides/text
- Vercel AI SDK OpenRouter provider: https://ai-sdk.dev/providers/community-providers/openrouter
- OpenRouter quickstart: https://openrouter.ai/docs/quickstart
- OpenRouter API reference: https://openrouter.ai/docs/api/reference/overview
