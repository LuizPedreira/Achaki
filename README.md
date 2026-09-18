# Achados & Perdidos — Fatec | v13

Protótipo acadêmico estático em HTML, CSS e JavaScript, preparado para GitHub Pages e persistência local via localStorage.

## Contas de demonstração

### Usuário
- E-mail: `aluno@fatec`
- Senha: `1234`

### Administrador
- E-mail: `admin@fatec`
- Senha: `1234`

## Registros padrão
- **Fone de ouvido** — cadastrado por Ana.
- **Carteira marrom com corrente** — cadastrada por Lucas.
- **Chave de carro** — cadastrada por Maria.

Ao entrar como Ana, somente o fone aparece entre os itens encontrados por ela. Os demais continuam públicos, mas pertencem aos respectivos usuários.

## Fluxo público
- A aplicação abre diretamente na listagem de itens, sem exigir login.
- Busca e filtros podem ser usados sem autenticação.
- O detalhe do item é público.
- O contato do responsável permanece protegido.
- Ao clicar em **Entrar**, o usuário faz login e retorna ao mesmo item.
- Depois do login, o botão do WhatsApp é liberado.

## Cadastro de item encontrado
- Exige de 1 a 3 fotos.
- Permite galeria/arquivo ou câmera do celular.
- Comprime as imagens antes de armazenar.
- Solicita título, descrição, categoria, data, local e posse atual.
- A posse atual pode ser **Está comigo** ou **Entreguei na Fatec**.
- O registro é publicado imediatamente como **Em aberto**.
- Não há aprovação administrativa bloqueando a publicação.
- O formulário possui rascunho automático.

A devolução não é informada no cadastro inicial. Ela é registrada depois, quando realmente ocorrer:
- se o item estiver com o usuário que encontrou, ele registra a devolução em **Meus registros**;
- se estiver na Fatec, o administrador registra a devolução pelo painel.

## Cadastro de item perdido
- Título, descrição, categoria e data aproximada.
- Local opcional.
- Opção de compartilhar contato.
- Proteção contra solicitação idêntica.
- Rascunho automático.

## Painel administrativo
- Visão geral com indicadores reais do armazenamento atual.
- Cadastro de novo item encontrado pelo setor.
- Gestão de itens encontrados.
- Alteração de status: Em aberto / Reservado / Devolvido.
- Edição e exclusão de registros.
- Registro formal da devolução de itens sob guarda da Fatec.
- Gestão de itens perdidos.
- Vinculação de item perdido a item encontrado no processo de recuperação.
- Histórico separado entre devolvidos e não devolvidos.
- Gestão de usuários e administradores.
- Configuração do WhatsApp institucional, categorias e locais.
- Exportação e importação de backup JSON.

## Requisitos funcionais implementados
- RF01 Cadastro de usuários.
- RF02 Login e autenticação.
- RF03 Cadastro de item encontrado com foto, descrição, categoria, local, data e posse atual.
- RF04 Cadastro de item perdido.
- RF05 Busca/filtros por palavra-chave, categoria, período, local e status.
- RF06 Exibição pública dos itens encontrados.
- RF07 Administrador altera status do item.
- RF08 Histórico de devolvidos e não devolvidos.
- RF09 Administrador edita/exclui registros e há validação de duplicidade.
- RF10 Avaliação do processo de devolução.
- RF11 Informação da posse atual do item.
- RF12 Registro formal da devolução e manutenção do histórico.

## GitHub Pages
Envie todos os arquivos e pastas para a raiz do repositório e configure:

`Settings > Pages > Deploy from a branch > main > /(root)`

## Limitação desta versão
O GitHub Pages não possui banco de dados. Portanto, cadastros e fotos enviados ficam no navegador em que foram criados. Os três itens padrão e suas imagens ficam no próprio repositório e aparecem em qualquer dispositivo.


## v9 — feedback dos dois lados
Após uma devolução, o sistema permite duas avaliações independentes:
- **Quem perdeu/recuperou** avalia como foi receber o item de volta.
- **Quem encontrou/devolveu** avalia como foi o processo de entrega.

