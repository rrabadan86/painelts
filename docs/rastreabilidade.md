# Matriz de rastreabilidade — Painel Tea Shop

Cada regra do painel tem um código, o lugar no código que a garante e o teste que a cobre.
Levantamento: 19/11/2026, lendo o código (servidor, telas, robôs) e todos os testes. Linhas de código citadas podem andar com o tempo; o nome da função é a referência estável.

**Como ler a coluna Cobertura**
- ✅ **coberta**: há teste que falha se a regra quebrar.
- 🟡 **parcial**: há teste, mas só de uma parte (ou só da função, não da rota do servidor).
- ❌ **sem teste**.

**Limite importante dos testes de hoje:** os testes de tela rodam na apresentação, que entra sempre como **admin**, e nenhum teste de unidade sobe o `server.js`. Por isso **nenhuma permissão por perfil (gerente, vendedora, franqueado) é testada na rota do servidor** — só nas funções isoladas. O primeiro passo da etapa 2 é um teste que sobe o servidor com um usuário de cada perfil.

Arquivos de teste: `tests/unit/*.test.js` (unidade, `node --test`) e `tests/e2e/*.spec.js` (tela, Playwright). Abreviações: `esc` = `escala-horario.spec.js`, `blind` = `blindagem.test.js`.

---

## 1. Perfis e permissões (PERF)

| Código | Regra | Onde está garantida | Teste | Cobertura |
|---|---|---|---|---|
| PERF-01 | Só entra quem está ativo, no prazo e com loja; o perfil vem do cadastro, nunca da tela | `server.js` middleware de login (~721-745), `config.js` `expirado`/`lojasDoUsuario` | — | ❌ |
| PERF-02 | Só existem 4 perfis (admin, franqueado, gerente, vendedor) | `config.js` (~24, 86), `admin-api.js` (~753) | — | ❌ |
| PERF-03 | Cada pessoa só lê e grava nas lojas dela | `req.lojas.find(...)` em todas as rotas; `admin-api.js` `lojaPermitida` | — | ❌ |
| PERF-04 | Vendedora nunca recebe custo nem margem do servidor | `/api/dados` sem custo (`sources.js`); `podeTela`/`podeCustos`; validade `semCusto`; inventário `paraUsuario` | `inventario.test`, `lotes.test`, `ia.test` (funções) | 🟡 |
| PERF-05 | Gerente só vê custo com uma tela de custo liberada (Rentabilidade, Estoque, Preços, Notas, Pedido ou Resultado) | `server.js` `podeTela`/`podeCustos` | `permissoes-telas.test` (`/api/estoque` 403 para gerente sem tela de custo e vendedora) | 🟡 |
| PERF-06 | Vendedora não recebe dados de clientes | `filtrarPorPerfil`, `podeClientes`, contatos, campanhas | `ia.test` (só a IA) | 🟡 — **furo: Lista de espera, ver A-01** |
| PERF-07 | Gerente só recebe dados de clientes com a tela Clientes | `podeClientes`, `perfilDados` | — | ❌ — **furo: conta com a franquia, ver A-02** |
| PERF-08 | Vendedora não vê nome nem dados das colegas ("COLEGA N") | `filtrarPorPerfil` (~156-209) | — | ❌ — **furo: Lista de espera, ver A-01** |
| PERF-09 | Orçamento: só admin e franqueado | `lojaOrc` (`podeContabilidade`) | `orcamentos.test`, `voltar.spec` (como admin) | ❌ (permissão) |
| PERF-10 | Enviar reajuste à franquia: só admin e franqueado | `podeReajuste` | `reajuste.spec` (como admin) | ❌ (permissão) |
| PERF-11 | Só o admin dispara o coletor (Sincronizar agora, rodar, robôs) | `/api/script`, `soAdmin`, notas/sincronizar, robô do pedido | — | ❌ |
| PERF-12 | IA (✨, análise, revisão do pedido): só admin e franqueado | `IA.podeUsar` + rotas `/api/ia/*` | `ia.test` "só admin e franqueado usam" | 🟡 (função sim, rota não) |
| PERF-13 | A IA só recebe as ferramentas que o perfil pode; sem custo em "todas as lojas" | `server.js` (~1621), `iaprompts.js` `ferramentas` | `ia.test` "ferramentas por perfil" | 🟡 |
| PERF-14 | NF-e (rascunho/emitir/parceiro): admin, franqueado e gerente com Notas fiscais | `lojaNfe` | — | ❌ — **furo: devolução, ver A-03** |
| PERF-15 | Conta com a franquia: admin, franqueado, gerente com Notas; envio automático só admin/franqueado | `lojaCF` | `contafranquia.test` (lógica) | ❌ (permissão) |
| PERF-16 | Configurações: admin e franqueado; o franqueado configura tudo das lojas dele (AppNext, Sistema de Pedidos, regras de comissão, dados da loja); criar/remover loja, coletor, horários, resumo diário, sistema e backup: só admin | `admin-api.js` roteador + `soAdmin`/`soGestor` + `lojaPermitida`; `/api/pedido/acesso` | `permissoes-telas.test` "franqueado configura tudo da loja dele" | 🟡 |
| PERF-17 | Franqueado só administra gerentes e vendedores das próprias lojas; ninguém muda o próprio perfil/prazo | `admin-api.js` `usuariosVisiveis`, rotas de usuário | — | ❌ |
| PERF-18 | Vendedor: uma loja e um nome de vendedor; gerente: pelo menos uma tela; admin: loja `*` | `admin-api.js` (~760-771) | — | ❌ |
| PERF-19 | Gerente só usa as telas marcadas em Configurações → Usuários; a lista única de telas (grupos do menu, regra de cada perfil, regras fixas travadas) fica em `src/telas.js` | `telas.js`; `config.js` `TELAS`/`TELAS_GERENTE_PADRAO`; `podeTela` nas rotas; menu em `main.js`; `config.js` (tela) | `telas.test` (tela nova fora da lista avisa; regras fixas); `permissoes-telas.test` (servidor de verdade por perfil); `config-telas.spec` | 🟡 — telas de vendas só escondidas, ver D-05 |
| PERF-20 | Envios à contabilidade: só admin e franqueado; e-mail geral só admin | `server.js` (~2311-2372) | — | ❌ |
| PERF-21 | Feriados trabalhados: gerente com Comissionamento; ajuste de escala: gerente com Mapa | `/api/feriados`, `/api/escala-ajustes` | `permissoes-telas.test` (escala: gerente sem Movimento e escala 403, com 200) | 🟡 |
| PERF-22 | Config. de estoque, classe e "consultar site": admin/franqueado; classificação da rede: só admin | `server.js` (~1742-1785, 2376) | — | ❌ |
| PERF-23 | Pedido sugerido/obrigatório/carrinho: admin, franqueado, gerente com Pedido | `server.js` (~1794, 2198-2242) | `ia.spec` (como admin) | ❌ (permissão) |
| PERF-24 | Inventário: vendedora conta às cegas, sem custo; não envia, não zera, não desfaz | `inventario.js` `paraUsuario`; rotas `/api/inventario` | `inventario.test` "cega para vendedora" | 🟡 |
| PERF-25 | Validade: custo do lote só para quem vê custos | `semCusto` | `lotes.test` (lógica) | ❌ (rota) |
| PERF-26 | Lista de espera: vendedora sempre; gerente com a tela; modelo da mensagem não é da vendedora | middleware `/api/espera` | `regras.spec` (como admin); `permissoes-telas.test` (vendedora 200; gerente sem a tela 403; padrão inclui) | ✅ |
| PERF-27 | Checklist: todos marcam; só quem não é vendedora edita a lista | `server.js` (~1504-1518) | `checklist.test` (lógica) | ❌ (permissão) |
| PERF-28 | Contatos e campanhas de WhatsApp só para quem vê clientes | `server.js` (~779-885) | `regras.spec` (como admin) | ❌ (permissão) |
| PERF-29 | A apresentação entra como admin e nunca grava | `server.js` (~428-430) | todos os e2e | ✅ |

## 2. Segurança, segredos, auditoria e apresentação (SEG)

