# Achaki · Achados e Perdidos da Fatec Taquaritinga

Sistema web para registrar perdas e objetos encontrados, identificar proprietários e documentar a entrega. O catálogo público pode ser consultado sem conta. Os registros de perda, pedidos e contatos ficam disponíveis a quem tem acesso.

## Rodar no computador

Com Node.js 24 ou superior, na raiz do repositório:

```sh
npm test
npm run dev:demo
```

Abra [http://127.0.0.1:8787](http://127.0.0.1:8787). A demonstração local usa SQLite persistente e as fotos do protótipo. Também funciona sem dependências npm instaladas. A senha das três contas fictícias é `AchakiDemo2026!`.

| Conta de demonstração | E-mail |
|---|---|
| Ana, usuária | `ana@demo.achaki.test` |
| Lucas, usuário | `lucas@demo.achaki.test` |
| Setor, administrador | `setor@demo.achaki.test` |

`npm run dev` abre a versão local com banco vazio. Nela, os links de recuperação aparecem no terminal. O ambiente de demonstração e o ambiente vazio têm bancos locais próprios. O protótipo original continua disponível pelo [GitHub Pages](https://luizpedreira.github.io/Achaki/). Seus registros eram gravados em cada navegador. Contas, fotos e objetos dessa versão exigem migração a partir de uma exportação do navegador de origem.

Se houver registros reais na versão anterior, o painel antigo permite exportá-los em JSON no navegador onde foram cadastrados.

## Publicar no Cloudflare

O Worker serve as telas de `public/`, a API de `src/`, os registros no D1 e as fotos no R2. O bucket `achaki-photos` usa acesso privado e as fotos passam pela API para verificar acesso. O processamento de senhas ocorre em Durable Objects com PBKDF2-SHA256, salt individual e 600 mil iterações.

1. No terminal, entre na conta Cloudflare que contém a zona `jrsites.online`. O R2 precisa estar habilitado nessa conta. Se houver várias contas, defina `CLOUDFLARE_ACCOUNT_ID` com a conta da zona.

   ```sh
   npx --yes wrangler@4.162.0 login
   npm run deploy
   ```

2. O script cria ou reutiliza o D1 `achaki` e o bucket `achaki-photos`. Aplica as migrações e vincula apenas `achaki.jrsites.online`. O resultado esperado é [achaki.jrsites.online/api/health](https://achaki.jrsites.online/api/health) com `{"ok":true}`. Para validar uma configuração já provisionada sem implantar, use `npm run deploy -- --dry-run`.
3. Cadastre sua conta no site e mantenha a sessão aberta. Gere uma chave aleatória por meio de um gerenciador de senhas e configure o bootstrap usando o comando abaixo. Entre com ela em `/configurar-admin` e, depois de abrir o painel, remova o segredo.

   ```sh
   npx --yes wrangler@4.162.0 secret put ADMIN_BOOTSTRAP_TOKEN --config wrangler.production.json
   npx --yes wrangler@4.162.0 secret delete ADMIN_BOOTSTRAP_TOKEN --config wrangler.production.json
   ```

4. Entre em **Painel → Configurações** para informar local, horários e WhatsApp institucionais e decidir se os encontrados precisam de revisão antes de aparecer na busca.

### Integrações

| Recurso | Configuração |
|---|---|
| Recuperação por e-mail | Defina os segredos `RESEND_API_KEY` e `EMAIL_FROM` com um remetente autorizado pelo Resend. Use `wrangler secret put <nome> --config wrangler.production.json`. |
| Login institucional Microsoft | Cadastre um aplicativo Web no tenant da instituição com a URL de redirecionamento `https://achaki.jrsites.online/api/auth/microsoft/callback`. Defina os segredos `MICROSOFT_TENANT_ID`, `MICROSOFT_CLIENT_ID` e `MICROSOFT_CLIENT_SECRET`. Para unir uma conta existente ao SSO, entre primeiro nela e use **Vincular conta institucional**, em **Minha conta**. |
| Sugestão de categoria pela foto | Publique com `npm run deploy -- --suggestions` para ligar o Workers AI. A categoria proposta pode ser alterada antes de publicar o item. |
| Instalação no celular | No Android, instale pelo navegador compatível. No iPhone, adicione à Tela de Início pelo menu de compartilhamento do Safari. Os registros precisam de conexão. |
| Etiqueta QR | Gere e baixe uma etiqueta no detalhe de um objeto sob sua guarda ou na lista de encontrados do painel. |

Consulte as páginas oficiais sobre [domínios de Workers](https://developers.cloudflare.com/workers/configuration/routing/custom-domains/), [D1](https://developers.cloudflare.com/d1/get-started/), [R2](https://developers.cloudflare.com/r2/get-started/), [Durable Objects](https://developers.cloudflare.com/durable-objects/platform/limits/) e [Workers AI](https://developers.cloudflare.com/workers-ai/models/resnet-50/).

## Requisitos e validação

| Requisito | Implementação |
|---|---|
| RF01–RF02 | Cadastro com nome, e-mail, senha e telefone, login, perfil e sessão no servidor. |
| RF03–RF04, RF11 | Encontrados com até três fotos, categoria, descrição, local, data e guarda atual. Perdas privadas com data aproximada e fotos opcionais. |
| RF05–RF06 | Catálogo público de encontrados com busca por palavra-chave, categoria, local, período e status. |
| RF07–RF09 | Moderação configurável, reserva, liberação, arquivo reversível, edição e histórico administrativo com exportação CSV. |
| RF10, RF12 | Devolução direta ou pelo setor, registro de data e destinatário, confirmação de perda associada e avaliações independentes de quem encontrou e de quem recebeu. |
| RNF01, RNF04–RNF07 | Layout responsivo, navegação por teclado, HTML/CSS/JS, SQLite relacional, GitHub, chaves estrangeiras e índices para evitar registros idênticos. |
| RNF02 | Senhas armazenadas como hash com salt. |
| RNF03 | `/api/health` verifica o acesso ao banco. A meta de 95% de disponibilidade depende de medição após a publicação. |
| RD01–RD04 | SSO institucional configurável, sugestão por imagem, instalação web no celular e etiquetas QR. |

### Demonstração do fluxo

1. Entre como Ana e registre uma perda.
2. Em outra janela, entre como Lucas e registre um encontrado da mesma categoria, marcando **Entreguei na Fatec**.
3. Na conta da Ana, abra a perda e solicite a devolução em **Ver itens compatíveis**.
4. Entre como setor e acesse **Solicitações**. Aprove o pedido, reserve e registre a entrega.
5. Abra **Histórico** para conferir os movimentos. Use **Meus registros → Avaliações** em cada conta para avaliar.

O D1 oferece [Time Travel](https://developers.cloudflare.com/d1/reference/time-travel/). Para exportar o banco, use `npx --yes wrangler@4.162.0 d1 export achaki --remote --output backup.sql --config wrangler.production.json`. Mantenha uma cópia do bucket R2 junto do backup para recuperar as fotos.

O trabalho acadêmico original cita Supabase e Vercel. A implementação de produção usa D1, R2 e Cloudflare Workers.

### Licenças de componentes

- [Inter](https://github.com/rsms/inter), SIL Open Font License 1.1 em `public/fonts/inter.LICENSE.txt`.
- [QR Creator](https://github.com/nimiq/qr-creator), MIT em `public/vendor/qr-creator.LICENSE.txt`.
