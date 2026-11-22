# Painel Tea Shop — instruções para o Claude

Painel de vendas das lojas Tea Shop (substitui o Power BI). Responda sempre em **português do Brasil**.

## Como o projeto é organizado
- **Servidor:** Node/Express — `server.js` (rotas) e `src/*.js` (regras: estoque, inventário, NF-e, conta com a franquia, cobrança, orçamentos, checklist, IA…).
- **Tela:** JavaScript puro em `public/js/*.js`, namespace `TS`.
- **Coletor (robôs):** Python + Playwright em `coletor/` (AppNext, FIXE, Sistema de Pedidos).
- **Robô do WhatsApp:** serviço Node em `zap/` (opcional no compose, `--profile zap`); só conecta e envia o que o painel manda.
- **Apresentação:** `/apresentacao` mostra dados fictícios (`src/demo.js`, rotas `/api/demo/...`) e **nunca grava nem envia nada**.
- **Aplicativo e notificações:** o painel é instalável (`public/manifest.webmanifest`, `public/icones/`, `public/sw.js`) e avisa no aparelho com o painel fechado (Web Push: `src/webpush.js` cifra e entrega, `src/push.js` decide quem recebe, `src/push-api.js`, tela em `public/js/notificacoes.js`, no menu da pessoa).
- **IA:** ✨ Pergunte ao painel, diagnóstico do Início e revisão do pedido (`src/ia*.js`, `public/js/ia.js`).

Regras por parte do código ficam em `.claude/rules/` e carregam sozinhas ao mexer nos arquivos: `tela.md`, `visual.md` (padrão de layout: cabeçalho, avisos, quadros, card com abas e `TS.table`, cores por classe, celular), `coletor.md`, `ia.md`, `nfe.md`, `zap.md` (robô do WhatsApp).
Roteiros em `.claude/skills/`: `subir-versao`, `conferir-pr` (do PR até o dono poder instalar), `conferir-celular`, `nova-tela`, `nova-consulta-ia`, `testar-favorito` (favorito e robô do Sistema de Pedidos em páginas de mentira).
Hooks (`.claude/settings.json`): bloqueiam commit/push de segredos, limpam os restos dos testes de tela, lembram de atualizar as instruções (`lembrar-docs`), **bloqueiam o commit que mexe no favorito do carrinho ou no robô do Sistema de Pedidos se os testes deles falharem** (`testar-favorito`, roda a skill de mesmo nome sozinho) e, **depois de todo push, lembram de seguir a skill `conferir-pr` até o fim** (`conferir-pr`).

## Convenções de código
- Rota que grava exige o cabeçalho `X-Painel: 1`; ações importantes vão para a auditoria (`C.auditar`).
- Toda tela/rota nova precisa funcionar na apresentação: crie a rota `/api/demo/...` (dados fictícios ou resposta simulada, sem gravar).
- **Layout sempre no padrão** de `.claude/rules/visual.md`: lista com mais de ~5 itens é `TS.table` (busca, ordenação, páginas, cartão no celular), nunca pilha de cartões; cores por classe/token; conferir prints no computador e no celular.
- **Princípios de tela do dono** (lista completa no topo de `visual.md`): simplicidade, sem rolagem horizontal, seletor que reflete a tela, explicação (ⓘ) em toda coluna/quadro/opção, produto clicável com histórico, ícones nos dois sentidos, ação por linha, data que não grava a cada dígito.
- Permissões no servidor (`req.perfil`, `podeTela`, `podeClientes`, `podeCustos`), não só escondendo na tela.
- Testes: unidade em `tests/unit/*.test.js` (`node --test`); tela em `tests/e2e/*.spec.js` (Playwright, sempre na apresentação, projetos "computador" e "celular").
- **Matriz de rastreabilidade:** `docs/rastreabilidade.md` liga cada regra (código PERF-01, ESC-16…) ao código e ao teste que a cobre. Mudou ou criou regra: atualize a linha no mesmo PR (onde está, teste, cobertura); achou erro ou lacuna: registre nos Achados.
- A conta de clientes e campanhas roda também no servidor (`src/zapauto.js` carrega os arquivos de `public/js` listados em `ZA.ARQUIVOS`): esses arquivos não podem tocar na página ao carregar, e "hoje" é sempre `TS.hojeSP`/`TS.todayDay`. Regra de cliente ou campanha nunca é copiada para o servidor.
- **Grupo do produto:** uma definição só, em `public/js/grupoprod.js` (`TS.grupoProd`): o grupo do AppNext como o produto sai nas vendas (ex.: CHÁ VERDE AROMATIZADO), mostrado embaixo do nome nas listas de produtos (regra em `tela.md`). Nunca monte outro jeito de achar o grupo.
- **Foto do produto:** miniatura nas listas e foto grande ao tocar, por `public/js/fotoprod.js` (`TS.foto`), com as fotos do site da Tea Shop mostradas direto de lá (o painel guarda só o endereço). Imagem de fora só dos servidores de `HOSTS_FOTO` (`src/site.js`), os únicos liberados no cabeçalho de segurança: nunca afrouxe (regra em `tela.md`).
- **Uma definição por indicador:** faturamento da loja, vendas da meta, atendimentos (cupons únicos), projeção do mês e divisão da meta ficam em `public/js/contas.js`, usado pela tela (`TS.contas`, `TS.projecaoMes`) e pelo servidor (`require`). Nunca copie lista de grupos nem fórmula para outra tela. Comissão só com o período dentro de um mês (`TS.periodoUmMes`).
- **GET nunca muda estado** (gerar/fechar é POST com `X-Painel`); resposta de erro usa `C.msgErro(e)` (sem caminho de arquivo). Cache de leitura é por loja, nunca com dado já filtrado por perfil, e invalida pela data/tamanho do arquivo; a limpeza automática só apaga `envio/`, nunca XML de nota nem vendas.
- Durante os ajustes: `npm test` + só os testes de tela da parte mexida (`npx playwright test tests/e2e/ia.spec.js`, ou `-g "nome"`). A bateria completa é uma vez, antes de subir.