| Código | Regra | Onde está garantida | Teste | Cobertura |
|---|---|---|---|---|
| SEG-01 | Segredos e `dados/` nunca vão para o Git | `.gitignore`; hook `.claude/hooks/segredos.js` | — | ❌ — hook não cobre `config/notificacoes.json`, ver C-09 |
| SEG-02 | Chave da IA criptografada; só os 4 últimos caracteres voltam | `ia.js` `cifrar`/`situacao` | `ia.test` "chave… nunca devolvida"; `ia.spec` "chave fica em Configurações" | ✅ |
| SEG-03 | Senhas SMTP/Gmail e token do Telegram nunca voltam (só "tem senha") | `notificacoes.js` `publico`/`publicoLoja` | — | ❌ |
| SEG-04 | Senhas do AppNext, FIXE e Sistema de Pedidos nunca voltam | `admin-api.js` `/estado`; `pedido.js` `acesso()` | — | ❌ — senha do Pedido fica no disco ao excluir loja, ver C-08 |
| SEG-05 | Token de upload comparado em tempo constante | `server.js` `safeEq` (~370-388) | — | ❌ |
| SEG-06 | Senhas com scrypt, conferidas em tempo constante | `config.js` `confereSenhaAsync` | `blind` "scrypt assíncrono em tempo constante" | 🟡 |
| SEG-07 | Cookie de sessão assinado, httpOnly, sameSite, secure; cai ao trocar senha | `server.js` (~41-62, 351) | — | ❌ |
| SEG-08 | Limite de tentativas no login (e na chave da IA, perguntas, CNPJ) | `server.js` `tooMany`/`falhou` | — | ❌ |
| SEG-09 | Troca de senha: 8-200 caracteres, diferente da atual, derruba outras sessões | `server.js` (~737-772) | — | ❌ |
| SEG-10 | Cabeçalhos de segurança e CSP restrita | `server.js` (~253-263) | — | ❌ |
| SEG-11 | Login/sair/trocar senha só da mesma origem | `mesmaOrigemForm` | — | ❌ |
| SEG-12 | Toda rota que grava exige `X-Painel: 1` | middlewares e rotas (todas conferidas) | — | ❌ — exceção: GET que desfaz inventário, ver A-04 |
| SEG-13 | Ações importantes vão para a auditoria | `C.auditar` (dezenas de rotas) | `blind` (só grava/lê uma linha) | 🟡 — faltam algumas ações, ver C-01 |
| SEG-14 | Apresentação nunca grava nem envia (servidor) | rotas `/api/demo/*`, curinga 404 | `ia.spec`, `reajuste.spec`, `esc` ("nada é salvo") | 🟡 |
| SEG-15 | Na tela da apresentação, gravações são barradas no navegador | `core.js` troca do `fetch` | `esc`, `voltar.spec` (indireto) | 🟡 |
| SEG-16 | Dados guardados no aparelho: por pessoa e loja, 7 dias, apagados ao sair/entrar | `main.js` `Guardados`; `login.js` | `guardados.spec` | 🟡 (falta Sair, troca de pessoa, 7 dias) |
| SEG-17 | Dado de cliente não vai para localStorage/IndexedDB fora das regras do SEG-16 | uso atual conferido | — | ❌ |
| SEG-18 | Permissão no servidor, não só escondendo na tela | ver PERF | `ia.test` | 🟡 |
| SEG-19 | E-mails pessoais do dono fora de código, commits e logs | nada automático | — | ❌ |

## 3. IA (IA)

| Código | Regra | Onde está garantida | Teste | Cobertura |
|---|---|---|---|---|
| IA-01 | Só admin e franqueado usam (ver PERF-12) | `IA.podeUsar` + 3 telas | `ia.test` | 🟡 |
| IA-02 | Servidor só oferece a ferramenta se o perfil pode | `iaprompts.js` `ferramentas` | `ia.test` "ferramentas por perfil" | ✅ (função) |
| IA-03 | O navegador confere `pode` de novo antes de executar | `ia.js` `executar` | — | ❌ |
| IA-04 | A IA só consulta: nenhuma ferramenta grava | `iaprompts.js`; `conferirMensagens` | `ia.test` (recusa `tool_use` do usuário) | 🟡 (falta fixar a lista de ferramentas) |
| IA-05 | Análise do dia: uma por loja por dia, compartilhada | `server.js` diagnóstico; `ia.js` `umaVez` | `ia.test` "gerado uma vez por arquivo"; `ia.spec` "análise do dia" | 🟡 |
| IA-06 | Chave por loja, AES-256-GCM, fora do Git | `ia.js` | `ia.test` | ✅ |
| IA-07 | Chave nunca volta (só 4 últimos) | `ia.js` `situacao` | `ia.test`, `ia.spec` | 🟡 (rota não) |
| IA-08 | Configurar chave: admin/franqueado, X-Painel, auditoria | `server.js` (~1577-1611) | `ia.spec` (apresentação) | 🟡 |
| IA-09 | Teto do mês por loja | `ia.js` `tetoValido`/uso | `ia.test` "uso do mês e teto" | ✅ |
| IA-10 | Nunca forçar ferramenta (`tool_choice` auto + nova tentativa) | `ia.js` `comFerramenta` | `ia.test` "não forçam a ferramenta" | ✅ |
| IA-11 | Apresentação e testes: resposta simulada | `ia.js` `simular`; `/api/demo/ia/*` | `ia.spec` (vários) | ✅ |
| IA-12 | `consultar_compras` lê as notas de entrada, não as vendas | `ia.js` `consultarCompras` | `ia.spec` "margem… notas de entrada" | ✅ |
| IA-13 | Erro de rede: espera, tenta uma vez, mensagem em português | `ia.js` `iaApi` | `ia.spec` "conexão que cai" | 🟡 |
| IA-14 | Histórico por pessoa e loja, sem a lista de clientes | `iaconversas.js` | `ia.test` "histórico de conversas" | ✅ |
| IA-15 | Clientes só com primeiro nome + inicial | `ia.js` `consultarClientes` | — | ❌ |
| IA-16 | Auditoria e limite de pedidos da IA | `server.js` | — | ❌ |

## 4. NF-e, devolução e notas de entrada (NFE)

| Código | Regra | Onde está garantida | Teste | Cobertura |
|---|---|---|---|---|
| NFE-01 | Robô conclui/homologa só depois do teste conferido (total igual, até 2 h) | `nfe.js` `emitir`; `devolucao.js`; robô | `nfe.test` "emitir… só a partir de um teste ok"; `devolucao.test` "emitir só depois de um teste" | 🟡 — venda não exige o total, ver A-06 |
| NFE-02 | Só admin, franqueado e gerente com Notas fiscais | `lojaNfe`; `lojaDev` | — | ❌ — **furo, ver A-03** |
| NFE-03 | Toda ação (teste, rascunho, emitir) é auditada | `server.js` | — | ❌ — faltam resultado do robô na devolução e reenvio |
| NFE-04 | Pedido repetido para a mesma nota devolve 409 | `server.js`; `coletor.py` | — | ❌ |
| NFE-05 | Sem coletor ligado: erro, nunca fingir que mandou | `server.js` | — | ❌ — devolução responde 200 com erro dentro |
| NFE-06 | Robô confere itens/preços/total e para sem salvar se não bater | `nextsoft_nfe.py` | `devolucao.test` (só preenchimento) | 🟡 |
| NFE-07 | `SIMULAR=1` faz tudo menos o clique final | `nextsoft_nfe.py`; `nfe.js` | `nfe.test` "rascunho… lê o resultado" | 🟡 |
| NFE-08 | Na apresentação nada vai para o robô | `core.js`; telas escondem o fluxo | `telas.spec` (só abre) | 🟡 |
| NFE-09 | Lista só NF-e modelo 55 (NFC-e fica em Cupons) | `nfsaida.js` `ehNFe` | `nfsaida.test` (3); `regras.spec` "DANFE" | ✅ |
| NFE-12 | NF-e emitida pelo painel: pede ao coletor o XML do dia e a linha mostra DANFE/XML quando chega (senão "⏳ chegam na próxima coleta") | `server.js` `/api/nfe`; `nfe.js` `marcarXml`; `nfsaida.js` `chaves`, tela `docsNfe` | `nfe.test` "chaves()", "autorizada" | 🟡 — tela sem teste de tela (formulário não abre na apresentação) |
| EST-47 | Venda perdida por falta: zerado que vendeu em até 90 dias; R$/dia = média dos 60 dias antes da última venda (o painel não guarda saldo diário); sem histórico → "—" | `public/js/ruptura.js` `perda`; `server.js` `/api/estoque` (`espera`: só contagem) | `ruptura.test`; `ruptura.spec` | ✅ |
| EST-48 | Dinheiro sobrando: "Dura" > 2× (entrega + pedido); sobra a custo acima do alvo ou do mínimo | `public/js/ruptura.js` `excesso` | `ruptura.test`; `ruptura.spec` | ✅ |
| COMP-01 | Compras × vendas do mês: compras = notas concluídas pelo dia de entrada; teto = `comprasTetoPct` (padrão 32%, 1–90, admin/franqueado, auditado) × projeção das vendas; cabe = teto − comprado − pedido | `public/js/comprasvendas.js`; `src/estoque.js` `cfg`; `pedido.js`, `dre.js`; `src/demo-compras.js` | `comprasvendas.test`; `compras-reajustes.spec` | ✅ |
| PRC-40 | Efeito do reajuste: 30 × 30 dias por dia (qtd, receita, lucro), descontando o movimento da loja; Bom/Ruim/Igual (±2%); cedo demais e sem comparação com o motivo | `public/js/efeitopreco.js` `avaliar`, `reajustesDe`; `precos.js` | `efeitopreco.test`; `compras-reajustes.spec` | ✅ |
| EQP-30 | Venda por hora = vendas ÷ horas líquidas da escala (planejada, não ponto); sem escala ou sem par de nome → "—" | `public/js/equipe.js` `rendimento`, `casarNomes`; `mapa.js` `turnosDoPeriodo` | `equipe.test`; `equipe-fidelidade.spec` | ✅ |
| EQP-31 | Ficha da equipe só para a gestão; lucro só com custo; % CPF só com Clientes; nada vai para a vendedora | `equipe.js`; `server.js` `filtrarPorPerfil` | `equipe.test`; `equipe-fidelidade.spec` | ✅ |
| FID-20 | Retorno do programa: 3 comparações (programa × fora, resgatou × não, antes × depois), mínimo de 20 clientes, só agregado, custo só para quem vê custo | `public/js/fidretorno.js` | `fidretorno.test`; `equipe-fidelidade.spec` | ✅ |
| NFE-10 | Cadastro de parceiro novo pelo robô | `nfe.js`; `nextsoft_nfe.py` | `nfe.test` "parceiro novo"; `consulta-cnpj.spec` | 🟡 — **defeito: robô recusa a ação, ver A-05** |
| NFE-11 | BrasilAPI: CNPJ/CEP preenche só campos vazios | `brasilapi.js`; `orcamento.js` | `brasilapi.test` (3); `consulta-cnpj.spec` (2) | ✅ |

