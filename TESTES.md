# Roteiro de testes — v8

1. Acesse sem login e confirme que os itens aparecem.
2. Abra um item sem login: contato deve permanecer bloqueado; Entrar deve levar ao login e retornar ao item.
3. Login de usuário: `aluno@fatec` / `1234`.
4. Cadastre item encontrado com 1–3 fotos. Não deve existir pergunta sobre devolução no cadastro.
5. Após publicar, o item deve aparecer imediatamente na busca e em Meus registros.
6. Se o item estiver “Está comigo”, registre a devolução por Meus registros após a entrega.
7. Se estiver “Entreguei na Fatec”, somente o administrador deve registrar a devolução.
8. Cadastre item perdido e confirme busca/filtros por categoria, palavra-chave, período, local e status.
9. Login administrador: `admin@fatec` / `1234`.
10. No painel, edite/exclua registros e altere Em aberto/Reservado.
11. Registre devolução de um item sob guarda da Fatec.
12. Confira Histórico > Devolvidos e Não devolvidos.
13. Confirme que o usuário pode avaliar uma devolução vinculada à solicitação de item perdido.
14. Teste exportar/importar backup e configurações.


## Feedback v9
1. Faça uma devolução direta de um item cadastrado pelo aluno.
2. Em **Meus registros > Encontrei**, confirme que aparece **Avaliar** para quem encontrou.
3. Vincule a devolução a uma solicitação de item perdido.
4. Entre com o usuário que criou a solicitação e confirme **Avaliar devolução** em **Perdi**.
5. Envie os dois feedbacks e confirme que não é possível repetir a mesma avaliação.
6. No administrador, abra **Histórico** e clique no resumo de feedback para visualizar as duas perspectivas.

7. Durante uma avaliação, escreva um comentário, altere as estrelas e confirme que o comentário não é apagado.
8. Tente alterar o perfil ou criar administrador usando e-mail já existente e confirme o bloqueio de duplicidade.


## Testes da v10
1. Entre como `aluno@fatec` / `1234`: Meus registros deve mostrar o fone encontrado e a carteira perdida.
2. A carteira perdida deve mostrar “Possível item localizado”; ao abrir a carteira encontrada, o status Reservado deve ser explicado.
3. Entre como `admin@fatec` / `1234`: em Itens encontrados, mudar um item para Reservado deve abrir o formulário de reserva.
4. Selecione uma solicitação perdida, confirme a reserva e verifique o nome do possível proprietário na tabela.
5. Volte o item para Em aberto e confirme que a reserva é removida.
6. Cadastre um item encontrado: deve aparecer uma confirmação com “Ver registro”.
7. Cadastre um item perdido: deve aparecer uma confirmação com “Ver em Meus registros”.
8. Registre uma devolução: deve aparecer um resumo com item, proprietário, data e status.
9. Editar item perdido no painel não deve permitir marcar Devolvido manualmente; use Registrar recuperação.


## Teste da foto ampliada
1. Abra qualquer item na tela inicial.
2. Clique/toque na foto grande.
3. Confirme que a foto abre inteira, sem corte.
4. Feche no X, clicando fora ou pressionando Esc.
5. Em item com várias fotos, valide as setas de navegação.


## Cenário v12 — dois alunos
1. Restaurar dados iniciais no Admin e confirmar que não há itens perdidos e não há itens reservados.
2. Confirmar login `aluno@fatec` / `1234`.
3. Confirmar login `aluno2@fatec` / `1234`.
4. Aluno 1 registra um item perdido novo.
5. Aluno 2 registra o mesmo tipo de objeto como encontrado com foto.
6. Admin altera o encontrado para Reservado e verifica a sugestão da solicitação perdida da mesma categoria.
7. Admin registra a devolução vinculando a solicitação.
8. Aluno 1 vê o perdido como recuperado e envia feedback.
9. Aluno 2 vê o encontrado como devolvido e envia feedback.
10. Admin vê os dois feedbacks no Histórico.


## Fluxo v13 - dois alunos
1. Entre como `aluno@fatec` e cadastre um item perdido com foto.
2. Saia e entre como `aluno2@fatec`; cadastre o mesmo tipo de objeto como encontrado e escolha `Está comigo`.
3. Volte para `aluno@fatec` > Meus registros > Perdi > `Meu item foi encontrado`.
4. Selecione o item cadastrado pelo Aluno 2 e abra os detalhes.
5. Clique em `Entrar em contato pelo WhatsApp`. O sistema deve registrar a solicitação e reservar o item.
6. Entre como `aluno2@fatec`. Em Meus registros, deve aparecer a solicitação do Aluno 1.
7. Abra a solicitação e clique em `Confirmar entrega`.
8. O item encontrado e o perdido devem ficar como devolvidos/recuperados.
9. Aluno 1 e Aluno 2 devem poder avaliar a devolução separadamente.
