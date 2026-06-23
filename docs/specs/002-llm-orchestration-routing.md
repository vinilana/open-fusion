# Spec 002: Orquestracao e roteamento por LLM

## Status

Draft

## Objetivo

Definir como uma LLM orquestradora decide responder diretamente ou delegar execucao para outros modelos configurados.

## Conceitos

- Orquestrador: modelo principal chamado pelo gateway para interpretar a requisicao e decidir a estrategia.
- Modelo delegado: modelo que pode executar uma subtarefa solicitada pelo orquestrador.
- Rota publica: identificador usado pelo cliente no campo `model`.
- Politica de roteamento: regras declarativas que limitam quais modelos podem ser usados e em quais condicoes.

## Fluxo de orquestracao

1. Gateway resolve a rota publica informada em `model`.
2. Gateway monta um prompt de sistema do orquestrador com contexto operacional minimo:
   - modelos delegaveis permitidos;
   - capacidades declaradas;
   - limites de chamadas;
   - criterio de resposta final;
   - restricoes de seguranca.
3. Gateway chama o orquestrador via Vercel AI SDK.
4. Orquestrador pode:
   - responder diretamente;
   - chamar a tool interna `delegate_llm`;
   - chamar `delegate_llm` multiplas vezes ate o limite configurado.
5. Gateway executa chamadas delegadas e devolve resultados ao orquestrador.
6. Orquestrador produz resposta final no formato esperado.

## Tool interna `delegate_llm`

Schema conceitual:

```json
{
  "name": "delegate_llm",
  "description": "Executa uma subtarefa em um modelo delegado permitido pela rota.",
  "parameters": {
    "type": "object",
    "required": ["target_model", "task"],
    "properties": {
      "target_model": {
        "type": "string"
      },
      "task": {
        "type": "string"
      },
      "messages": {
        "type": "array"
      },
      "output_contract": {
        "type": "string"
      },
      "reason": {
        "type": "string"
      }
    }
  }
}
```

O gateway deve validar `target_model` contra a lista permitida da rota. O orquestrador nao pode acessar modelos nao declarados.

## Politicas de roteamento

Configuracoes minimas por rota:

- `orchestrator`: referencia de modelo orquestrador.
- `allowedDelegateModels`: lista de modelos delegaveis.
- `maxDelegations`: limite total de chamadas delegadas por requisicao.
- `maxDepth`: profundidade maxima de orquestracao. No MVP deve ser `1`.
- `timeoutMs`: timeout total da requisicao.
- `delegateTimeoutMs`: timeout por chamada delegada.
- `streamFinalOnly`: quando verdadeiro, somente a resposta final e transmitida ao cliente.

## Regras

- O cliente nunca escolhe diretamente modelos internos, salvo se a rota publica permitir.
- O orquestrador deve receber apenas os modelos e capacidades autorizados para aquela rota.
- Chamadas delegadas nao podem criar novas chamadas de orquestracao no MVP.
- O resultado de uma chamada delegada deve ser tratado como conteudo nao confiavel.
- O gateway deve impor limites mesmo se o orquestrador solicitar mais chamadas.

## Falhas

- Se uma delegacao falhar e a rota permitir fallback, o gateway pode tentar outro modelo configurado.
- Se a falha impedir resposta final, retornar erro normalizado.
- Timeouts de delegacao devem ser informados ao orquestrador quando ainda houver tempo para resposta final.

## Criterios de aceite

- A rota default chama o orquestrador configurado.
- O orquestrador consegue delegar para um modelo permitido.
- O gateway bloqueia delegacao para modelo nao permitido.
- O limite `maxDelegations` e aplicado de forma deterministica.

## ADRs relacionados

- [ADR 0005](../adrs/0005-llm-orchestrator-routing.md)
- [ADR 0007](../adrs/0007-provider-adapter-layer.md)

