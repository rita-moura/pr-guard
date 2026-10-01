# Testar o detector de merge

Use um PR aberto com origem `fix/*` ou `feature/*`, para que a política de exemplo
exija Squash. O PR desta correção pode ser usado no teste.

1. Execute `npm test` e `npm run build` nesta branch.
2. Em `chrome://extensions`, recarregue o PR Guard. Se ainda não estiver instalado,
   carregue `/home/rita/LumeraCode/pr-guard/dist/extension` sem compactação.
3. Nas opções da extensão, importe `policy.example.json` se precisar restaurar a
   política de exemplo. Isso substitui a configuração local: exporte antes se quiser preservá-la.
4. Abra ou recarregue a página do PR e vá até os controles de merge.
5. Selecione **Squash and merge**: a regra `squash` deve ser aprovada.
6. Abra o menu de métodos sem escolher outro: as opções do menu não devem mudar
   o resultado da regra.
7. Se o repositório permitir, selecione **Create a merge commit** ou **Rebase and merge**:
   a regra deve indicar falha e informar o método exigido e o identificado.
8. Ao clicar na ação incompatível para abrir a confirmação, deve aparecer o alerta
   local. **Não clique no botão final de confirmação** durante o teste.
9. Volte para Squash: a pendência deve desaparecer. Se não houver um controle
   reconhecível, o painel deve mostrar uma verificação não realizada, sem assumir aprovação.
10. Edite temporariamente o título removendo `fix:`: a regra de título deve falhar.
    Restaure o prefixo depois. Desmarque e marque um item do checklist para testar o aviso.

Não é necessário fazer merge para validar o comportamento. Métodos desabilitados
nas configurações do repositório não estarão disponíveis para seleção.

O detector cobre rótulos em inglês e atributos dos controles. Auto-merge, merge queue
e outras variações do layout ainda precisam de validação específica. Os testes
unitários usam propriedades simuladas dos controles; o teste no GitHub continua necessário.