## 5. Dinheiro com a franquia (FRQ)

| Código | Regra | Onde está garantida | Teste | Cobertura |
|---|---|---|---|---|
| FRQ-01 | Reajuste à franquia: só admin e franqueado | `podeReajuste` | `reajuste.spec` (admin) | 🟡 |
| FRQ-02 | Itens do reajuste conferidos (até 100, custos positivos, texto limpo) | `cobranca.js` `conferirItensReajuste` | `reajuste.test` | ✅ |
| FRQ-03 | Gráficos: só PNG de verdade, ligados aos itens, embutidos por cid | `cobranca.js` `conferirGraficos` | `reajuste.test`; `reajuste.spec` | ✅ |
| FRQ-04 | Reajuste registrado (destinatários) e auditado | `server.js`; `cobranca.js` `registrar` | `cobranca.test` (genérico) | 🟡 |
| FRQ-05 | Reajuste na apresentação: simulado | `/api/demo/reajuste` | `reajuste.spec` | ✅ |
| FRQ-06 | Cobrança por e-mail: revisar antes, enviar com um clique, auditada | `server.js` `enviarCobranca` | `cobranca.test` (2); `voltar.spec` "Cobrar a franquia" | 🟡 (rota não) |
| FRQ-07 | Cobrança automática: dia/hora, uma vez por mês e tipo | `cobranca.js` `devidoAgora`/`marcarAuto` | `cobranca.test` "envio automático" | 🟡 — perde o mês se o servidor parar no dia, ver C-05 |
| FRQ-08 | Créditos: devolução compensada inteira pelo desconto; atrasada após 30 dias | `contafranquia.js` | `contafranquia.test` (3); `voltar.spec` (2) | ✅ |
| FRQ-09 | Ações à mão e royalties: X-Painel e auditoria | `server.js` | (lógica) | 🟡 |
| FRQ-10 | Prêmios de fidelidade: 50% do custo, conferidos com o royalty | `contafranquia.js` | `contafranquia.test`; `voltar.spec` (2) | ✅ |
| FRQ-11 | Conta com a franquia na apresentação: nada salvo nem enviado | `/api/demo/conta-franquia` | `voltar.spec` | ✅ |
| FRQ-12 | Salvar a cobrança automática grava os destinatários (loja no corpo ou no endereço) | `lojaCF` | `config-sem-null.spec` (só a tela) | 🟡 |

## 6. Coletor e robôs (COL)

| Código | Regra | Onde está garantida | Teste | Cobertura |
|---|---|---|---|---|
| COL-01 | Só o admin dispara o coletor | ver PERF-11 | — | ❌ — `/api/script` sem auditoria |
| COL-02 | AppNext só grava em fluxo aprovado (clique + confirmação + conferência + auditoria) | NF-e, devolução, inventário | `inventario.test` "envio ao AppNext"; `nfe.test` | 🟡 |
| COL-03 | Explorando o AppNext: nunca Concluir, Homologar ou Salvar | robôs `nextsoft_*` | — | ❌ (garantido só por leitura) |
| COL-04 | FIXE: só observar | `fixe_saldos.py`, `fixe_export.py` | `regras.spec` (conta do painel) | ❌ (robô) |
| COL-05 | Painel ↔ coletor com token; credenciais fora do Git | `coletor.py`; `coletor.js` | — | ❌ |
| COL-06 | Saídas JSON do robô mantêm os campos que o painel lê | `nextsoft_nfe.py` ↔ `nfe.js` | `nfe.test`, `devolucao.test` (JSON escrito à mão) | 🟡 |
| COL-07 | Logs sem senha, token, CPF completo ou e-mail pessoal | `coletor.py` | — | ❌ — robô do parceiro loga CPF/CNPJ, ver A-05 |

## 7. Escala, horários, feriados e férias (ESC)

| Código | Regra | Onde está garantida | Teste | Cobertura |
|---|---|---|---|---|
| ESC-01 | Escala em blocos de 10 minutos | `mapa.js` (B=10) | `esc` "intervalo… à parte", "atalhos Abre/Meio/Fecha" | ✅ |
| ESC-02 | Quem abre começa na hora exata da abertura e quem fecha sai no fechamento (09:40, 21:50) | `faixaDia`, `paraTurno` | `esc` "abertura às 09:40" | 🟡 (só rodízio) |
| ESC-03 | Intervalo pela jornada: >8h "intervalo"; 4-8h "intervaloAte8"; ≤4h sem | `intervaloMin` | `esc` "intervalo… à parte" | ✅ |
| ESC-04 | Aviso quando o intervalo fica abaixo da CLT | `abaixoClt` | `esc` (mesmo teste) | ✅ |
| ESC-05 | Dia curto: encurta o trabalho, não o intervalo; >4h sempre com intervalo | `intervaloNoTurno` | `esc` "dia curto…", "turno curto de domingo…" | ✅ |
| ESC-06 | Turno digitado ou cortado por feriado: intervalo pela jornada real | `pausaDoTurno` | `esc` "turno curto de domingo…" | 🟡 |
| ESC-07 | Jornada = carga semanal ÷ dias, em blocos de 10 min | `mapa.js` | `esc` (470 e 590 min) | ✅ |
| ESC-08 | Pessoas por hora = pico ÷ atendimentos por pessoa; nunca abaixo do mínimo do dia | `necessidade`, `grade` | — | ❌ |
| ESC-09 | Feriados fora do mapa de calor | `datasFeriado` | — | ❌ |
| ESC-10 | No máximo N de folga no mesmo dia | `mapa.js` maxFolgaDia | — | ❌ |
| ESC-11 | Folgas de domingo giram igualmente | `montarRodizio` `domDe` | `esc` (indireto) | 🟡 — corte do ciclo com 9+ pessoas, ver B-05 |
| ESC-12 | Folga no domingo puxa a segunda (mesma semana, ou a seguinte com semana Seg–Dom) | `montarRodizio` | `esc` "semana começando na segunda…" | 🟡 (Dom–Sáb sem teste) |
| ESC-13 | Folga fixa; domingo não pode ser folga fixa; automático nos dias de menor movimento | `montarRodizio`; `validarOperacao` | — | ❌ |
| ESC-14 | Preferência manhã/noite respeitada sem descobrir a loja | `encaixe`, `trocarPorPreferencia` | — | ❌ |
| ESC-15 | Dia fechado: ninguém trabalha; domingo fechado: sem rodízio | `mapa.js` | — | ❌ |
| ESC-16 | Semana começa no domingo ou na segunda | `semanaSeg`, `inicioDe` | `esc` (2 testes) | ✅ |
| ESC-17 | "Semana 1" do rodízio a partir da data escolhida | `escalaDoMes` | — | ❌ |
| ESC-18 | Horário do feriado: data > padrão de feriados > dia da semana | `TS.horarioFeriado` | `esc` "horário do feriado no cabeçalho" (só formato) | 🟡 |
| ESC-19 | Férias aparecem na escala e travam o dia | `escalaDoMes` | — | ❌ — ligação pelo nome, ver B-06 |
| ESC-20 | Feriado: fechado = Fechado; com horário = turno cortado; <1h = folga | `escalaDoMes` | `esc` (só `pausaDoTurno` e cabeçalho) | 🟡 |
| ESC-21 | Ajuste manual trava a escolha e refaz as colegas; salva com permissão e auditoria | `mapa.js`; `/api/escala-ajustes` | `esc` "atalhos Abre/Meio/Fecha" | 🟡 — passa por cima de férias, ver B-03 |
| ESC-22 | Repetir ajustes nos mesmos dias da semana (sem feriados e férias) | `mapa.js` | — | ❌ |
| ESC-23 | Replicar/trazer ajustes de mês seguindo o rodízio | `mapa.js` `replicar` | — | ❌ |
| ESC-24 | Horas líquidas = total − intervalo (dia, semana, mês) | `mapa.js` | `esc` "horas líquidas por dia…" (1ª célula) | 🟡 |
| ESC-25 | Exportar escala em PDF | `mapa.js` `imprimir` | — | ❌ |
| ESC-26 | Cobertura por hora e horas descobertas | `mapa.js` | `esc` "horas descobertas contam o tempo certo" | ✅ (corrigido hoje) |
| ESC-27 | Alerta do dia: menos gente que o mínimo | `mapa.js` | — | ❌ — alerta falso em feriado fechado com férias, ver B-04 |
| ESC-28 | Simular horário e equipe; só quem pode salva, validado no servidor | `cartaoAjustes`; `validarOperacao` | `esc` "digitar a hora inteira…" | 🟡 |
| ESC-29 | Feriados nacionais (Páscoa móvel) e locais | `feriados.js` | — | ❌ |
| ESC-30 | Horas de feriado trabalhadas (para o fechamento) | `feriados.js` `horasAuto` | — | ❌ |
| ESC-31 | Campo de hora aplica ao sair, sem perder o foco (`TS.aoConfirmar`) | `main.js` | `esc` "digitar a hora inteira…" | 🟡 (computador) |

