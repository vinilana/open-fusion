# ADR 0004: Usar JSON unico para configuracao inicial

## Status

Accepted

## Contexto

O MVP precisa ser simples de operar e facil de versionar. A configuracao inclui providers, modelos, rotas, autenticacao, limites e observabilidade.

## Decisao

Todas as configuracoes iniciais viverao em um unico arquivo JSON carregado no boot da aplicacao.

## Consequencias

Positivas:

- facil versionamento em repositorio;
- menor dependencia operacional;
- boot deterministico;
- bom ponto de partida para validacao de schema.

Negativas:

- mudancas exigem restart no MVP;
- arquivo pode crescer com multiplos tenants e rotas;
- segredos precisam ser referenciados por variaveis de ambiente para evitar exposicao no JSON.

## Specs relacionadas

- [Spec 003](../specs/003-single-json-configuration.md)
- [Spec 008](../specs/008-observability-resilience-security.md)
