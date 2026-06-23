# ADR 0006: Suportar OpenRouter como primeiro provider oficial

## Status

Accepted

## Contexto

O MVP precisa de acesso a multiplos modelos usando uma integracao inicial simples. OpenRouter oferece uma API unificada e compativel com OpenAI, alem de integracao com Vercel AI SDK.

## Decisao

OpenRouter sera o primeiro provider oficialmente suportado.

## Consequencias

Positivas:

- acesso inicial a muitos modelos por uma unica credencial;
- boa aderencia ao contrato OpenAI-compatible;
- reduz complexidade de integracao no MVP.

Negativas:

- disponibilidade, precos, limites e capacidades dependem de um intermediario;
- nem todos os modelos terao suporte uniforme a tools, streaming ou parametros;
- sera necessario documentar diferencas e falhas vindas do provider.

## Specs relacionadas

- [Spec 004](../specs/004-provider-adapters-openrouter.md)
- [Spec 003](../specs/003-single-json-configuration.md)

