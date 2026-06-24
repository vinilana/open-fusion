# Spec 003: Configuracao JSON unica

## Status

Draft

## Objetivo

Definir o arquivo JSON unico usado pelo MVP para configurar API keys, providers, modelos, orquestradores, rotas, limites, logs e politicas.

## Localizacao

O caminho do arquivo deve ser definido por variavel de ambiente:

```text
OPEN_FUSION_CONFIG=/path/to/open-fusion.config.json
```

Se ausente, o backend pode tentar `./config/open-fusion.config.json`.

## Requisitos

- O arquivo deve ser lido no boot da aplicacao.
- O schema deve ser validado antes de iniciar o servidor HTTP.
- Segredos podem ser declarados por referencia a variaveis de ambiente.
- O MVP nao precisa de reload dinamico.
- Erros de configuracao devem indicar caminho do campo invalido.

## Estrutura proposta

```json
{
  "version": 1,
  "server": {
    "port": 3000,
    "publicBaseUrl": "http://localhost:3000"
  },
  "auth": {
    "apiKeys": [
      {
        "id": "local-dev",
        "tokenEnv": "OPEN_FUSION_DEV_API_KEY",
        "allowedRoutes": ["default"]
      }
    ]
  },
  "providers": {
    "openrouter": {
      "type": "openrouter",
      "apiKeyEnv": "OPENROUTER_API_KEY",
      "baseUrl": "https://openrouter.ai/api/v1",
      "headers": {
        "HTTP-Referer": "https://example.com",
        "X-Title": "Open Fusion"
      }
    }
  },
  "models": {
    "orchestrator.default": {
      "provider": "openrouter",
      "model": "openai/gpt-4.1",
      "role": "orchestrator",
      "defaults": {
        "temperature": 0.2
      }
    },
    "worker.fast": {
      "provider": "openrouter",
      "model": "openai/gpt-4.1-mini",
      "role": "delegate",
      "capabilities": ["general", "fast_draft"],
      "defaults": {
        "temperature": 0.3
      }
    }
  },
  "routes": {
    "default": {
      "publicModel": "open-fusion/default",
      "orchestrator": "orchestrator.default",
      "allowedDelegateModels": ["worker.fast"],
      "maxDelegations": 3,
      "maxDepth": 1,
      "timeoutMs": 60000,
      "delegateTimeoutMs": 30000,
      "streamFinalOnly": true,
      "allowClientTools": false
    }
  },
  "observability": {
    "logLevel": "info",
    "redact": ["apiKey", "token", "authorization"]
  }
}
```

## Validacoes principais

- `version` deve ser suportada pela aplicacao.
- Cada provider precisa de `type` conhecido.
- Cada modelo deve referenciar um provider existente.
- Cada rota deve referenciar um orquestrador existente.
- `allowedDelegateModels` deve conter apenas modelos existentes com role `delegate`.
- `maxDepth` deve ser `1` no MVP.
- `allowClientTools` deve ser booleano quando declarado; quando ausente, o default seguro e `false`.
- Segredos resolvidos por `*Env` devem existir no ambiente, salvo em modo de validacao permissivo local.

## Resolucao de segredos

Campos terminados em `Env` apontam para variaveis de ambiente. O valor resolvido nunca deve ser serializado em logs ou retornado por endpoints.

## Evolucao

Versoes futuras podem adicionar:

- reload dinamico com troca atomica de configuracao;
- configuracao em banco de dados;
- overrides por tenant;
- templates de rota;
- importacao de arquivos parciais.

## Criterios de aceite

- Aplicacao falha no boot com erro claro quando o JSON e invalido.
- Um arquivo JSON unico configura uma rota funcional com OpenRouter.
- Segredos nao sao expostos em logs.

## ADRs relacionados

- [ADR 0004](../adrs/0004-single-json-configuration.md)