## Antes de cada commit
- Comece sempre com `git fetch origin main && git merge --ff-only FETCH_HEAD` (o dono também sobe mudanças).
- Faça commit e push de cada mudança (skill `subir-versao`). A instalação na VPS é pelo painel ("Atualizações do painel"): só versões que passam nos testes do GitHub entram. Depois é Ctrl+F5.
- **Instruções sempre em dia:** se a mudança cria regra, permissão, fluxo, tela ou convenção nova, atualize no mesmo PR o CLAUDE.md, a regra da área (`.claude/rules/`) ou a skill. O hook `lembrar-docs.js` avisa depois de cada commit quando a área mexida não teve a instrução atualizada.
- **Versões de segurança:** tag `DDMMAAAA-Claude` no `main` (passo 9 da skill `subir-versao`); o dono transforma em Release no GitHub.
- **Autorizado pelo dono (vale para todas as sessões):** o Claude pode abrir o PR e fazer o merge no `main` sozinho, sem perguntar, depois que os testes do GitHub do PR passarem (✓). Testes falharam: corrija antes; nunca faça merge com ✗ nem pule testes.

## Regras que não mudam
**Segredos e dados**
- Nunca suba para o Git: `.env` (inclui `ZAP_TOKEN`), `zap-work/` (sessão do WhatsApp), `config/lojas.json`, `config/coletor/*.env`, `config/ia.json`, `config/ia-mestra.key`, `config/push-vapid.json` (chave privada das notificações), `config/push.json` (aparelhos), `dados/`, backups, IDs reais.
- Senhas e chaves: o Claude nunca digita, nunca pede no chat e o painel nunca devolve para a tela (só os 4 últimos caracteres). Quem faz login no AppNext e no FIXE é o dono.
- Os e-mails pessoais do dono não vão para código, commit nem log.

