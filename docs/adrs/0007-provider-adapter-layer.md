# ADR 0007: Criar camada de provider adapters

## Status

Accepted

## Contexto

Embora o primeiro provider oficial seja OpenRouter, a aplicacao deve ser preparada para suportar outros providers no futuro. Controllers e orquestracao nao devem depender de detalhes de um provider especifico.

## Decisao

Criaremos uma camada interna de provider adapters. Cada adapter converte configuracao interna para primitives do Vercel AI SDK, normaliza erros e expoe capacidades suportadas.

## Consequencias

Positivas:

- novos providers podem ser adicionados sem alterar a API publica;
- testes de contrato podem validar comportamento comum;
- detalhes especificos de provider ficam isolados.

Negativas:

- adiciona uma camada de indirecao;
- pode ocultar recursos especificos se a interface comum for restritiva;
- exige disciplina para nao importar providers diretamente em controllers ou servicos de rota.

## Specs relacionadas

- [Spec 004](../specs/004-provider-adapters-openrouter.md)
- [Spec 007](../specs/007-observability-resilience-security.md)
