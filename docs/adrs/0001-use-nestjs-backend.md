# ADR 0001: Usar NestJS no backend

## Status

Accepted

## Contexto

O gateway precisa expor APIs HTTP, validar configuracao, aplicar autenticacao, organizar providers, controlar streaming e manter separacao clara entre controllers, servicos e adapters. A stack definida para o backend e NestJS.

## Decisao

Usaremos NestJS como framework principal do backend.

## Consequencias

Positivas:

- estrutura modular adequada para separar API, orquestracao, providers, configuracao e observabilidade;
- suporte maduro a dependency injection;
- bom encaixe com validacao, pipes, guards, interceptors e testes;
- ecossistema TypeScript consistente com Vercel AI SDK.

Negativas:

- maior cerimonia que um servidor HTTP minimalista;
- streaming exige cuidado para nao esconder detalhes do adapter HTTP usado.

## Specs relacionadas

- [Spec 001](../specs/001-openai-compatible-api.md)
- [Spec 007](../specs/007-observability-resilience-security.md)
