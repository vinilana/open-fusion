# Spec 007: Observabilidade, resiliencia e seguranca

## Status

Draft

## Objetivo

Definir requisitos minimos de operacao segura do gateway.

## Observabilidade

Cada requisicao deve ter um `requestId`. Se o cliente enviar um id aceito, o gateway pode propaga-lo; caso contrario, deve gerar um.

Logs estruturados devem incluir:

- `requestId`;
- cliente autenticado;
- rota publica;
- orquestrador usado;
- modelos delegados chamados;
- provider;
- status;
- latencia total;
- latencia por chamada de provider;
- tokens quando disponiveis;
- erro normalizado quando houver.

Logs nao devem incluir:

- API keys;
- bearer tokens;
- headers sensiveis;
- prompts completos por default em producao;
- respostas completas por default em producao.

## Resiliencia

Configuracoes minimas:

- timeout total por rota;
- timeout por chamada delegada;
- numero maximo de delegacoes;
- retry por provider quando seguro;
- circuit breaker em versao futura.

Retries nao devem ser aplicados automaticamente a chamadas que possam gerar efeitos externos. Como o MVP usa apenas chamadas de LLM sem side effects externos, retries podem ser permitidos para erros transientes configurados.

## Seguranca

Regras minimas:

- autenticar todas as chamadas `/v1/*`, exceto health checks explicitamente publicos;
- validar schema da entrada;
- limitar tamanho de payload;
- limitar quantidade de mensagens;
- limitar tamanho de mensagens;
- bloquear acesso a modelos internos nao expostos;
- mascarar segredos;
- tratar resultados de modelos delegados como conteudo nao confiavel.

## Health checks

Endpoints recomendados:

- `GET /health/live`: processo esta vivo.
- `GET /health/ready`: configuracao carregada e providers essenciais inicializados.

Nenhum health check deve validar credenciais fazendo chamada paga por default.

## Auditoria

O MVP deve registrar eventos suficientes para responder:

- qual cliente chamou;
- qual rota foi usada;
- quais modelos foram acionados;
- quanto tempo levou;
- se houve erro;
- qual provider falhou.

Nao e requisito inicial armazenar historico em banco.

## Criterios de aceite

- Toda chamada possui `requestId`.
- Falhas de provider retornam erro normalizado.
- Segredos sao mascarados em logs.
- Limites de timeout e delegacao sao aplicados.

## ADRs relacionados

- [ADR 0004](../adrs/0004-single-json-configuration.md)
- [ADR 0005](../adrs/0005-llm-orchestrator-routing.md)
- [ADR 0007](../adrs/0007-provider-adapter-layer.md)
