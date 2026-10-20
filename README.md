# FraldaCerta

## Executar

```bash
npm install
npm run dev
```

Validação: `npm run lint`, `npm run typecheck`, `npm test`, `npm run build`.

## Busca progressiva SearchAPI.io

Configure `SEARCHAPI_API_KEY` e um Redis Upstash ligado ao projeto pela Vercel Marketplace. Copie `UPSTASH_REDIS_REST_URL` e `UPSTASH_REDIS_REST_TOKEN` para `.env.local` no desenvolvimento ou configure-as no ambiente da Vercel. Sem Redis, a fonte externa fica indisponível para proteger a cota; não há fallback de orçamento em memória em produção.

O Redis guarda por até 15 minutos (configurável com `SEARCH_CACHE_TTL_SECONDS`, de 60 a 3600) a resposta do Google Shopping com `product_token`, as respostas de vendedores, as ofertas normalizadas, o horário de coleta e o progresso. Chaves de busca incluem marca, tamanho e tipo, mas não CEP, pois a consulta externa não envia CEP. Respostas externas acima de 1 MB não são armazenadas. O cache e os locks são compartilhados pelas instâncias da aplicação.

A busca inicial usa até 1 consulta Shopping e resolve até 2 produtos elegíveis. Cada clique em **Buscar mais ofertas** resolve no máximo 1 outro token, sem perder os resultados anteriores. O orçamento padrão é de 20 consultas estimadas por dia UTC (`SEARCH_DAILY_CREDIT_BUDGET`) e 6 por pesquisa normalizada (`SEARCH_CREDIT_LIMIT_PER_QUERY`), incluindo Shopping e Product Offers. O Redis reserva o crédito de forma atômica antes da chamada; timeouts e falhas de rede mantêm a reserva. O contador confirmado registra respostas HTTP bem-sucedidas, não substitui o saldo oficial do provedor. A pesquisa deixa de consultar o provedor quando o orçamento é atingido.

## Mercado Livre

Configure `MELI_ACCESS_TOKEN` em `.env.local` com um token OAuth válido, obtido por uma aplicação Mercado Livre autorizada. Para obter e renovar esse token no [fluxo oficial OAuth](https://developers.mercadolivre.com.br/autenticacao-e-autorizacao), são necessários **App ID (client_id)**, **Client Secret**, **redirect URI registrada** e autorização da conta administradora. A renovação automática ainda não está implementada; atualize o token quando expirar. Sem token, a fonte informa indisponibilidade e a API retorna zero ofertas.

O conector usa somente chamadas oficiais: `GET /sites/MLB/search`, `GET /items/{id}/sale_price?context=channel_marketplace` e `GET /items/{id}/shipping_options?zip_code={cep}`. Preços e fretes vêm apenas das respostas da API. A cotação de frete não garante entrega ou preço final no checkout.

A rota `POST /api/search` valida filtros com Zod, limita a 12 solicitações por minuto por IP no processo e isola falhas por fonte. O limite em memória deve ser substituído por uma solução compartilhada antes de operar em várias instâncias.

## Amazon Brasil

O conector usa a [Creators API](https://associados.amazon.com.br/creatorsapi/docs/en-us/get-started/using-curl): `POST https://api.amazon.com/auth/o2/token` (client credentials) e `POST https://creatorsapi.amazon/catalog/v1/searchItems`, com `www.amazon.com.br`, `SearchItems` e `OffersV2`. Configure em `.env.local` `AMAZON_CREATORS_CLIENT_ID`, `AMAZON_CREATORS_CLIENT_SECRET` e `AMAZON_PARTNER_TAG`. A conta de Associados precisa de aceitação final e acesso à Creators API. O token fica em memória no servidor até expirar; não há credenciais no navegador. A API consultada não fornece cotação de frete por CEP nesta operação: a interface mostra **Frete não verificado**. Sem credenciais ou permissão, a fonte informa indisponibilidade e não há produtos inventados. Preços não são armazenados; cada busca aceita consulta nova. O limite inicial documentado é 1 chamada/s e 8640 chamadas/dia; a aplicação limita a 1 chamada/s e 8000 chamadas/dia por processo. Para várias instâncias, configure limite compartilhado antes da produção.

## Catálogo autorizado

Configure `CATALOG_IMPORT_FILE` com caminho para `.json` (lista de objetos) ou `.csv`, `CATALOG_IMPORT_KEY` com chave secreta longa, `CATALOG_PARTNER_NAME` e `CATALOG_ALLOWED_HOSTS` com domínios autorizados separados por vírgula. O parceiro fornece o arquivo e sua assinatura HMAC-SHA256 hexadecimal em `<arquivo>.sig`; o serviço recusa arquivo sem assinatura correta, maior que 1 MB, anúncio fora dos domínios autorizados ou coleta com mais de 24 horas. A chave e o arquivo real não devem entrar no repositório.

Cada registro contém `id`, `store`, `product`, `brand`, `size`, `style` (`tape` ou `pants`), `quantity`, `price` em reais, `url`, `checkedAt` ISO 8601. O título precisa comprovar marca, tamanho, tipo e quantidade e concordar com os campos. Opcionalmente, `available` (`true`, `false` ou `null`), `shippingPrice` em reais, `shippingCep` (8 dígitos) e `deliveryConfirmed` (`true`/`false`). Frete só aparece quando confirmado para o CEP pesquisado. A interface identifica a origem como **Catálogo importado** e exibe a data de coleta. Não há catálogo de produção incluído.

## Farmácias

Não foi encontrada API pública documentada de consulta de preços para Drogasil, Droga Raia, Pague Menos, Drogaria São Paulo ou Panvel. Há caminhos comerciais de parceria, mas não autorização de leitura de catálogo/preços para este comparador. O adaptador de catálogo assinado pode receber dados dessas redes após acordo específico de fornecimento e exibição.