**Perfis**
- Custo e margem nunca aparecem para vendedora.
- Vendedora não recebe dados de clientes. **Exceção (decisão do dono):** na Lista de espera ela busca e vê nome, CPF e celular do cliente para anotar e avisar.
- Gerente recebe as vendas de toda a loja mesmo sem as telas de vendas liberadas (decisão do dono); custo só com tela de custo liberada (Estoque, Preços, Rentabilidade, Notas, Pedido, Resultado) — inclusive no Inventário.
- Telas por perfil: a lista única fica em `src/telas.js` (grupos do menu, regra de cada perfil, padrão do gerente, regras fixas travadas em Configurações → Usuários). Tela nova entra lá; o teste `tests/unit/telas.test.js` avisa se faltar. Tela que o gerente escolhe precisa de `podeTela(req, '<id>')` no servidor.
- ⭐ Sugestões para o pedido (Estoque → Sugestões): vendedora sempre; gerente com a tela marcada (vem no padrão). A vendedora vê só o nome e a situação do produto (tem / pouco / acabou), nunca quantidade nem custo, e só as próprias sugestões; quem decide é quem tem a tela Pedido. A estrela não muda a conta do pedido sugerido.
- Conferência (caixa × painel, cancelados, saúde dos dados): gerente só com a tela marcada (não vem no padrão); ajustes só admin e franqueado. A pagar e exportação para o contador: quem tem a tela Resultado.
- Orçamento: só admin e franqueado.
- Falar com a franquia por e-mail (reajuste de custo, cobrança de devoluções e de fidelidade, envio automático): só admin e franqueado.
- **Franqueado = admin das lojas dele** (decisão do dono): na loja dele faz tudo o que o admin faz — configurações (AppNext, Sistema de Pedidos, comissão, dados da loja, FIXE, mensagens, IA), coletor ("Atualizar agora", "Sincronizar agora", importar histórico, cancelar, FIXE, robô do Sistema de Pedidos) e resumo diário (destinatários, teste, prévia e envio só das lojas dele). Nunca vê nem altera outra loja: toda rota confere a loja no servidor (`soGestor` + `lojaPermitida`, `req.lojas`).
- **Configuração guiada da loja** (`public/js/guia.js`, `src/guia.js`): no primeiro acesso do franqueado a uma loja com acesso faltando, abre sozinha (uma vez por loja) uma janela em 4 passos (AppNext, Sistema de Pedidos, FIXE e Gmail da loja), com pular, mais um **5º passo opcional: o CFOP da NF-e de venda e de devolução** (não conta como pendente; regra em `nfe.md`). Depois fica no botão "Configuração guiada" das Configurações e num lembrete do Início. Cada passo grava pela rota que já existe nas Configurações (nunca crie rota paralela para o mesmo acesso); o e-mail do FIXE tem de ser o Gmail da loja. Acesso novo obrigatório da loja entra como passo ali.
- Continua só do admin o que é da rede (não tem "loja dele"): criar/remover loja, horários e janela da rede, horário/ativação/token do Telegram/SMTP do resumo, vincular conversa nova do Telegram, classificação dos produtos, sistema, atualizações, backup, usuários admin/franqueado. Na tela do franqueado isso aparece travado (🔒) ou a aba fica oculta.
- IA (✨, análise do Início, revisão do pedido): só admin e franqueado.
- **Conversas do WhatsApp (Clientes → Conversas): só admin e franqueado** da loja (decisão do dono, por segurança). O texto das conversas fica guardado 12 meses em `dados/<loja>/conversas/` e some ao desconectar o WhatsApp; nunca vai para log nem auditoria. Detalhes em `zap.md`.

**AppNext, FIXE e NF-e** (detalhes em `coletor.md` e `nfe.md`)
- AppNext: só grava em fluxos aprovados pelo dono (clique no painel + confirmação, conferido item a item, auditado). Explorando: só olhar, nunca Concluir, Homologar ou Salvar.
- O robô conclui e homologa NF-e (venda e devolução) só depois da revisão, para admin, franqueado e gerentes com Notas fiscais.
- FIXE: só observar.
- Sistema de Pedidos: o favorito e o robô só colocam no carrinho (inclusive aceitar a "Venda Conjunta" em "Colocar Todos no Carrinho"); **nunca finalizam o pedido**. Carrinho salvo do painel (`pedido/rascunho.json`, 5 dias, um por loja) é só do painel: não mexe no site. Montar o carrinho não é fazer o pedido: o registro (`pedido/carrinho.json`) fica "falta confirmar" até a pessoa clicar em Confirmar ou Excluir (excluir devolve as ⭐ sugestões que tinham ido para "aguardando entrega"; sem carrinho para excluir, "Não fiz este pedido" no quadro das sugestões faz o mesmo).
- Pergunte antes de abrir o AppNext no Chrome. Ele guarda a sessão por aba: cada aba nova pede login ao dono.

**WhatsApp e testes**
- Envio manual: um clique por mensagem, sem insistir com o cliente.
- **Exceção (decisão do dono): robô do WhatsApp das campanhas.** Campanha marcada "Enviar pelo robô" sai sozinha pelo número da loja (serviço `zap/`), com todas as travas no servidor (`src/zapfila.js`, `src/zaplaco.js`): ritmo aleatório, horário e dias, máximo por dia do número, limite da campanha, intervalo da loja, quem não quer mensagens (inclusive quem responde "parar"), pausa sozinho após falhas. Admin, franqueado da loja e gerente com a tela Clientes conectam, ligam e configuram (decisão do dono: é a gerente quem lê o QR na loja; ela faz isso por Clientes → Campanhas → "Conectar e configurar"); vendedora nada. Log e auditoria sem o texto das mensagens e sem número completo (só os 4 últimos dígitos). **Campanha Resumo diário** (decisão do dono): a lista de Clientes → Hoje vira campanha diária do robô, só com os motivos escolhidos, uma mensagem por cliente (o motivo mais importante), assinada pela vendedora que mais o atende. Detalhes em `.claude/rules/zap.md`.
- **Regra forte (decisão do dono):** a equipe não consegue mandar mensagem pelo painel (Hoje, ficha, Campanhas) para quem já recebeu dentro do intervalo da loja, não quer ou está na fila do robô: o servidor confere antes de o WhatsApp abrir e explica o porquê. Sem liberação manual.
- Dados temporários de teste: apague depois.

