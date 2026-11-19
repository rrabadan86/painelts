---
paths:
  - "public/**"
---
# Padrão visual do painel (construção de layout)

Toda tela nova ou mexida segue estas peças, nesta ordem. Antes de inventar um componente, procure um igual numa tela pronta
(Estoque → Notas fiscais e ⭐ Sugestões são as referências de lista; Estoque é a de tabela com filtros e quadros).

## Estrutura da página (de cima para baixo)
1. **Submenu do grupo**: `TS.subEstoque(tela)` / `TS.subGrupo(tela)` — nunca um menu próprio.
2. **Cabeçalho**: `page-head` com `h1.page-title` (com o ícone da tela, se tiver) e `div.page-sub` — uma frase do que a tela faz.
3. **Avisos** (`div.notice`, `notice ok`, `notice warn`, `notice err`): só o que pede ação agora, uma linha, no topo.
4. **Quadros de número** (`TS.kpi` dentro de `div.grid.g-kpi`): 3 a 5, cada um com rodapé curto e `title` explicando a conta. Quadro que filtra a tabela abaixo é clicável.
5. **Ação principal** (formulário curto, busca, "+ Novo…") num `TS.card`.
6. **A lista**: um `TS.card`/`TS.cardWithTools` com título, uma frase de explicação, as **abas com contagem** (`TS.seg` → "Esperando (6)") e o **`TS.table`**.

## Listas: sempre `TS.table`, nunca pilha de cartões soltos
- Mais de ~5 itens que se repetem = tabela (`TS.table`): ela já tem busca, ordenação, páginas (100 no computador, 40 no celular), imprimir/expandir e vira cartão de 2 colunas no celular. Pilha de `div` por item fica ilegível com muitos itens (foi o caso da primeira versão das ⭐ Sugestões).
- Colunas: a 1ª é o nome (com `sticky: true, wrap: true`), em **negrito**, com a etiqueta (`badge`) e uma linha `small.muted` de detalhe embaixo; datas `dd/mm`; dinheiro alinhado à direita (`fmt.brl`); texto longo com `wrap: true`.
- Toda coluna que precisa de explicação ganha `title` (vira ⓘ tocável no computador e no celular). Andamento/estado com o motivo embaixo em `small.muted`.
- Ações da linha: botão pequeno no fim (`btn`, `btn ghost-danger` para tirar/excluir); destrutiva pede `confirm`.
- Histórico/detalhe longo: `<details>` dentro da célula ou janela (`cp-modal-bg`), não uma linha gigante.
- Vazio: o `empty` da tabela com frase útil ("Nada para repor agora. 👏"), nunca tabela em branco.

## Cores e etiquetas (sempre por classe, nunca cor solta no JS)
- Tokens em `:root` de `styles.css` (`--green`, `--dark`, `--gold`, `--good`, `--bad`, `--muted`, `--line`…). Cor nova = token novo, não hex no meio do código.
- Texto: `pos` (bom), `neg` (ruim), `warn-t` (atenção), `muted` (secundário). Etiqueta: `badge` + `ok` / `warn` / `erro` / `cinza` (estado), sempre com texto (não só cor).
- Botões: `btn primary` (uma ação principal por bloco), `btn` (secundária), `btn ghost-danger` / `btn danger` (tirar/excluir), `chip` (atalhos e escolhas rápidas).
- Emojis só como marca da coisa (⭐ sugestão, 🔒 regra fixa, 🛒 carrinho, ✅/❌/⚠️ resultado), nunca decoração.

## Textos
- Português simples, frase curta, sem termo técnico para a vendedora. Diga **o que é, de onde vem e o que fazer**.
- Número sempre formatado (`TS.fmt`): `R$ 1.234,56`, `12,5%`, `0,500 kg`, `dd/mm`.
- Nunca "null", "undefined", "NaN": `replaceChildren(...[...].filter(Boolean))` e `fmt` devolve "—".

## Formulários
- `campo(rótulo, controle, dica)`: rótulo em cima, dica `small` embaixo. Grupo de caixas de marcar = `fieldset` com `legend` (não `label` dentro de `label`).
- Regra fixa aparece **travada** (`disabled`) com 🔒 e o motivo — não escondida.
- Campo que redesenha a tela: `TS.aoConfirmar`.

## Celular (390 px)
- Nada passa da borda: `min-width: 0` em filhos de flex/grid com texto longo, `overflow-wrap: anywhere` em nomes. Formulário dentro de linha de tabela usa `position: sticky; left: 0` e a largura da tela.
- Toque: botões com área de pelo menos ~32 px; o ✨ flutuante não cobre ação.
- Confira com a skill `conferir-celular` (computador também: `--largura=1100`) e olhe o print antes de subir.

## Antes de subir uma tela mexida
- [ ] Usa as peças acima (cabeçalho, avisos, quadros, card, abas com contagem, `TS.table`).
- [ ] Cores por classe/token; nenhuma cor/hex nova no JS.
- [ ] Prints no computador e no celular conferidos (sem rolagem lateral, sem texto cortado, sem "null").