O painel administrativo consolida as duas perspectivas no Histórico. A mesma pessoa não consegue enviar duas vezes a mesma perspectiva. Na devolução direta, também é possível vincular uma solicitação de item perdido para liberar o feedback da pessoa que recuperou o objeto.

### Acessos simples para a apresentação
- Aluno: `aluno@fatec` / `1234`
- Administrador: `admin@fatec` / `1234`


## v10 — cenário de demonstração e status Reservado
- Ana encontrou o fone: **Em aberto**.
- Lucas encontrou a carteira: **Reservado para Ana**.
- Maria encontrou a chave: **Em aberto**, permanecendo com quem encontrou.
- Ana possui uma solicitação de carteira perdida já relacionada à carteira reservada.
- **Reservado** significa que um possível proprietário foi identificado e o objeto está separado enquanto a devolução é organizada; não significa que o item já foi entregue.
- No painel, ao escolher Reservado, abre um formulário para identificar/vincular o possível proprietário.
- Cadastros e devoluções agora exibem confirmação visual com resumo e próximos passos.


## v11 — Visualização de fotos
Na tela de detalhes, clique/toque na foto do item para abrir a imagem inteira em um visualizador. Se um item tiver mais de uma foto, use as setas ou as teclas ←/→. Esc fecha o visualizador.


## v13 — cenário limpo para apresentação com dois alunos
A restauração dos dados iniciais agora deixa o sistema pronto para uma demonstração ao vivo, sem uma solicitação perdida ou reserva já montada.

### Contas fáceis
- Aluno 1: `aluno@fatec` / `1234`
- Aluno 2: `aluno2@fatec` / `1234`
- Administrador: `admin@fatec` / `1234`

### Estado inicial
- Fone de ouvido: cadastrado por Ana (Aluno 1), **Em aberto**.
- Carteira: cadastrada por Lucas, **Em aberto**.
- Chave de carro: cadastrada por Maria, **Em aberto**.
- Nenhuma solicitação de item perdido vem pronta.
- Nenhum item começa reservado.

Assim, durante a apresentação você pode criar um caso novo do zero: Aluno 1 registra que perdeu um objeto; Aluno 2 registra que encontrou o mesmo objeto; o administrador relaciona os dois, reserva o encontrado e conclui a devolução.

Ao reservar um item, se existir exatamente uma solicitação perdida da mesma categoria, o painel sugere essa correspondência e preenche automaticamente o nome e telefone do possível proprietário. Isso agiliza a demonstração sem realizar a devolução automaticamente.


## Novidades da v13
- Fotos também no cadastro de item perdido (até 3, opcionais).
- O botão do WhatsApp cria uma solicitação de contato registrada no sistema.
- Quando o item está com quem encontrou, essa pessoa recebe a solicitação em Meus registros.
- O responsável pode abrir o WhatsApp, rejeitar a identificação ou confirmar a entrega.
- Ao confirmar a entrega, o item passa para Devolvido e é associado ao usuário que entrou em contato.
- Se houver uma solicitação de item perdido vinculada, ela também é marcada como recuperada.
- Os dois lados podem avaliar a devolução.
- Em Meus registros > Perdi existe a ação "Meu item foi encontrado", que permite relacionar a solicitação a um item encontrado.
- O painel administrativo exibe solicitações de contato pendentes quando o objeto está sob guarda da Fatec.


## Ajuste v14 — contato sem registro prévio de perda
Se um aluno encontrar um item na tela pública e iniciar contato pelo WhatsApp sem ter cadastrado a perda antes, o sistema cria automaticamente uma **solicitação de recuperação** em **Meus registros > Perdi**. Ela fica vinculada ao item encontrado e à solicitação de contato. Quando a entrega é confirmada, esse registro passa para recuperado e o aluno pode avaliar a devolução normalmente.

Isso evita obrigar o aluno a voltar e cadastrar manualmente uma perda depois de já ter localizado o objeto.
