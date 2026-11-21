---
paths:
  - "public/**"
---
# Padrão visual do painel (construção de layout)

Toda tela nova ou mexida segue estas peças, nesta ordem. Antes de inventar um componente, procure um igual numa tela pronta
(Estoque → Notas fiscais, ⭐ Sugestões e Configurações → Lojas são as referências de lista; Estoque é a de tabela com filtros e quadros).
Lista que abre um detalhe: a tabela some e o detalhe aparece no lugar, com "‹ Voltar" no topo (Inventário → contagem, Configurações → loja).

## Princípios do dono (valem para toda tela nova ou mexida)
1. **Simplicidade e usabilidade primeiro**: a pessoa entende a tela sem manual; uma ação principal por bloco; poucos cliques.
2. **Sem rolagem horizontal** em tabela no computador (1100–1400 px): junte informações na mesma célula (valor + detalhe pequeno embaixo), cada aba mostra só as colunas dela, o resto vai para a janela do produto. No celular vira cartão.
   Tabela larga precisa de folga: cabeçalho e células que quebram a linha (`white-space: normal`), nunca largura contada no pixel. A fonte do servidor de testes e do navegador do usuário é mais larga que a daqui — confira a tabela também com `* { letter-spacing: 1.2px }` (já pegou duas vezes: Preços e lojas lado a lado).
3. **O seletor reflete o que está na tela**: quadro clicável, aba (`TS.seg`) e filtro mostram o mesmo estado. `TS.seg` marca sozinho a opção clicada; quando outra coisa muda a aba (um quadro), use `TS.segMarcar(seg, valor)`.
4. **Tudo tem explicação** (indicador de decisão: a conta aberta, passo a passo, com os números da loja — veja `comoPrevisao` em `comprasvendas.js`): toda coluna e todo quadro com `title` (ⓘ) e toda opção de seletor com dica (`[rótulo, valor, dica]` no `TS.seg`) — o que é, de onde vem, como ler.
5. **Produto é clicável** e abre o histórico dele: `TS.histCompras(r, comprasItens, nfAtual)` (a janela da nota de entrada: notas, quantidade, custo e variação) ou o painel do produto da tela.
6. **Visual nos dois sentidos**: ícones consistentes com texto/tooltip (🛒 já está no pedido, ⭐ pedido da equipe); o que se relaciona aparece marcado nas duas listas.
7. **Ação por linha além da ação em lote** (ex.: "+ Adicionar ao pedido" em cada item).
8. **Campo de data, hora ou número não redesenha nem grava a cada dígito**: `TS.aoConfirmar` (o Chrome dispara `change` a cada parte da data).

## Estrutura da página (de cima para baixo)
1. **Submenu do grupo**: `TS.subEstoque(tela)` / `TS.subGrupo(tela)` — nunca um menu próprio.
2. **Cabeçalho**: `page-head` com `h1.page-title` (com o ícone da tela, se tiver) e `div.page-sub` — uma frase do que a tela faz.
3. **Avisos** (`div.notice`, `notice ok`, `notice warn`, `notice err`): só o que pede ação agora, uma linha, no topo. Informação que não pede ação (ex.: "mês em andamento") é uma linha discreta `muted` com ⓘ (`TS.dica`), depois dos quadros — não um aviso amarelo.
4. **Quadros de número** (`TS.kpi` dentro de `div.grid.g-kpi`): 3 a 5, cada um com rodapé curto e `title` explicando a conta. Quadro que filtra a tabela abaixo é clicável.
   - **Barra lateral só com estado**: vermelha (`kpi-ruim`) quando a comparação principal piorou, verde (`kpi-bom`) quando melhorou; quadro neutro não tem barra. O estado vem do 5º argumento (`TS.kpi(rótulo, valor, rodapé, dica, 'bom' | 'ruim' | null)`) ou, sem ele, do primeiro elemento com `up`/`pos` (bom) ou `down`/`neg` (ruim) no rodapé e, na falta, no valor. Rodapé trocado depois de montado: chame `TS.kpiEstado(quadro)` de novo.
   - Variações (`TS.linhasVar`) na mesma linha, curtas ("· 30 dias", "· ano"), com a frase completa no `title`.
   - A grade divide os quadros em linhas parecidas quando não cabem numa só (4 a 9 quadros): nunca um sozinho na linha de baixo; no celular, o que sobra ocupa a largura toda.
5. **Ação principal** (formulário curto, busca, "+ Novo…") num `TS.card`.
6. **A lista**: um `TS.card`/`TS.cardWithTools` com título, uma frase de explicação, as **abas com contagem** (`TS.seg` → "Esperando (6)") e o **`TS.table`**.