## 8. Equipe, metas e comissão (EQP)

| Código | Regra | Onde está garantida | Teste | Cobertura |
|---|---|---|---|---|
| EQP-01 | Meta do mês: digitada > automática (ano anterior + %) > padrão | `core.js` `metaCalc`; `indicadores.js` `metaMes` | — | ❌ — duas cópias que divergem, ver B-08 |
| EQP-02 | Meta individual = meta da loja ÷ quem vende, com férias no dia | `rules.js` `metasIndividuais` (+ cópia no servidor) | — | ❌ |
| EQP-03 | Comissão por categoria e faixa (≥120%, ≥100%, abaixo); modo simples | `rules.js` | — | ❌ |
| EQP-04 | "Sem meta", "não recebem comissão", "sem vendedor" | `rules.js` | — | ❌ |
| EQP-05 | Premiação por TKM, IPA e PMA | `rules.js` | — | ❌ |
| EQP-06 | Bônus sobre outros vendedores | `rules.js` | — | ❌ |
| EQP-07 | Rateio igual do total de comissões | `rules.js` | — | ❌ |
| EQP-08 | Meta de hoje = falta do mês ÷ dias abertos que faltam; parte de cada vendedora | `clientes.js` `cartaoMetaDia` | `voltar.spec` "Hoje: meta do dia" (só aparece) | 🟡 |
| EQP-09 | Férias: datas válidas, até 300 períodos, auditadas | `admin-api.js` | `config-sem-null.spec` (só abre) | ❌ |
| EQP-10 | Vendedora não recebe escala, equipe nem horas das colegas | `filtrarPorPerfil` | — | ❌ |

## 9. Estoque, inventário, lotes e pedido (EST)

| Código | Regra | Onde está garantida | Teste | Cobertura |
|---|---|---|---|---|
| EST-01 | Estoque em tabela única; busca em todos os produtos | `estoque.js` | `estoque.spec` | ✅ |
| EST-02 | Quadros do topo filtram a tabela | `estoque.js` | `estoque.spec` (só "parado") | 🟡 |
| EST-03 | Quanto repor: previsão × (entrega + cobertura) − estoque, com época do ano | `estoque.js` (~841-899) | — | ❌ |
| EST-04 | Situação: acabou / falta antes da entrega / abaixo do mínimo / pedir / OK | `estoque.js` | — | ❌ |
| EST-05 | Estoque parado: com saldo e sem venda há N dias | `estoque.js` | `estoque.spec` (etiqueta) | 🟡 |
| EST-06 | Mínimo sugerido × mínimo do AppNext | `estoque.js` | — | ❌ |
| EST-07 | Nota lançada depois da planilha de estoque | `estoque.js` | `estoque.spec` | 🟡 — conta notas que não são de compra |
| EST-08 | Valor do estoque a custo (só com saldo e custo) | `estoque.js` | — | ❌ |
| EST-09 | Consumo de saco e etiqueta pelos pacotes vendidos | `estoque.js` `consumo` | — | ❌ |
| EST-10 | Baixar pedido em CSV | `estoque.js` | — | ❌ |
| EST-11 | Limites da configuração de estoque | `src/estoque.js` `validarCfg` | — | ❌ |
| EST-20 | Lote e validade só no chá a granel; faixas de validade | `lotes.js` | `lotes.test` (2) | ✅ |
| EST-21 | Saldo dos lotes pela ordem de entrada | `lotes.js` | `lotes.test` | ✅ |
| EST-22 | Editar nº do lote e validade | `lotes.js` | `lotes.test` "edição do nº do lote…" | ✅ |
| EST-23 | "Deste lote ainda tem X"; soma dos lotes = estoque | `lotes.js` | `lotes.test` (2) | ✅ |
| EST-24 | Contagem por lote vira ponto de partida | `lotes.js`; `inventario.js` | `regras.spec` (tela) | 🟡 |
| EST-25 | Valor em risco (vence em menos de 60 dias) | `lotes.js` | `lotes.test` | ✅ |
| EST-26 | Lote pendente na nota de entrada | `lotes.js` | `lotes.test` (2); `regras.spec` | ✅ |
| EST-27 | Trava de estoque nas mensagens | `lotes.js` `disponivel` | `lotes.test`; `regras.spec` | ✅ |
| EST-28 | "Vender primeiro" na Promoção | `validade.js` | `regras.spec` | 🟡 |
| EST-30 | Catálogo do inventário | `inventario.js` | `inventario.test` | ✅ |
| EST-31 | Como se conta (kg com casas, unidade inteira) | `inventario.js` | `inventario.test`; `regras.spec` | ✅ |
| EST-32 | Contagem cega para a vendedora | `inventario.js` | `inventario.test` | 🟡 |
| EST-33 | Item não contado vai como 0 | `inventario.js` | `inventario.test` (2) | ✅ |
| EST-34 | "Zerar os não listados" dentro do recorte | `inventario.js` | `inventario.test` (2); `regras.spec` | ✅ |
| EST-35 | Planilha no modelo do AppNext | `inventario.js` | `inventario.test` | ✅ |
| EST-36 | Desfazer o inventário | `inventario.js` | `inventario.test` | ✅ (lógica) — rota é GET, ver A-04 |
| EST-37 | Envio pelo robô só marca importado com resultado real | `inventario.js` | `inventario.test` | ✅ |
| EST-38 | Etapas: gerar planilha, importado, reabrir | `inventario.js` | `regras.spec` | 🟡 |
| EST-41 | Reabrir para contar só no mesmo dia (Brasília) em que a contagem foi aberta; depois, a tela avisa e pede contagem nova (decisão do dono) | `inventario.js` `podeReabrir` (servidor) e `mesmoDia` (tela) | `inventario.test` "reabrir para contar: só no mesmo dia"; `regras.spec` "reabrir para contar só no mesmo dia" | ✅ |
| EST-42 | ⭐ Sugestões: vendedora sempre e gerente com a tela marcada (padrão inclui) sugerem produto; coluna "Estoque agora": quantidade para quem decide o pedido, só tem/pouco/acabou para quem sugere para o próximo pedido; a vendedora vê só nome e situação (tem/pouco/acabou) e só as próprias | `sugestoes.js` (`buscar`, `lista`); `server.js` `/api/sugestoes` | `sugestoes.test` "situação…", "pedido…"; `sugestoes.spec`; `permissoes-telas.test` | ✅ |
| EST-43 | Sugestão com estoque na loja exige justificativa (chá a granel < 700 g não) | `sugestoes.js` `criar` | `sugestoes.test` "criar…"; `sugestoes.spec` | ✅ |
| EST-44 | A estrela não muda a conta do pedido; quem faz o pedido decide (Adicionar / Não agora com motivo) | `pedido.js` `cartaoSugestoes`; `PUT /api/pedido/sugestoes/decisao` (tela Pedido) | `sugestoes.spec`; `permissoes-telas.test` (sem a tela Pedido: 403) | ✅ |
| EST-45 | Sugestão no pedido fica "aguardando entrega" (a estrela continua); valem notas da TSB FRANQUIAS emitidas a partir do dia do pedido; a primeira a entrar no AppNext + as que entrarem até 5 dias depois (pela data de entrada) formam a entrega: produto nelas → "chegou na loja" e a estrela sai; sem ele → "não veio no pedido" e volta; chegou depois em nota da franquia → "chegou" também; sem nota em 30 dias → volta. Recusa do site no carrinho → "não foi possível pedir" e volta. Sem estoque no site é automático; não entrou guarda o motivo; histórico guardado (decisão do dono) | `sugestoes.js` `fechar`/`avaliarNotas`/`resultadoCarrinho`/`visto`; `server.js` (a cada 15 min, ao abrir e no fim do carrinho) | `sugestoes.test` "entrega…" (3), "pedido…"; `sugestoes.spec` | ✅ |
| EST-46 | Fora de linha: produto indisponível no Sistema de Pedidos há 90+ dias seguidos (ou que saiu do catálogo) vira "Fora de linha · liquidar" no Estoque, sai de "O que repor" e de "Parados" (decisão do dono) | `pedido.js` (servidor) `atualizarDisp`/`foraDeLinha`; `estoque.js` `foraLinhaDe` | `foradelinha.test`; `foradelinha.spec`; `estoque.spec` | ✅ |
| EST-39 | Cobertura do inventário e aviso de 25 dias | `inventario.js` | `inventario.test`; `regras.spec` | ✅ |
| EST-40 | Limites do inventário (2.000 itens) | `inventario.js` | — | ❌ |
| EST-50 | Valor do pedido = % do faturamento (CMV real) | `pedido.js` | — | ❌ |
| EST-51 | Quantidade a pedir (quilo inteiro, múltiplo do site) | `pedido.js` | — | ❌ — prazo diferente do Estoque, ver D-03 |
| EST-52 | Prioridades do pedido | `pedido.js` | — | ❌ |
| EST-53 | Divisão do valor entre grupos | `pedido.js` | — | ❌ |
| EST-54 | Data comemorativa | `pedido.js` | — | ❌ |
| EST-55 | Pedido validado no servidor | `src/pedido.js` | — | ❌ |
| EST-56 | Carrinho no site: código de uso único, nunca finaliza | `src/pedido.js`; `carrinho-site.js` | — | ❌ |
| EST-57 | Robô e login do Sistema de Pedidos: só admin; senha nunca volta | `server.js`; `src/pedido.js` | — | ❌ |
| EST-58 | Revisão do pedido pela IA: admin e franqueado com Pedido | `server.js` | `ia.spec`; `ia.test` | ✅ |
| EST-59 | Aviso de validade no pedido | `pedido.js` | — | ❌ |

