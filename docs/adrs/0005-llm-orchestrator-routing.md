# ADR 0005: Usar uma LLM orquestradora para roteamento

## Status

Accepted

## Contexto

O gateway deve direcionar chamadas para outros LLMs conforme configuracoes e contexto da requisicao. Regras estaticas cobrem parte do problema, mas a proposta central do produto e usar uma LLM como orquestradora.

## Decisao

Cada rota publica tera um modelo orquestrador. Esse modelo recebe contexto sobre modelos permitidos e pode chamar uma tool interna de delegacao para executar subtarefas em outros modelos.

## Consequencias

Positivas:

- roteamento pode considerar intencao, complexidade e contexto da conversa;
- permite estrategias compostas, como draft rapido seguido de sintese final;
- mantem o cliente desacoplado dos modelos internos.

Negativas:

- aumenta latencia e custo por requisicao;
- decisoes podem variar entre chamadas;
- exige limites rigidos para evitar loops, excesso de delegacao e vazamento de informacao operacional.

## Specs relacionadas

- [Spec 002](../specs/002-llm-orchestration-routing.md)
- [Spec 005](../specs/005-streaming-tools-response-normalization.md)
- [Spec 006](../specs/006-streaming-final-with-internal-delegations.md)
- [Spec 007](../specs/007-orchestrator-capability-matching.md)
- [Spec 008](../specs/008-observability-resilience-security.md)
