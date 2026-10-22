# FraldaCerta — checkpoint de 22/10/2026

## Onde paramos

A Etapa 8 foi validada localmente. Nenhum deploy foi executado e nenhuma consulta externa de produtos foi feita nesta etapa.

## O que foi feito

- A interface do buscador recebeu ajustes visuais, preservando a busca existente.
- A camada de afiliados permite links manuais de Shopee, Amazon Brasil e Mercado Livre, associação por identificadores estáveis, rota de saída e painel administrativo. Programas e links continuam pendentes até aprovação e revisão.
- O projeto Neon exclusivo `fraldacerta` (`young-pine-76466496`) está em São Paulo (`aws-sa-east-1`). As migrações Drizzle criaram `affiliate_programs`, `affiliate_offers`, `affiliate_links` e `affiliate_clicks`, com índices. O teste controlado de criação, leitura, atualização, associação exata e exclusão foi concluído, sem registros de teste remanescentes.
- `npm run admin:setup` foi executado pelo usuário. `ADMIN_PASSWORD_HASH`, `ADMIN_PASSWORD_SALT` e `ADMIN_SESSION_SECRET` existem em `.env.local`; os valores não devem ser exibidos ou versionados.
- O login real abriu `/admin` e exibiu os dados do Neon. Senha incorreta foi rejeitada; logout devolveu ao login; `/admin` voltou a exigir sessão. Testes automatizados cobriram expiração de sessão, APIs sem sessão, origem inválida e cookie seguro em HTTPS.
- No projeto Vercel `fraldacerta` (`prj_O1QuqK2wropmE3fTbSZ42lbpNDOW`), `DATABASE_URL`, as três variáveis `ADMIN_*` e `SEARCHAPI_API_KEY` foram cadastradas como **Secrets de Production**. Os valores não constam neste arquivo.
- Última verificação: `npm run lint`, `npm run typecheck`, `npm test` (60 aprovados) e `npm run build` passaram.

## Próximos passos antes do deploy

1. Obter e configurar `UPSTASH_REDIS_REST_URL` e `UPSTASH_REDIS_REST_TOKEN` no ambiente Production da Vercel. Sem ambos, a busca externa fica bloqueada para proteger a cota.
2. Configurar credenciais das integrações opcionais de `.env.example` somente se forem ativadas. Revisar aprovação e regras de cada programa de afiliados antes de marcar programas ou links como ativos.
3. Considerar endurecimento da autenticação: logout limpa o cookie no navegador, mas uma cópia de um token assinado ainda vale até expirar em 12 horas; o limitador de login atual é por instância.
4. Antes de publicar, revisar o checkpoint no Git e repetir lint, typecheck, testes e build. Após um futuro deploy, validar cookies e origem no domínio HTTPS real. Não usar o banco Production em ambientes Preview.

## Retomada

Ao voltar, começar com uma revisão curta deste checkpoint e do estado atual do Git, Neon e Vercel, sem imprimir segredos nem consultar a SearchAPI.io. Em seguida, partir das pendências acima. Não executar deploy sem uma solicitação específica.