## 10. Preços, custos e notas de entrada (PRC)

| Código | Regra | Onde está garantida | Teste | Cobertura |
|---|---|---|---|---|
| PRC-01 | Custo e margem nunca para a vendedora (ver PERF-04) | rotas de estoque | — | ❌ (rota) |
| PRC-02 | Inventário: vendedora sem custo nem quantidade do sistema | `inventario.js` | `inventario.test` | 🟡 |
| PRC-03 | Validade: custo do lote só para quem vê custos | `semCusto` | — | ❌ |
| PRC-05 | "Sincronizar agora" das notas: só admin | `server.js` | — | ❌ |
| PRC-06 | Config. de estoque e classe travada: admin e franqueado | `server.js` | — | ❌ |
| PRC-07 | Tela Site: só preço de tabela, sem custo | `server.js` | `telas.spec` (abre) | ❌ |
| PRC-10 | Custo do pacote de chá = gramas × custo do kg + embalagem | `estoque.js` `custo`/`custoCadastro` | `voltar.spec` (indireto) | 🟡 |
| PRC-11 | Venda casa com o estoque por código, código+gramas, dígito do tamanho ou nome | `estoque.js` `casar` | — | ❌ |
| PRC-12 | Venda sem custo fica fora da margem e é listada | `estoque.js` | — | ❌ |
| PRC-13 | Taxas fora do faturamento e da margem | `estoque.js` | — | ❌ |
| PRC-14 | Margem bruta = (venda − custo) ÷ venda | `estoque.js`; `precos.js` | `dicas.spec`; `voltar.spec` | 🟡 — "lucro bruto" com duas definições, ver B-07 |
| PRC-15 | Deduções da margem líquida (comissão, royalties, Simples, maquininha, custos) | `estoque.js` `criarDeducoes` | — | ❌ |
| PRC-16 | Ponto de equilíbrio | `estoque.js` | `telas.spec` (abre) | ❌ |
| PRC-17 | Classe oficial (Estrela, Volume, Joia, Peso morto) | `estoque.js` | — | ❌ |
| PRC-18 | Margem de tabela | `estoque.js` | `telas.spec` (abre) | ❌ |
| PRC-19 | Histórico de custo do estoque só anota mudanças | `src/estoque.js` | — | ❌ |
| PRC-20 | Compras = notas "Compra" concluídas | `src/estoque.js` | — | ❌ |
| PRC-21 | Planilha de estoque do AppNext lida corretamente | `src/estoque.js` | `blind` "cadastro, estoque e tabela…" | ✅ |
| PRC-22 | Item que some da planilha fica com 0 e mantém o custo | `src/estoque.js` | — | ❌ |
| PRC-30 | Venda e margem pelo preço do CADASTRO (coluna "No sistema"); sem cadastro, pelo caixa ("sem cadastro" + "margem pelo caixa") | `precos.js` `vendaPeloCadastro` | `dicas.spec` "venda e margem pelo preço do cadastro", "No sistema e No caixa lado a lado" | 🟡 |
| PRC-31 | Colunas "No sistema" (cadastro) e "No caixa" (cupons) lado a lado; "No caixa" é só conferência, com ⓘ | `precos.js` | `dicas.spec` "ⓘ explica a coluna No caixa" | ✅ |
| PRC-32 | Motivo provável da diferença caixa × cadastro | `precos.js` `porQueDifere` | `dicas.spec` "motivo provável…" | ✅ |
| PRC-33 | Histórico do cadastro só anota mudanças | `tabela.js` `registrarPreco` | `reajuste.test` "histórico do preço…" | ✅ |
| PRC-34 | Importação do cadastro (composto vale sobre simples) | `tabela.js` | `blind` (só `.erro`) | 🟡 |
| PRC-35 | Reajuste pelo caixa: preço mais comum que se mantém | `precos.js` | — | ❌ |
| PRC-36 | Custo histórico do produto (notas + fotos do estoque) | `precos.js` | — | ❌ |
| PRC-37 | "Perderam margem" | `precos.js` | — | ❌ |
| PRC-38 | Preço para voltar à margem de antes (,90) | `precos.js` | — | ❌ |
| PRC-40 | Custo antes de uma nota | `precos.js` `custoAntes` | `reajuste.spec`, `voltar.spec` (indireto) | 🟡 |
| PRC-41 | "O custo subiu" com preço sugerido | `precos.js` `impactoCusto` | `voltar.spec` (2) | ✅ — limites 0,5% × 0,05% diferentes, ver D-04 |
| PRC-42 | Linhas em amarelo (também no celular) | `precos.js` | `voltar.spec` (2) | ✅ |
| PRC-43 | Janela de pacotes do chá | `precos.js` | `voltar.spec` | 🟡 (o teste pode passar sem rodar) |
| PRC-44 | Histórico de compras do item | `precos.js` | `voltar.spec` | ✅ |
| PRC-45 | E-mail de reajuste conferido no servidor | `server.js`; `cobranca.js` | `reajuste.test` (2); `reajuste.spec` | ✅ |
| PRC-46 | Filtros da lista de notas | `precos.js` | `regras.spec` (2) | 🟡 |
| PRC-47 | Desconto da nota | `precos.js` | — | ❌ |
| PRC-50 | "Nosso preço" na comparação com o site | `site.js` | `telas.spec` (abre) | ❌ |

## 11. Resultado e rentabilidade (RES)

| Código | Regra | Onde está garantida | Teste | Cobertura |
|---|---|---|---|---|
| RES-01 | Resultado do mês (DRE) | `dre.js` | `telas.spec` (abre) | ❌ — texto do ⓘ contradiz a conta, ver D-02 |
| RES-02 | Projeção do mês em andamento | `dre.js` | — | ❌ |
| RES-03 | Comparação com o ano anterior | `dre.js` | — | ❌ |
| RES-04 | Custos de hoje aplicados ao passado | `dre.js` | — | ❌ |
| RES-05 | Rentabilidade: lucro, contribuição, curva ABC, por vendedora | `estoque.js` | `regras.spec`, `voltar.spec` (layout) | 🟡 |
| RES-06 | Por tamanho de pacote e "qual pacote oferecer" | `estoque.js` | `voltar.spec` (layout) | 🟡 |
| RES-07 | Margem abaixo da mínima, com o motivo | `estoque.js` | — | ❌ |
| RES-08 | Lucro da promoção | `estoque.js` | — | ❌ |
| RES-09 | Custos que mudaram | `estoque.js` | — | ❌ |

## 12. Vendas e métricas (VEN)