**Validade do chá a granel (duas datas)**
- **Validade do chá aberto = 6 meses a partir da abertura** (decisão do dono; `MESES_ABERTO`, `PACOTE_KG` em `src/lotes.js`). A data da chegada e a validade digitada na chegada continuam guardadas, mas no lote com chá aberto a data que vale e que aparece (coluna Validade, `dias`, `faixa`) é a data final de consumo, sem teto pela validade do pacote. Lote só com pacote fechado: a validade do pacote (12 meses da chegada até alguém digitar a impressa). Toda data vem preenchida e pode ser editada; "voltar à data final de consumo" desfaz a edição.
- O painel não tem estoque próprio dos lotes: o total é sempre o do AppNext, distribuído entre os lotes (saída sai do mais antigo, como venda; entrada sem nota vira "saldo sem nota"; inventário por lote vale como a foto certa). A abertura segue a mesma conta: o que falta para um número inteiro de quilos está na lata.
- A data de abertura é estimada (ritmo de compra do chá, nunca antes da chegada) e guardada na primeira observação (`observarAberturas`, que roda depois de cada atualização dos dados, nunca numa leitura de tela). A equipe só corrige se souber o dia certo, ou usa "Abrir lote" na janela dos lotes do chá (`TS.validade.janelaPacotes`, a mesma ao clicar no nome do chá no Estoque e na Validade: aberto em cima, fechados embaixo), que marca a abertura hoje mesmo sem venda daquele pacote ou com outro pacote da mesma nota ainda na lata (`l.abertos` pode ter mais de um). Quando o pacote acaba, a abertura dele vai para o histórico do chá (`historico` em `validade/lotes.json`, 3 anos; mostrado na janela dos lotes). Quem usa `dias`/`faixa` do lote já recebe a data que vale; valor em risco e perdas contam só o que está na lata quando o prazo é o da abertura (`kgVence`).

**Notificações no aparelho (Web Push)**
- Sem biblioteca: `src/webpush.js` usa só o crypto do Node (RFC 8291 e RFC 8292). Mexeu na cifra ou no VAPID: confira de novo contra `http_ece` e `web-push` numa pasta de rascunho, sem adicioná-las ao projeto (o teste tem o vetor do RFC).
- Endereço de entrega: só https dos serviços conhecidos (`enderecoOk`). Nunca afrouxe: sem isso o servidor chama qualquer endereço.
- A permissão é conferida **a cada envio** (`podeReceber`: usuário ativo, com a loja e com a tela do assunto), não só ao ativar. Cada pessoa só vê e remove os próprios aparelhos; a tela nunca recebe chave nem endereço.
- Evento novo: um item em `TIPOS` (`src/push.js`, com a regra de quem pode) + `PUSH.avisarDepois({ tipo, loja, chave, titulo, texto, link, menos })` no ponto do evento. A `chave` identifica o evento e é marcada antes do envio (nunca repete). O texto segue as regras de perfil: sem custo, sem dado de cliente, sem texto de mensagem do WhatsApp.
- O service worker só mostra a notificação e abre o painel; não guarda página em cache (o painel sempre vem do servidor) e só aceita link começando com "/".
- Teste em navegador: `tests/e2e/aplicativo.spec.js` usa o Chromium completo com perfil normal (no "sem tela" enxuto e em janela anônima as notificações vêm bloqueadas).

## Pendências combinadas (o dono pediu para depois)
- Infusor obrigatório das mugs: **feito no carrinho** — quando o site abre a janela "Venda Conjunta", o favorito (`carrinho-site.js`) e o robô (`nextsoft_pedido.py`) clicam em "Colocar Todos no Carrinho" (decisão do dono) e o par mug → infusor fica guardado em `pedido/conjuntos.json`. **Falta:** o Pedido somar o infusor no valor e na proporção antes de montar o carrinho (usar `PED.conjuntos`). Mug Uki e a linha de pinturas não têm infusor. Decisão: não agrupar estampas nos indicadores.
- Conferência do boleto de royalties (ler o PDF e conferir os descontos de devoluções e da fidelidade).
- Reserva de estoque para encomenda (ligada ao Orçamento).
- A confirmar com o dono: a linha "campos de desconto no AppNext" no log da sincronização das notas; a primeira NF-e real emitida pelo painel ou pelo Orçamento.