**Cartão (`.card`)**: um só recurso separa os blocos — a borda fina, **sem sombra**. Sombra é só do que fica por cima da página (janela, gaveta, menu, balão ⓘ). Nada de caixa dentro de caixa: itens dentro do cartão são linhas com divisória.
**Texto de apoio do cartão**: uma frase. Subtítulo (texto) com mais de ~140 caracteres o `TS.card`/`TS.cardWithTools` corta sozinho na primeira frase e guarda o resto em "Como ler ▸" (`details.est-como`; o texto todo continua na página).
**Ações do cabeçalho** (Compartilhar, Imprimir, Expandir): juntas, no canto direito do `card-head`.
**Lista de avisos (Início)**: uma lista só, com divisórias, agrupada por área com cabeçalho pequeno e contagem (`.ini-grupo`: Estoque, Inventário, Franquia, Vendas, Outros). A área vem da origem do aviso (campo `area`, posto por quem cria — `de('estoque')` em `inicio.js`), nunca do texto; vermelhos primeiro no grupo; "lembrar depois" aparece ao passar o mouse/focar a linha (no celular, sempre).
**Linha de ajustes (Pedido, `.ped-ctl`)**: seletor de modo + campos + "Salvar como padrão" à direita numa linha, alinhados pelos campos; situação e botões de atualizar numa linha discreta abaixo, com divisória; no celular empilha.

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

## Filtros: faixa no topo (não existe mais coluna lateral)
- Computador (acima de 860 px): os filtros ficam numa **faixa horizontal** logo abaixo do menu (`aside.sidebar`, agora deitado) e o conteúdo usa a largura inteira. Na faixa: "Período" (atalhos + as duas datas), as etiquetas dos filtros que estão valendo ("Vendedor: Ana ✕"), o botão **"Mais filtros"** com o contador dos ativos e o "Limpar". O resto (ano e mês, vendedor, grupo, categoria, produto contém e os campos próprios da tela) abre no painel do botão (`#maisFiltros`, `role="dialog"`, fecha com Esc ou clique fora). A faixa não é fixa ao rolar.
- Tela de um filtro só (Estoque, Pedido, Site): o campo vai sozinho na faixa, sem "Mais filtros". Tela sem filtro: sem faixa (`pg-semfiltros` ou, quando `TS.renderFiltros` não devolve campo nenhum, `fx-vazia`). A frase de contexto da tela (`f-uso`) vira um ⓘ ao lado do rótulo.
- Celular (até 860 px): a gaveta de sempre, aberta pelo botão de filtros (`#btnFiltros`), com todos os campos em coluna.
- Quem decide os campos de cada tela continua sendo `TS.renderFiltros` (pages.js) / `TS.filtrosClientes`; `montarFaixa()` (main.js) só muda de lugar. Filtro novo dentro do painel: acrescente a linha dele em `filtrosAtivos()` (main.js) com o mesmo rótulo do campo, senão ele não ganha etiqueta nem entra no contador. Texto de tela diz "nos filtros", nunca "na lateral".
- Com a largura inteira, parágrafo não pode virar linha comprida: `page-sub` e `card-sub` têm largura máxima; limite o texto, nunca a tabela. Teste: `tests/e2e/filtros-topo.spec.js`.

## Telas de ajustes (Configurações → loja e parecidas)
- Menu das seções na lateral (computador) / em cima (celular); conteúdo numa coluna (até ~900 px), **um cartão por assunto** (`section.cfg-bloco`): título, uma frase do que é, campos curtos lado a lado e o Salvar no rodapé do cartão.
- Ajuda longa de campo vira ⓘ ao lado do nome; explicação extensa fica em "Como funciona ▸" recolhido (`enxugar()` em `config.js` faz isso sozinho para o `campo(rótulo, controle, dica)` e os parágrafos além do primeiro).

## Formulários
- `campo(rótulo, controle, dica)`: rótulo em cima, dica `small` embaixo. Grupo de caixas de marcar = `fieldset` com `legend` (não `label` dentro de `label`).
- Regra fixa aparece **travada** (`disabled`) com 🔒 e o motivo — não escondida.
- Campo que redesenha a tela: `TS.aoConfirmar`.

## Celular (390 px)
- Nada passa da borda: `min-width: 0` em filhos de flex/grid com texto longo, `overflow-wrap: anywhere` em nomes. Formulário dentro de linha de tabela usa `position: sticky; left: 0` e a largura da tela.
- Toque: botões com área de pelo menos ~32 px; o ✨ flutuante não cobre ação.
- **Legibilidade (revisão com as regras do impeccable, 21/11/2026):** letra de pelo menos **12 px** (o `<small>` também: `max(12px, .833em)`; só ficam menores o "i" do ⓘ, as setas de ordenação e as grades densas de escala/horários/calendário); texto com contraste ≥ 4,5:1 contra o fundo real (o `--muted` foi escurecido para valer também no creme e nos avisos; cor nova de texto: confira o contraste); alvo de toque de pelo menos 24 px no celular (o ⓘ tem 16 px de desenho e 28 px de área pelo `::after`; links pequenos de ação ganham altura no celular). Emojis como marca, barra lateral de estado e cartões continuam como estão (decisão do dono). Medição: script de auditoria descrito no achado C-13 de `docs/rastreabilidade.md`.
- Confira com a skill `conferir-celular` (computador também: `--largura=1100`) e olhe o print antes de subir.

## Antes de subir uma tela mexida
- [ ] Usa as peças acima (cabeçalho, avisos, quadros, card, abas com contagem, `TS.table`).
- [ ] Cores por classe/token; nenhuma cor/hex nova no JS.
- [ ] Prints no computador e no celular conferidos (sem rolagem lateral, sem texto cortado, sem "null").

## Explicação longa
- Uma frase + `details.est-como` ("Como funciona ▸"). Tela com muitos blocos vira abas internas (`TS.seg`, como a Rentabilidade).