| Código | Regra | Onde está garantida | Teste | Cobertura |
|---|---|---|---|---|
| VEN-01 | Carrega 24 meses + mês atual | `main.js` `desdeParcial`; servidor | — | ❌ |
| VEN-02 | Histórico completo carrega sozinho quando a tela precisa | `main.js` `precisaCompleto` | — | ❌ |
| VEN-03 | Botão "Carregar desde…" | `pages.js` | — | ❌ |
| VEN-04 | Atalhos de período pelo último dia com venda | `pages.js` | — | ❌ |
| VEN-05 | Só o mês (sem ano) = o mês em todos os anos | `pages.js`; `core.js` | — | ❌ |
| VEN-06 | Cupom único = cupom + loja + dia | `core.js` | `blind` "chaveCupom…" | ✅ |
| VEN-07 | TKM, PMA e IPA como no relatório antigo | `core.js` `metricas` | — | ❌ |
| VEN-08 | Consumíveis entram no faturamento, não contam como item | `core.js`; `fechamento.js` | — | ❌ |
| VEN-09 | Desconto por unidade ou por linha detectado nos dados | `core.js` | — | ❌ |
| VEN-10 | Prêmio de fidelidade a R$ 0,01 reconhecido | `core.js` `ehResgate` | `voltar.spec` (indireto) | 🟡 |
| VEN-11 | Resumo e Comparativos sem "SEM VENDEDOR" | `pages.js` | — | ❌ |
| VEN-12 | Comparação com o período anterior / ano anterior | `pages.js` | — | ❌ |
| VEN-13 | Meta do mês (ver EQP-01) | `core.js`; `indicadores.js` | `voltar.spec` (só aparece) | 🟡 |
| VEN-14 | Projeção só com período começando no dia 1º | `pages.js`; `extras.js` | — | ❌ |
| VEN-15 | Promoção: antes × durante, pela média por dia | `pages.js` | `telas.spec`; `regras.spec` | 🟡 |
| VEN-16 | Cupons: CPF só para quem vê clientes; NF-e de mesmo número vira "Nota fiscal" | `pages.js` | `regras.spec` "cupom com NF-e…" | ✅ (NF-e) |
| VEN-17 | Média da franquia anônima | `pages.js`; `/api/rede` | — | ❌ |
| VEN-18 | Mapa de calor sem feriados | `mapa.js` | `telas.spec` | 🟡 |
| VEN-19 | Início: avisos por gravidade | `inicio.js` | `ia.spec`; `regras.spec`; `voltar.spec` | 🟡 |
| VEN-20 | Filtros lembrados por loja | `main.js` | — | ❌ |

## 13. Clientes, fidelidade, WhatsApp e lista de espera (CLI)

| Código | Regra | Onde está garantida | Teste | Cobertura |
|---|---|---|---|---|
| CLI-01 | Vendedora não recebe clientes (ver PERF-06) | servidor | — | ❌ — exceção da Lista de espera, ver A-01 |
| CLI-02 | WhatsApp manual: um clique = uma mensagem, marca contatado | `clientes.js`, `campanhas.js`, `espera.js` | `regras.spec` (2, só vê o item) | 🟡 |
| CLI-03 | Intervalo mínimo entre mensagens por cliente (padrão 21 dias) | `clientes.js` `recebeuRecente`; `campanhas.js` | — | ❌ — vale só na tela, ver C-03 |
| CLI-04 | "Não quer mensagens" tira o cliente de tudo | `server.js` contatos; telas | — | ❌ |
| CLI-05 | Campanha: limite por dia e rodízio das variações | `campanhas.js` | `regras.spec` (outra coisa) | ❌ |
| CLI-06 | Trava de estoque: não oferece produto sem estoque | `clientes.js`; `campanhas.js` | `regras.spec` "Trava de estoque…" | ✅ |
| CLI-07 | Fidelidade: Logs do FIXE lidos sem repetir | `fidelidade.js` | `fidelidade.test` (3) | ✅ |
| CLI-08 | Saldo de pontos por lotes que vencem; cancelamento via PDV | `public/js/fidelidade.js` | `blind`; `regras.spec` | 🟡 |
| CLI-09 | Ciclo de resgate | `public/js/fidelidade.js` | `blind` | 🟡 |
| CLI-10 | RFM e retenção por safra | `clientes.js`; `indicadores.js` | `rfm.test`; `regras.spec` | 🟡 |
| CLI-11 | Lista de espera: esperando → chegou → avisado → comprou/não comprou | `espera.js` | `espera.test` (6) | ✅ |
| CLI-12 | Lista de espera: permissões (ver PERF-26) | servidor | — | ❌ |
| CLI-13 | Exceção decidida pelo dono (D-01): na Lista de espera a vendedora busca e vê nome, CPF e celular do cliente | `/api/espera`, `/api/espera/clientes` | — | ❌ |

## 14. Orçamento (ORC)

| Código | Regra | Onde está garantida | Teste | Cobertura |
|---|---|---|---|---|
| ORC-01 | Só admin e franqueado (ver PERF-09) | `lojaOrc` | — | ❌ |
| ORC-02 | Validação e numeração por loja | `orcamentos.js` | `orcamentos.test` | ✅ |
| ORC-03 | Orçamento aprovado não muda | `orcamentos.js` | `orcamentos.test`; `voltar.spec` | 🟡 — **servidor deixa reabrir, ver A-07** |
| ORC-04 | Perder exige motivo; só rascunho é excluído | `orcamentos.js` | `orcamentos.test` | ✅ |
| ORC-05 | Custo guardado; documento do cliente sem custo | `orcamentos.js`; `orcamento.js` | `voltar.spec` | ✅ |
| ORC-06 | CNPJ preenche só campos vazios (ver NFE-11) | `orcamento.js` | `consulta-cnpj.spec` | ✅ |
| ORC-07 | Cliente da base ou de orçamentos anteriores | `orcamento.js` | `voltar.spec` | ✅ |

## 15. Checklist, fechamento e avisos (OPE)

| Código | Regra | Onde está garantida | Teste | Cobertura |
|---|---|---|---|---|
| OPE-01 | Checklist: todos marcam, guarda quem e hora; só hoje ou ontem | `checklist.js`; servidor | `checklist.test`; `voltar.spec` | 🟡 (hoje/ontem só na rota) |
| OPE-02 | Itens: vendedora não edita; 1 a 40 por parte | `checklist.js`; servidor | `checklist.test` | 🟡 |
| OPE-03 | Checklist no e-mail de fechamento | `checklist.js`; `notificacoes.js` | `checklist.test` | ✅ |
| OPE-04 | Contas do fechamento do dia (como a planilha antiga) | `fechamento.js` | `blind` "fechamento e classificação…" | 🟡 |
| OPE-05 | Envio automático do fechamento | `notificacoes.js` | — | ❌ |
| OPE-06 | Quem recebe o fechamento | `notificacoes.js` | — | ❌ |
| OPE-07 | Avisos ao administrador (coleta falhou, loja sem vendas) | `avisos.js` | — | ❌ |
| OPE-08 | Telegram: token nunca aparece; mensagem longa em partes | `notificacoes.js` | — | ❌ |

## 16. Estrutura do painel e atualização (APP)

| Código | Regra | Onde está garantida | Teste | Cobertura |
|---|---|---|---|---|
| APP-01 | Dados guardados no aparelho (ver SEG-16) | `main.js` | `guardados.spec` | 🟡 |
| APP-02 | Servidor responde 304 quando nada mudou | `server.js`; `main.js` | — | ❌ (a apresentação não passa por aqui) |
| APP-03 | Compressão brotli/gzip | `server.js` | — | ❌ |
| APP-04 | Erro de rede: espera, tenta de novo, mensagem em português | `core.js` `erroDeRede`/`esperarVisivel` | `ia.spec`; `guardados.spec` | 🟡 — várias telas ainda mostram o texto em inglês, ver C-04 |
| APP-05 | `TS.aoConfirmar`: aplica ao sair do campo | `main.js` | `esc` "digitar a hora inteira" | 🟡 |
| APP-06 | Aviso "O painel foi atualizado" | `main.js` | — | ❌ |
| APP-07 | Atualizações: só instalam versões que passaram nos testes do GitHub | `atualizador.sh`; `admin-api.js` `sistema` | — | ❌ |
| APP-08 | Tabela pagina sozinha (100 por página; 40 cartões no celular) | `components.js` | — | ❌ — celular só pagina acima de 60 |
| APP-09 | ⓘ tocável nas colunas (computador e celular) | `components.js` | `dicas.spec` | 🟡 (só Preços) |
| APP-10 | Celular: tabela vira cartão, nada passa da borda | `components.js` | `telas.spec` (26 telas); `voltar.spec` | 🟡 (cartões próprios não conferidos) |
| APP-11 | Nunca escrever "null" na tela | `.filter(Boolean)` | `telas.spec`; `config-sem-null.spec` | 🟡 — **Pedido no celular, ver A-08** |
| APP-12 | Apresentação nunca grava (ver SEG-14/15) | `core.js` | vários | 🟡 |
| APP-13 | Rota que grava exige X-Painel (ver SEG-12) | servidor | — | ❌ |

---

## Achados do levantamento

Todos os da lista A foram conferidos no código, um por um.

