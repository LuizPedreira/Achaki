# Roteiro de testes — v8

1. Acesse sem login e confirme que os itens aparecem.
2. Abra um item sem login: contato deve permanecer bloqueado; Entrar deve levar ao login e retornar ao item.
3. Login de usuário: `ana.rocha@fatec.sp.gov.br` / `1234`.
4. Cadastre item encontrado com 1–3 fotos. Não deve existir pergunta sobre devolução no cadastro.
5. Após publicar, o item deve aparecer imediatamente na busca e em Meus registros.
6. Se o item estiver “Está comigo”, registre a devolução por Meus registros após a entrega.
7. Se estiver “Entreguei na Fatec”, somente o administrador deve registrar a devolução.
8. Cadastre item perdido e confirme busca/filtros por categoria, palavra-chave, período, local e status.
9. Login administrador: `admin@fatec.sp.gov.br` / `admin123`.
10. No painel, edite/exclua registros e altere Em aberto/Reservado.
11. Registre devolução de um item sob guarda da Fatec.
12. Confira Histórico > Devolvidos e Não devolvidos.
13. Confirme que o usuário pode avaliar uma devolução vinculada à solicitação de item perdido.
14. Teste exportar/importar backup e configurações.