### A. Erros confirmados (corrigir com teste)
| # | Achado | Regra | Onde |
|---|---|---|---|
| A-01 | ~~Lista de espera entrega à vendedora dados de clientes~~ — **permitido pelo dono (D-01)**; os nomes reais das colegas continuam sendo erro (PERF-08) | PERF-08 | `server.js` `/api/espera`, `/api/espera/clientes` |
| A-02 | **Conta com a franquia devolve CPF completo e nome dos clientes da fidelidade** a gerente com Notas fiscais que não tem a tela Clientes | PERF-07 | `contafranquia.js` (resgates); rotas `/api/conta-franquia` |
| A-03 | **NF-e de devolução: gerente com só a tela Preços consegue mandar o robô emitir** (a regra pede Notas fiscais) | NFE-02 | `server.js` `lojaDev` (`podeTela('notas','precos')`) |
| A-04 | **Desfazer o inventário é um GET** (fica fora da proteção X-Painel; um link de outro site pode disparar) | SEG-12 | `server.js` `GET /api/inventario/contagem/:id/desfazer` |
| A-05 | **Cadastro de parceiro pelo robô nunca funciona** (o robô recusa a ação `parceiro`); quando funcionar, o log mostraria o CPF/CNPJ completo | NFE-10, COL-07 | `coletor/nextsoft_nfe.py` (linha do `ACAO`, log do parceiro) |
| A-06 | NF-e de venda pode ser emitida sem o total do teste (o robô pula a conferência); a devolução exige | NFE-01 | `src/nfe.js` `emitir` |
| A-07 | Orçamento aprovado pode voltar a rascunho direto pelo servidor | ORC-03 | `src/orcamentos.js` `situacao` |
| A-08 | Pedido no celular pode escrever "null" no fim da lista; o teste de texto quebrado não pegaria | APP-11 | `public/js/pedido.js` (cartões) |
| A-09 | Usuário sem cadastro vira **admin** em vez de ser bloqueado (hoje não acontece, mas é o padrão perigoso) | PERF-01 | `server.js` middleware (`u ? u.perfil : 'admin'`) |
| A-10 | Grade de cobertura e horas descobertas erradas com blocos de 10 min (**já corrigido hoje**) | ESC-26 | `mapa.js` |

### B. Regras da escala e metas com defeito
| # | Achado | Regra |
|---|---|---|
| B-03 | Ajuste manual passa por cima de férias e de dia fechado; "trocar o dia" deixa escolher quem está de férias | ESC-21 |
| B-04 | Alerta falso "0 pessoas" em feriado fechado quando alguém está de férias | ESC-27 |
| B-05 | Rodízio com 9 ou mais pessoas e 1 folga por domingo: o ciclo é cortado em 8 semanas e alguém nunca folga no domingo | ESC-11 |
| B-06 | Férias ligadas à escala pelo nome: se o nome da equipe for diferente do nome nas vendas ("Gabi" × "GABRIELLY"), as férias somem da escala | ESC-19 |
| B-07 | "Lucro bruto" com duas definições (Resultado já tira impostos; Rentabilidade não) | PRC-14 |
| B-08 | Meta automática pode sair diferente no painel e no e-mail de fechamento (taxas e Espaço Gourmet tratados diferente) | EQP-01 |

### C. Pontos fracos (não são erro visível hoje)
| # | Achado |
|---|---|
| C-01 | Ações sem auditoria: "Sincronizar agora" (`/api/script`), excluir orçamento, reenvio do e-mail de devolução, resultado do robô na devolução, ações da lista de espera e de campanhas |
| C-03 | Intervalo entre mensagens e "não quer mensagens" só valem na tela; o servidor aceita. Botão "WhatsApp" do topo da ficha e exportação CSV pulam a trava |
| C-04 | Erro de rede ainda aparece em inglês ("Failed to fetch") em Checklist, Orçamento, Lista de espera, Campanhas e Clientes |
| C-05 | Cobrança automática perde o mês se o servidor ficar fora do ar no dia, e não tenta de novo depois de uma falha |
| C-08 | Ao excluir uma loja, a senha do Sistema de Pedidos fica no disco (o código procura na pasta errada) |
| C-09 | O hook de segredos não bloqueia `config/notificacoes.json` (senhas SMTP e token do Telegram), `config/acessos.json` nem `config/auditoria.jsonl` |
| C-10 | Atualizador: "instalar mesmo assim" e o caso em que o ramo de testes nunca foi baixado instalam versão não testada |

### D. Decisões do dono (19/11/2026)
| # | Pergunta | Decisão | Consequência |
|---|---|---|---|
| D-01 | Lista de espera: vendedora busca clientes (nome, CPF, celular)? | **Pode, como hoje** | Exceção registrada no CLAUDE.md; A-01 deixa de ser erro (vira regra CLI-13) |
| D-02 | DRE do mês em andamento: fixos cheios ou proporcionais? | **Cheios, como hoje** | Corrigir só o texto do ⓘ |
| D-03 | Pedido × Estoque: prazo e notas depois da planilha | **Mesmo prazo de cobertura e o Pedido conta as notas lançadas depois da planilha** | Mudar `pedido.js` + teste |
| D-04 | Limite de "O custo subiu" | **Qualquer alta (0,05%) nos dois** | Alinhar aviso e filtro a 0,05% + teste |
| D-05 | Gerente recebe todas as vendas sem as telas liberadas? | **Pode, como hoje** | Registrado (PERF-19: telas de vendas do gerente só escondidas, de propósito) |
| D-06 | Cobrança por e-mail à franquia (devoluções e fidelidade) | **Só admin e franqueado** | ✅ Feito (revisão 19/11): `/api/conta-franquia/email/*` e `/auto` + botão escondido; `permissoes-telas.test` |
| D-07 | Gerente com só Inventário vê custos? | **Não: custo só com tela de custo** | Mudar inventário (`paraUsuario`/rotas) + teste |
| D-08 | 6x1, semana Dom–Sáb: folga do domingo puxa a segunda (5 dias na semana)? | **Sim, é o combinado** | Registrado (ESC-12) |

---

### E. Revisão dos dias 18 e 19/11 (5 revisores por área; corrigido com teste no mesmo PR)
| Código | Achado | Onde | Situação |
|---|---|---|---|
| E-01 | Robô de NF-e podia homologar a saída errada (sem o id da resposta, buscava "a mais nova com o mesmo total", até sem parceiro) | `coletor/nextsoft_nfe.py` `achar_saida_concluida` | ✅ Devolução: não procura; venda: só com parceiro e exatamente 1 candidata — senão "homologue lá" |
| E-02 | Conclusão da venda que demora vira "nada foi transmitido" (convidava a emitir de novo = nota em dobro) | `nextsoft_nfe.py` | ✅ Mensagem manda conferir no AppNext antes de tentar de novo |
| E-03 | Gerente com Notas enviava cobrança por e-mail à franquia (D-06) | `server.js` `/api/conta-franquia/email/*`, `/auto`; `creditos.js` | ✅ `permissoes-telas.test` |
| E-04 | Cobrança automática podia sair 2× (SMTP lento) | `server.js` (agendamento) | ✅ Trava + mês marcado antes de enviar |
| E-05 | Desconto nos royalties "123.45" virava 12.345,00 | `contafranquia.js` `royalties` | ✅ `contafranquia.test` |
| E-06 | Devolução cancelada voltava como crédito; o feito à mão antes do XML se perdia (id trocava) | `contafranquia.js` `creditos`/`conta` | ✅ `contafranquia.test` |
| E-07 | Desconto 0 no cabeçalho escondia o desconto dos itens; tolerância da combinação crescia sem limite | `contafranquia.js` | ✅ `contafranquia.test` |
| E-08 | Mês da fidelidade / atraso em UTC; soma da planilha da fidelidade sem arredondar | `contafranquia.js` | ✅ |
| E-09 | ⭐ Sugestões: obrigatório virava "não entrou"; registrar 2× duplicava; 2ª estrela no produto aguardando virava "não entrou"; nota não concluída ou da manhã do pedido contava; carrinho com "erro" ficava aguardando; "não agora" antigo voltava | `sugestoes.js`, `pedido.js` | ✅ `sugestoes.test` "revisão" |
| E-10 | Vendedora recebia a quantidade pedida e o login de quem decidiu (Sugestões) e o login das colegas (Checklist) | `sugestoes.js` `lista`; `server.js` `/api/checklist` | ✅ `sugestoes.test`, `permissoes-telas.test` |
| E-11 | Inventário: não contado que recebeu entrada durante a contagem era zerado sem aparecer na revisão; subgrupo marcava o grupo inteiro; data estranha do AppNext derrubava a tela | `inventario.js` (tela e servidor) | ✅ |
| E-12 | Estoque: quadro "parado" contava fora de linha e o filtro não | `estoque.js` | ✅ |
| E-13 | Escala: abertura 09:40 dava "loja sozinha" falso e equipe mínima "15+"; dia fechado não contava como folga no rodízio (5x2 com 4 dias); intervalo não crescia com o turno (6h20 com 30 min) | `mapa.js` | ✅ `escala-horario.spec` "revisão" |
| E-14 | Horas automáticas do feriado não seguiam a regra nova do intervalo; rota de ajustes/feriados dava 500 com dia `null` | `feriados.js`, `server.js` | ✅ |
| E-15 | IA: pergunta com 10 rodadas quebrava a conversa; conversa longa travava com texto técnico; análise do dia gerada com dados velhos do aparelho; análise "desligada" até recarregar; Esc não fechava o ✨ após um aviso; teto inválido salvo em silêncio | `ia.js`, `inicio.js`, `src/ia.js` | ✅ |
| E-16 | Cache do aparelho com duas pessoas no mesmo navegador (outra aba) gravava dados de B na chave de A | `main.js` + `X-Painel-Usuario` em `/api/dados` | ✅ |
| E-17 | Ficha do cliente: WhatsApp liberado antes de ler o estoque; Checklist: hora no fuso do aparelho e dia antigo ao trocar de loja; "Voltar" do celular desfazia link dentro de janela | `clientes.js`, `checklist.js`, `main.js` | ✅ |
| E-18 | Orçamento: "1.234,56" virava 0; NF-e do orçamento com centavos diferentes sem aviso | `orcamento.js` | ✅ (aviso antes de abrir a nota) |
| E-19 | Rota assíncrona com erro sem tratamento derrubava o painel; demo aceitava 16 MB sem login; histórico de inventário com NaN | `server.js`, `nextsoft_invhist.py` | ✅ |
| E-20 | Repetir sozinho um POST da IA depois de erro de rede pode cobrar 2× (se a resposta caiu depois de cobrada) | `ia.js` `iaApi` | 🟡 Mantido (o dono pediu a nova tentativa automática); risco baixo |
| E-21 | "Replicar/Trazer mês" multiplicava ajuste pontual | `mapa.js` `ajustesQueRepetem`, editor "Vale para" | ✅ Decisão do dono: no ajuste a pessoa escolhe **Só neste dia (pontual)** ou **Neste e nos próximos <dia da semana>** (também nos próximos meses). Replicar/Trazer leva só os que repetem, em todos os mesmos dias da semana; pontual fica no dia dele. `escala-horario.spec` "replicar mês", "Vale para" |
| E-22 | Feriado que abre em dia normalmente fechado fica sem ninguém e sem alerta | `mapa.js` | ❌ A fazer |
| E-23 | NF-e de venda: o teste passava e a emissão falhava ao concluir por falta de estoque ("não possui estoque suficiente"), obrigando a refazer tudo | `nfsaida.js` (estoque por produto + aviso antes do robô), `nextsoft_nfe.py` (lê o estoque do produto no AppNext na conferência) | ✅ A tela avisa na hora; o robô para no teste quando o AppNext informa o estoque (o campo é registrado no log para conferência) |
| E-24 | NF-e emitida (autorizada) não aparecia em Notas de saída nem tinha DANFE/XML até a próxima coleta | `server.js` `/api/nfe` (pede a importação do XML ao autorizar), `nfsaida.js` (DANFE/XML na linha e nos detalhes) | ✅ |
| E-25 | Comissão e bônus com meta 0 (loja sem meta, férias o mês todo) caíam na faixa mais alta; meta simulada valia para outro mês | `rules.js` `comissao`, `R.aliquotaBonus`; `pages.js` (`metaYm`, aviso "Meta não cadastrada") | ✅ `bugslogica.test`, `regras.spec` |
| E-26 | "Minha comissão" da vendedora divergia da conta do dono com loja sem regras salvas | `src/regrasvend.js`, `server.js` `filtrarPorPerfil` | ✅ `bugslogica.test` (ramo do servidor sem teste) |
| E-27 | Validade: 2º ajuste manual de lote no mesmo estoque era ignorado | `lotes.js` `escolherAjuste`, `editarSaldo` | ✅ `bugslogica.test` |
| E-28 | Lista de espera marcava "chegou" com nota pendente ou de devolução/troca | `espera.js` `avaliar` | ✅ `bugslogica.test`, `espera.test` |
| E-29 | Planilha de estoque parcial zerava o resto da loja | `estoque.js` `travaParcial`; `admin-api.js` (`?forcar=1` só no envio manual, auditado) | ✅ `bugslogica.test` (confirmação na tela sem teste) |
| E-30 | Histórico de preço de cadastro com o dia seguinte (UTC) | `tabela.js` `diaBrasilia` | ✅ `bugslogica.test` |
| E-31 | Campanha recorrente podia criar a rodada em dobro | `campanhas.js` `rodadaEmDia`, `novaRodada` | ✅ `bugslogica.test` |
| E-32 | Devoluções pendentes da mesma nota passavam da quantidade; pedido obrigatório sem id dava 500; retenção 90 dias casava cupom só pelo número | `devolucao.js` `contaComoDevolvido`; `pedido.js` `alterarObrig`; `indicadores.js` `retencao90` | ✅ `bugslogica.test`, `devolucao.test`, `rfm.test` |
| E-33 | Gerente trocava os destinatários dos e-mails de devolução (e da cobrança automática por tabela) | `server.js` `PUT /api/devolucoes/destinatarios` (só admin/franqueado); `config.js` (travado) | ✅ `seguranca.test` |
| E-34 | E-mail do FIXE aceito sem assinatura do domínio e com link de qualquer site | `fixemail.js` `remetenteAutenticado` (DKIM/DMARC/SPF alinhados), `linkDoEmail` (`FIXE_LINK_DOMINIOS`) | 🟡 `seguranca.test`; falta conferir com um e-mail real do FIXE |
| E-35 | GET da planilha do inventário fechava a contagem; busca de clientes da espera sem teto diário; login travável por terceiros; "Sair" voltava a valer após reinício; `/health` listava lojas; erro cru com caminho | `server.js`, `inventario.js`, `config.js` `msgErro`, `pedido.js` | ✅ `seguranca.test` (download do inventário sem teste de tela) |
| E-36 | Rentabilidade distorcida por item a R$ 0,01 (desconto de ~100%); Próximas semanas listava taxa/serviço; prompt/alert do navegador; Início sem "lembrar depois" | `estoque.js` (`resg`, `PISO_Y`, `compravel`, abas `rentAba`), `components.js` (`TS.perguntar`, `TS.avisar`), `inicio.js` (`adiados`) | ✅ `usabilidade.spec` |
| PERF-17 | Índice das NF-e por data da pasta; compras/notas/histórico e contagens com cache por arquivo; apresentação pré-comprimida; limpeza dos envios ao robô (90 dias) | `nfsaida.js` `indiceDe`; `estoque.js` `lerComCache`; `inventario.js` `resumoDe`; `nfe.js`/`inventario.js` `limparEnvios`; `server.js` | ✅ `cache.test`, `dados-comprimidos.spec` (memo da espera e `packCache` sem teste) |

## Resumo em números

| Área | Regras | ✅ | 🟡 | ❌ |
|---|---|---|---|---|
| Perfis e permissões (PERF) | 29 | 1 | 5 | 23 |
| Segurança (SEG) | 19 | 1 | 6 | 12 |
| IA | 16 | 7 | 6 | 3 |
| NF-e (NFE) | 11 | 2 | 5 | 4 |
| Franquia (FRQ) | 12 | 6 | 6 | 0 |
| Coletor (COL) | 7 | 0 | 2 | 5 |
| Escala (ESC) | 31 | 7 | 10 | 14 |
| Equipe e metas (EQP) | 10 | 0 | 1 | 9 |
| Estoque (EST) | 41 | 17 | 7 | 17 |
| Preços (PRC) | 37 | 8 | 8 | 21 |
| Resultado (RES) | 9 | 0 | 2 | 7 |
| Vendas (VEN) | 20 | 2 | 5 | 13 |
| Clientes (CLI) | 12 | 3 | 4 | 5 |
| Orçamento (ORC) | 7 | 5 | 1 | 1 |
| Operação (OPE) | 8 | 1 | 3 | 4 |
| Estrutura (APP) | 13 | 0 | 7 | 6 |
| **Total** | **282** | **60 (21%)** | **78 (28%)** | **144 (51%)** |

## Próximas etapas

1. ~~Dono decide os itens D-01 a D-08~~ — decidido em 19/11/2026 (ver D).
2. **Corrigir os erros da lista A**, cada um com um teste que mostra o erro antes e passa depois.
3. **Teste de permissões no servidor:** sobe o painel com um usuário de cada perfil e confere os 403 e o que cada um recebe (cobre de uma vez a maior parte de PERF, SEG-12 e as listas de clientes/custos).
4. **Testes das contas sem teste**, por prioridade de dinheiro: comissão e metas (EQP), Resultado e margem (RES/PRC), reposição e pedido (EST).
5. **Amarração automática:** cada teste ganha o código da regra no nome (ex.: `[ESC-16] semana começando na segunda…`), e um teste vigia a matriz: falha se uma regra ✅ perder o teste ou se um teste citar código inexistente. O hook `lembrar-docs` passa a dizer quais regras a mudança tocou.
