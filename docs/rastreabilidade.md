# Matriz de rastreabilidade — Painel Tea Shop

Cada regra do painel tem um código, o lugar no código que a garante e o teste que a cobre.
Levantamento: 19/11/2026; **revisado linha por linha em 23/11/2026** contra os testes de hoje. Linhas de código citadas podem andar com o tempo; o nome da função é a referência estável.

**Como ler a coluna Cobertura**
- ✅ **coberta**: há teste que falha se a regra quebrar.
- 🟡 **parcial**: há teste, mas só de uma parte (ou só da função, não da rota do servidor).
- ❌ **sem teste**.

**Como os testes cobrem hoje**
- **Contas e regras** (`tests/unit`, `node --test`): as funções puras do servidor e das telas.
- **Servidor de verdade** (10 arquivos em `tests/unit` sobem o `server.js` com usuários de cada perfil: `seguranca`, `permissoes-telas`, `franqueado-loja`, `conferencia-rotas`, `perdas-rota`, `metahoje`, `push-rotas`, `zap-rotas`, `celulares`, `conversas-midia`): conferem o que a rota devolve a cada perfil (403, sem custo, só a loja dele, X-Painel).
- **Telas** (`tests/e2e`, Playwright, computador e celular): rodam na apresentação, que entra sempre como **admin** e não grava; permissão por perfil na tela não é testada.
- **Serviço do WhatsApp** (`zap/tests`).

**Matriz sempre em dia (decisão do dono, 23/11/2026):** toda mudança de regra, tela ou rota atualiza a linha no mesmo PR; o guardião `tests/unit/matriz.test.js` falha o PR se a matriz apontar para teste que não existe, se um teste com código de regra não tiver linha ou se o resumo não bater; `npm run testar-alteracao` roda primeiro os testes das regras dos arquivos mexidos. O resumo em números é contado pelas linhas (`node scripts/matriz.js --resumo`).

Arquivos de teste: `tests/unit/*.test.js` (unidade, `node --test`) e `tests/e2e/*.spec.js` (tela, Playwright). Abreviações: `esc` = `escala-horario.spec.js`, `blind` = `blindagem.test.js`.

---

## 1. Perfis e permissões (PERF)

| Código | Regra | Onde está garantida | Teste | Cobertura |
|---|---|---|---|---|
| PERF-01 | Só entra quem está ativo, no prazo e com loja; o perfil vem do cadastro, nunca da tela | `server.js` middleware de login (~721-745), `config.js` `expirado`/`lojasDoUsuario` | `seguranca.test` (login, "Sair" que vale depois de reiniciar, sessões); todos os testes que sobem o servidor entram pelo login de verdade com o perfil do cadastro | 🟡 — falta o caso "inativo ou fora do prazo não entra" |
| PERF-02 | Só existem 4 perfis (admin, franqueado, gerente, vendedor) | `config.js` (~24, 86), `admin-api.js` (~753) | — | ❌ |
| PERF-03 | Cada pessoa só lê e grava nas lojas dela | `req.lojas.find(...)` em todas as rotas; `admin-api.js` `lojaPermitida` | `franqueado-loja.test` (coletor, notas, robô do pedido, resumo, guia, carrinho, CFOP, conversas); `conferencia-rotas.test`; `perdas-rota.test`; `metahoje.test`; `celulares.test`; `conversas-midia.test`; `zap-rotas.test`; `permissoes-telas.test` (A pagar) | 🟡 — muitas rotas com "nunca a loja dos outros", não todas |
| PERF-04 | Vendedora nunca recebe custo nem margem do servidor | `/api/dados` sem custo (`sources.js`); `podeTela`/`podeCustos`; validade `semCusto`; inventário `paraUsuario` | `inventario.test`, `lotes.test`, `ia.test` (funções) | 🟡 |
| PERF-05 | Gerente só vê custo com uma tela de custo liberada (Rentabilidade, Estoque, Preços, Notas, Pedido ou Resultado) | `server.js` `podeTela`/`podeCustos` | `permissoes-telas.test` "telas de custo: gerente sem a tela e vendedora não recebem"; `perdas-rota.test` | ✅ |
| PERF-06 | Vendedora não recebe dados de clientes | `filtrarPorPerfil`, `podeClientes`, contatos, campanhas | `ia.test`; `zap-rotas.test` (vendedora não vê situação, QR nem lista); `celulares.test`; `franqueado-loja.test` CONV-07; `conversas-midia.test` | 🟡 — `/api/dados` (CPF e celular no pacote) sem teste de rota |
| PERF-07 | Gerente só recebe dados de clientes com a tela Clientes | `podeClientes`, `perfilDados` | `zap-rotas.test` (gerente sem Clientes: nada do robô); `conferencia-rotas.test` | 🟡 — conta com a franquia (A-02) sem teste |
| PERF-08 | Vendedora não vê nome nem dados das colegas ("COLEGA N") | `filtrarPorPerfil` (~156-209) | — | ❌ — **furo: Lista de espera, ver A-01** |
| PERF-09 | Orçamento: só admin e franqueado | `lojaOrc` (`podeContabilidade`) | `orcamentos.test`, `voltar.spec` (como admin) | ❌ (permissão) |
| PERF-10 | Enviar reajuste à franquia: só admin e franqueado | `podeReajuste` | `reajuste.spec` (como admin) | ❌ (permissão) |
| PERF-11 | Disparar o coletor (Sincronizar agora, rodar, robôs): admin e o franqueado na loja dele (decisão do dono); vendedora nunca | `/api/script`, `soAdmin`, notas/sincronizar, robô do pedido | `franqueado-loja.test` (coletor, notas, Buscar dados, robô do pedido, X-Painel); `seguranca.test` "vendedora: não consulta o coletor" | ✅ |
| PERF-12 | IA (✨, análise, revisão do pedido): só admin e franqueado | `IA.podeUsar` + rotas `/api/ia/*` | `ia.test` "só admin e franqueado usam" | 🟡 (função sim, rota não) |
| PERF-13 | A IA só recebe as ferramentas que o perfil pode; sem custo em "todas as lojas" | `server.js` (~1621), `iaprompts.js` `ferramentas` | `ia.test` "ferramentas por perfil" | 🟡 |
| PERF-14 | NF-e (rascunho/emitir/parceiro): admin, franqueado e gerente com Notas fiscais | `lojaNfe` | `seguranca.test` "destinatários do e-mail das devoluções" | 🟡 — rascunho/emitir sem teste de rota |
| PERF-15 | Conta com a franquia: admin, franqueado, gerente com Notas; envio automático só admin/franqueado | `lojaCF` | `contafranquia.test` (lógica); `permissoes-telas.test` "falar com a franquia por e-mail (cobrança): só admin e franqueado" | 🟡 — leitura da conta pelo gerente com Notas sem teste |
| PERF-16 | Configurações: admin e franqueado; o franqueado configura tudo das lojas dele (AppNext, Sistema de Pedidos, regras de comissão, dados da loja); criar/remover loja, coletor, horários, resumo diário, sistema e backup: só admin | `admin-api.js` roteador + `soAdmin`/`soGestor` + `lojaPermitida`; `/api/pedido/acesso` | `permissoes-telas.test` "franqueado configura tudo da loja dele"; `franqueado-loja.test` "da rede continua só do admin", resumo diário, guia, CFOP | ✅ |
| PERF-17 | Franqueado só administra gerentes e vendedores das próprias lojas; ninguém muda o próprio perfil/prazo | `admin-api.js` `usuariosVisiveis`, rotas de usuário | — | ❌ |
| PERF-18 | Vendedor: uma loja e um nome de vendedor; gerente: pelo menos uma tela; admin: loja `*` | `admin-api.js` (~760-771) | — | ❌ |
| PERF-19 | Gerente só usa as telas marcadas em Configurações → Usuários; a lista única de telas (grupos do menu, regra de cada perfil, regras fixas travadas) fica em `src/telas.js` | `telas.js`; `config.js` `TELAS`/`TELAS_GERENTE_PADRAO`; `podeTela` nas rotas; menu em `main.js`; `config.js` (tela) | `telas.test` (tela nova fora da lista avisa; regras fixas); `permissoes-telas.test` (servidor de verdade por perfil); `config-telas.spec` | 🟡 — telas de vendas só escondidas, ver D-05 |
| PERF-20 | Exportar para o contador e A pagar: quem tem a tela Resultado (decisão do dono); envios por e-mail à contabilidade: só admin e franqueado | `server.js` (~2311-2372) | `permissoes-telas.test` "caixa a pagar e planilha do contador" | 🟡 — envio por e-mail sem teste |
| PERF-21 | Feriados trabalhados: gerente com Comissionamento; ajuste de escala: gerente com Mapa | `/api/feriados`, `/api/escala-ajustes` | `permissoes-telas.test` (escala: gerente sem Movimento e escala 403, com 200) | 🟡 |
| PERF-22 | Config. de estoque, classe e "consultar site": admin/franqueado; classificação da rede: só admin | `server.js` (~1742-1785, 2376) | `franqueado-loja.test` "da rede continua só do admin" (classificação) | 🟡 — config. de estoque e "consultar site" sem teste de rota |
| PERF-23 | Pedido sugerido/obrigatório/carrinho: admin, franqueado, gerente com Pedido | `server.js` (~1794, 2198-2242) | `franqueado-loja.test` (carrinho salvo, carrinho montado); `permissoes-telas.test` "decidir as sugestões no Pedido exige a tela Pedido" | 🟡 — pedido sugerido/obrigatório sem teste de rota |
| PERF-24 | Inventário: vendedora conta às cegas, sem custo; não envia, não zera, não desfaz | `inventario.js` `paraUsuario`; rotas `/api/inventario` | `inventario.test` "cega para vendedora" | 🟡 |
| PERF-25 | Validade: custo do lote só para quem vê custos | `semCusto` | `lotes.test` (lógica) | ❌ (rota) |
| PERF-26 | Lista de espera: vendedora sempre; gerente com a tela; modelo da mensagem não é da vendedora | middleware `/api/espera` | `regras.spec` (como admin); `permissoes-telas.test` (vendedora 200; gerente sem a tela 403; padrão inclui) | ✅ |
| PERF-27 | Checklist: todos marcam; só quem não é vendedora edita a lista | `server.js` (~1504-1518) | `checklist.test` (lógica); `permissoes-telas.test` "checklist: a vendedora vê você ou equipe" | 🟡 — editar a lista sem teste de rota |
| PERF-28 | Contatos e campanhas de WhatsApp só para quem vê clientes | `server.js` (~779-885) | `zap-rotas.test` (campanha do robô, lista conferida, envio manual com a regra forte) | 🟡 — `/api/contatos` para vendedora sem teste |
| PERF-29 | A apresentação entra como admin e nunca grava | `server.js` (~428-430) | todos os e2e | ✅ |
| PERFIL-TELA-01 | Vendedora vê na tela só as telas dela, sem custo, margem nem dados de clientes (exceto Lista de espera); tela proibida não abre pelo endereço | `main.js` `configurarAbas`/`rota`, `src/telas.js` | `tests/perfis/perfis.spec.js` | ✅ |
| PERFIL-TELA-02 | Minha comissão da vendedora só com os números dela; sem texto quebrado ("null") | `extras.js` `TS.pages.minha`, `cartaoMinhaMetaHoje` | `tests/perfis/perfis.spec.js` | ✅ |
| PERFIL-TELA-03 | Gerente sem tela de custo não vê custo nem margem (Inventário, Validade, Resumo, Sugestões) e não abre telas não liberadas | `main.js`, `server.js` `podeTela`/`podeCustos` | `tests/perfis/perfis.spec.js` | ✅ |
| PERFIL-TELA-04 | Gerente com a tela Estoque vê "Estoque a custo" | `estoque.js` | `tests/perfis/perfis.spec.js` | ✅ |
| PERFIL-TELA-05 | Franqueado só com a loja dele no seletor e o menu pela regra | `main.js` seletor, `req.lojas` | `tests/perfis/perfis.spec.js` | ✅ |

## 2. Segurança, segredos, auditoria e apresentação (SEG)

| Código | Regra | Onde está garantida | Teste | Cobertura |
|---|---|---|---|---|
| SEG-01 | Segredos e `dados/` nunca vão para o Git | `.gitignore`; hook `.claude/hooks/segredos.js` | — | ❌ — hook não cobre `config/notificacoes.json`, ver C-09 |
| SEG-02 | Chave da IA criptografada; só os 4 últimos caracteres voltam | `ia.js` `cifrar`/`situacao` | `ia.test` "chave… nunca devolvida"; `ia.spec` "chave fica em Configurações" | ✅ |
| SEG-03 | Senhas SMTP/Gmail e token do Telegram nunca voltam (só "tem senha") | `notificacoes.js` `publico`/`publicoLoja` | — | ❌ |
| SEG-04 | Senhas do AppNext, FIXE e Sistema de Pedidos nunca voltam | `admin-api.js` `/estado`; `pedido.js` `acesso()` | — | ❌ — senha do Pedido fica no disco ao excluir loja, ver C-08 |
| SEG-05 | Token de upload comparado em tempo constante | `server.js` `safeEq` (~370-388) | — | ❌ |
| SEG-06 | Senhas com scrypt, conferidas em tempo constante | `config.js` `confereSenhaAsync` | `blind` "scrypt assíncrono em tempo constante" | 🟡 |
| SEG-07 | Cookie de sessão assinado, httpOnly, sameSite, secure; cai ao trocar senha | `server.js` (~41-62, 351) | `seguranca.test` "Sair continua valendo depois de reiniciar" | 🟡 — atributos do cookie sem teste |
| SEG-08 | Limite de tentativas no login (e na chave da IA, perguntas, CNPJ) | `server.js` `tooMany`/`falhou` | `seguranca.test` (login por IP+usuário; apresentação com limite por IP; buscas da Lista de espera) | 🟡 — chave da IA e CNPJ sem teste |
| SEG-09 | Troca de senha: 8-200 caracteres, diferente da atual, derruba outras sessões | `server.js` (~737-772) | — | ❌ |
| SEG-10 | Cabeçalhos de segurança e CSP restrita | `server.js` (~253-263) | — | ❌ |
| SEG-11 | Login/sair/trocar senha só da mesma origem | `mesmaOrigemForm` | — | ❌ |
| SEG-12 | Toda rota que grava exige `X-Painel: 1` | middlewares e rotas (todas conferidas) | `franqueado-loja.test`, `conferencia-rotas.test`, `push-rotas.test`, `permissoes-telas.test`, `seguranca.test` (sem X-Painel → recusado, em várias rotas) | 🟡 — não há varredura de todas as rotas |
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
| FRAN-01 | Franqueado = admin das lojas dele: dispara coletor, histórico, FIXE e robô do pedido só nas lojas dele | `admin-api.js` (`soGestor` + `lojaPermitida`); `server.js` (`/api/estoque/notas/sincronizar`, `/api/pedido/robo`, `/api/script`) | `franqueado-loja.test`; `permissoes-telas.test` | ✅ |
| FRAN-02 | Resumo diário: franqueado vê e gerencia só destinatários das lojas dele, sem token/SMTP nem destinos alheios; o que é da rede segue só do admin | `admin-api.js` (`destinoMeu`, `/notif*`); `notificacoes.js` `enviarFechamento({ lojas })`; `config.js` `abaResumoFranqueado` | `franqueado-loja.test` | ✅ (menos o envio real) |
| FRAN-03 | Configuração guiada (AppNext, Sistema de Pedidos, FIXE e Gmail da loja): abre sozinha uma vez por loja, só para o franqueado e só se faltar acesso; só admin e franqueado, só na loja dele; a resposta traz só sim/não, nunca usuário nem senha | `src/guia.js` (`situacao`, `abreSozinha`); `admin-api.js` (`/guia`, `/lojas/:id/guia/visto`); `public/js/guia.js` | `guia.test`; `franqueado-loja.test` "configuração guiada"; `guia.spec` | ✅ |
| FRAN-04 | Configuração guiada: cada passo grava pela mesma rota das Configurações; o e-mail do FIXE tem de ser o Gmail da loja (aviso nos passos 3 e 4, com a opção de acertar o FIXE junto); atalho nas Configurações e lembrete no Início enquanto faltar passo; na apresentação nada é gravado | `public/js/guia.js`; `config.js` (`cfg-guia-btn`, `TS.guia.bloco`); `inicio.js`; `/api/demo/admin/guia` | `guia.spec` (2) | ✅ na apresentação; gravação real conferida à mão em servidor de teste |
| ZAP-01 | Robô do WhatsApp: travas no servidor (ligado/pausado, dias, horário, máximo por dia, ritmo aleatório, limite da campanha, só `robo: true`) | `src/zapfila.js` `decidir` | `zapfila.test` | ✅ |
| ZAP-02 | Intervalo da loja e "não quer mensagens" valem no servidor para o robô; texto e número iguais aos do envio manual | `zapfila.js`; `public/js/msgwpp.js` | `zapfila.test` | ✅ (envio manual continua conferindo só na tela: C-03) |
| ZAP-03 | Uma mensagem por vez; pausa sozinho após N falhas; queda de conexão avisa sem marcar cliente; "parar" recebido vira optout com origem e pode ser desfeito | `src/zaplaco.js`; `zapfila.js` `voltouAAceitar` | `zapfila.test`; `zap-rotas.test` | ✅ |
| ZAP-04 | Permissões (decisão do dono): admin, franqueado da loja e gerente com Clientes conectam, ligam, configuram e marcam campanha para o robô, só nas lojas deles; vendedora e gerente sem Clientes nada (nem QR); apresentação simulada | `src/zap-api.js` (`gestor`); `server.js` (`gestorCamp`); `public/js/zap.js` (`abrirJanela`) | `zap-rotas.test`; `zap.spec` | ✅ |
| ZAP-05 | Serviço `zap/`: token em toda rota, um envio por vez, id idempotente por 24 h, optout sem guardar texto, log sem número completo; painel e serviço falam o mesmo contrato | `zap/server.js`, `zap/sessoes.js`; `src/zap.js` | `zap/tests/zap.test.js`; `zap-integracao.test` | 🟡 — sem teste com WhatsApp de verdade (`zap/wa.js` só se confere na VPS) |
| ZAP-06 | Robô sem depender da tela: o servidor refaz a lista conferida (dia novo, dados novos, no máximo 1×/h) e cria a lista nova da campanha recorrente vencida (todo dia, toda semana ou todo mês), com a conta da própria tela (uma regra só); falha da tarefa → vale o prazo de 3 dias e o robô para com aviso | `src/zapauto.js`; `public/js/campanhas.js` `TS.campanhasCalc`; `src/campanhas.js` `rodadaEmDia` (`diaria`) | `zapauto.test`; `zap.spec` (navegador × servidor) | 🟡 — a ligação em `server.js` (pacote + estoque) não é exercitada com o serviço ativo |
| ZAP-07 | Período da campanha (início e término, opcionais): fora dele o robô pula a campanha, a fila manual fica travada e a recorrente não monta lista nova; término antes do início é recusado | `public/js/msgwpp.js` `foraDoPeriodo`; `src/campanhas.js` `dadosOk`, `novaRodada`; `src/zapfila.js` `decidir` (`fora_periodo`); `public/js/campanhas.js` (campos, etiqueta, fila) | `zapfila.test` ("período da campanha"); `zapauto.test` | ✅ (campos e etiqueta sem teste de tela) |
| CONF-01 | Conferência caixa × painel por dia (tolerância por loja, padrão R$ 1,00), com motivo provável da diferença; sobras/faltas e formas de pagamento | `public/js/conferencia.js`, `conferencia-tela.js`; `src/conferencia.js`; `src/caixa.js` `resumir` | `conferencia.test`; `conferencia-rotas.test`; `conferencia.spec` | 🟡 — sem conferência contra fechamento real |
| CONF-02 | Cupons cancelados (XML) que ainda contam nas vendas: indicador e aviso; tirar das vendas só por opção da loja (padrão: só avisar), auditada | `conferencia.js` `cancelados`, `semCancelados`; `server.js` `dadosLoja` | `conferencia.test`; `conferencia-rotas.test` | 🟡 — sem dados reais |
| SAUDE-01 | Saúde dos dados: faturamento casado por código/nome/não casado, sem custo, idade das fontes (36 h / 72 h) | `conferencia.js`; `src/conferencia.js` `fontes` | `conferencia.test`; `conferencia.spec` | ✅ |
| CXP-01 | A pagar: calendário de vencimentos (fixos com dia, pontuais, notas = entrada + prazo ESTIMADO, royalties, Simples), entrada prevista por dia da semana com a parte em cartão, saldo por semana, marcar pago (tela Resultado, auditado) | `public/js/apagar.js`; `src/apagar.js`; `src/estoque.js` `cfg` | `apagar.test`; `permissoes-telas.test`; `apagar.spec` | ✅ |
| CTD-01 | Exportar o mês fechado para o contador (.xlsx, 5 abas), só com a tela Resultado, auditado | `src/contador.js`; `/api/resultado/exportar` | `contador.test`; `apagar.spec` | ✅ |
| DONO-01 | Minhas lojas lado a lado (Início com "Todas as lojas"): vendas, meta e projeção por loja, × 28 dias, zerados que vendem, validade em risco, parado, pontos de atenção; só lojas da pessoa; custo só para quem vê custo | `public/js/visaodono.js`; `TS.projecaoMes({ lojaId })` | `visaodono.test`; `visaodono.spec` | ✅ |
| DONO-02 | Sua semana (admin e franqueado): 5 números e até 3 ações priorizadas com link filtrado | `visaodono.js`; `dre.js` `TS.dreContribDias` | `visaodono.test`; `visaodono.spec` | ✅ |
| DONO-03 | Validade no Início (vencidos em vermelho, vence em 30 dias) e linha "− Perdas" no Resultado (chá vencido ainda no estoque + saldo negativo dos ajustes de inventário do mês); reduz o resultado mostrado, com aviso do valor | `visaodono.js` `avisosValidade`; `src/perdas.js`; `/api/perdas` (`podeCustos`); `dre.js` | `perdas.test`; `perdas-rota.test`; `visaodono.spec` | ✅ |
| DONO-04 | Meta de hoje dividida pelas horas da escala do dia (sem escala ou sem nome que bata: partes iguais, dito no cartão); a meta do mês e a comissão não mudam | `public/js/metadia.js`; `mapa.js` `TS.escalaTurnos`; `clientes.js` | `metadia.test`; `visaodono.spec` | 🟡 — a vendedora vê partes iguais (não recebe a escala dos colegas) |
| EST-47 | Venda perdida por falta: zerado que vendeu em até 90 dias; R$/dia = média dos 60 dias antes da última venda (o painel não guarda saldo diário); sem histórico → "—" | `public/js/ruptura.js` `perda`; `server.js` `/api/estoque` (`espera`: só contagem) | `ruptura.test`; `ruptura.spec` | ✅ |
| EST-48 | Dinheiro sobrando: "Dura" > 2× (entrega + pedido); sobra a custo acima do alvo ou do mínimo | `public/js/ruptura.js` `excesso` | `ruptura.test`; `ruptura.spec` | ✅ |
| COMP-01 | Compras × vendas do mês: compras = notas concluídas pelo dia de entrada; teto = `comprasTetoPct` (padrão 32%, 1–90, admin/franqueado, auditado) × projeção das vendas; cabe = teto − comprado − pedido | `public/js/comprasvendas.js`; `src/estoque.js` `cfg`; `pedido.js`, `dre.js`; `src/demo-compras.js` | `comprasvendas.test`; `compras-reajustes.spec` | ✅ |
| COMP-02 | Teto de compras pela previsão: % × vendas previstas para os próximos dias (entrega + período do pedido) = ritmo dos 30 dias × época do ano (fator entre 0,4 e 3; dia de data comemorativa do Pedido usa a mesma data do ano passado; no modo Data comemorativa a janela vai até o fim da data), contra o comprado nos últimos dias + pedido; sem um ano de histórico usa só o ritmo e avisa; todo quadro com a conta aberta no ⓘ | `public/js/comprasvendas.js` `previsao`, `tetoJanela`, `quadrosJanela`, `comoPrevisao`; `pedido.js` (manda janela e eventos) | `comprasvendas.test` (3 testes de previsão); `compras-reajustes.spec` | ✅ (no Resultado a previsão não usa as datas comemorativas cadastradas) |
| PRC-EF-01 | Efeito do reajuste: 30 × 30 dias por dia (qtd, receita, lucro), descontando o movimento da loja; Bom/Ruim/Igual (±2%); cedo demais e sem comparação com o motivo | `public/js/efeitopreco.js` `avaliar`, `reajustesDe`; `precos.js` | `efeitopreco.test`; `compras-reajustes.spec` | ✅ |
| EQP-30 | Venda por hora = vendas ÷ horas líquidas da escala (planejada, não ponto); sem escala ou sem par de nome → "—" | `public/js/equipe.js` `rendimento`, `casarNomes`; `mapa.js` `turnosDoPeriodo` | `equipe.test`; `equipe-fidelidade.spec` | ✅ |
| EQP-31 | Ficha da equipe só para a gestão; lucro só com custo; % CPF só com Clientes; nada vai para a vendedora | `equipe.js`; `server.js` `filtrarPorPerfil` | `equipe.test`; `equipe-fidelidade.spec` | ✅ |
| FID-20 | Retorno do programa: 3 comparações (programa × fora, resgatou × não, antes × depois), mínimo de 20 clientes, só agregado, custo só para quem vê custo | `public/js/fidretorno.js` | `fidretorno.test`; `equipe-fidelidade.spec` | ✅ |
| NFE-10 | Cadastro de parceiro novo pelo robô | `nfe.js`; `nextsoft_nfe.py` | `nfe.test` "parceiro novo"; `consulta-cnpj.spec` | 🟡 — **defeito: robô recusa a ação, ver A-05** |
| DEV-VAL-01 | Validade curta na chegada → devolução: validade do pacote digitada (ou de qualquer parte) menor que a chegada + o prazo mínimo do tipo (`VALIDADE_MIN`: chá a granel 6 meses — a validade do PACOTE, não a de depois de aberto —; envasados e alimentação 30 dias) mostra na linha da nota o aviso com o prazo e "Incluir na devolução", que abre a devolução que já existe desta nota com o item, a quantidade da parte e o motivo "validade curta (vence dd/mm/aaaa)" (tipo `validade`, sem foto; planilha e e-mail com a seção própria). Só preenche: enviar e a NF-e seguem a revisão de sempre | `lotes.js` (`VALIDADE_MIN`, `limiteValidade`, `validadeCurta`, `daNota` → `minValidade`); `devolucao.js` (`criar` com `qtdValidade`); `public/js/devolucao.js` `incluir`; `validade.js` `camposItem` | `lotes.test` "DEV-VAL-01"; `devolucao.test` "DEV-VAL-01"; `lotes-envasados.spec` "LOTE-ENV-02 e DEV-VAL-01" | ✅ (envio real fora da apresentação) |
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
| COL-01 | Disparar o coletor: admin e o franqueado na loja dele (ver PERF-11) | ver PERF-11 | `franqueado-loja.test`; `seguranca.test` | ✅ — `/api/script` sem auditoria |
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
| EQP-02 | Meta individual = meta da loja ÷ quem divide (piso de dias com venda, proporcional no mês em andamento; quem volta de férias divide; quem cobriu um dia não diminui a meta dos outros) | `contas.js` `divisoresMeta`, `metasIndividuais`; `rules.js` | `contas.test` META-01…04 | ✅ |
| EQP-03 | Comissão por categoria e faixa (≥120%, ≥100%, abaixo); modo simples | `rules.js` | — | ❌ |
| EQP-04 | "Sem meta", "não recebem comissão", "sem vendedor" | `rules.js` | — | ❌ |
| EQP-05 | Premiação por TKM, IPA e PMA | `rules.js`; `contas.js` (`MIN_ATEND_PREMIACAO`) | `contas.test` PREM-01 | 🟡 — só o mínimo de atendimentos |
| EQP-06 | Bônus sobre outros vendedores | `rules.js` | `contas.test` BON-01 | 🟡 — só a faixa do bônus |
| EQP-07 | Rateio igual do total de comissões | `rules.js` | — | ❌ |
| EQP-08 | Meta de hoje = falta do mês ÷ dias abertos que faltam; parte de cada vendedora | `clientes.js` `cartaoMetaDia` | `voltar.spec` "Hoje: meta do dia" (só aparece) | 🟡 |
| EQP-09 | Férias: datas válidas, até 300 períodos, auditadas | `admin-api.js` | `config-sem-null.spec` (só abre) | ❌ |
| EQP-10 | Vendedora não recebe escala, equipe nem horas das colegas | `filtrarPorPerfil` | — | ❌ |
| EQP-11 | Comissão projetada: a venda projetada de cada pessoa cai na faixa certa (não comissão parcial × fator); premiação e bônus pelas vendas da meta | `contas.js`; `rules.js` | `contas.test` COM-PROJ-01, BON-01 | ✅ |
| EQP-12 | Regras da loja (piso de dias da meta 1–31, mínimo de atendimentos 0–2000) validadas no servidor | `contas.js` (`PISO_DIAS_META`, `MIN_ATEND_PREMIACAO`); `admin-api.js` | `contas.test` CFG-01 | ✅ |
| VEND-REGRAS-01 | "Não entram no rateio", "Sem meta individual" e "Não recebem comissão" escolhem entre os vendedores ativos da loja (venda nos últimos 90 dias); nome antigo fica marcado "inativo"; o servidor recusa nome que não é vendedor da loja (aceita os já salvos, os dos modelos e "sem vendedor") | `src/vendregras.js`, `admin-api.js` PUT regras, `config.js` `seletorVendedores` | `vendregras.test`, `vend-regras.spec` | ✅ |

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
| EST-27 | Trava de estoque nas mensagens (chá a granel só com pelo menos 100 g: `MINIMO_GRANEL_KG`, decisão do dono) | `lotes.js` `disponivel` | `lotes.test` ("pelo menos 100 g"); `regras.spec` | ✅ |
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
| EST-PED-TAB-01 | Pedido, tabela de Produtos: mudar uma quantidade não volta para a 1ª página nem troca a ordem (`TS.table` com `estado`); a linha que muda de aba com a alteração fica onde está, marcada, até trocar de aba ou de filtro | `components.js` `TS.table({ estado })`; `pedido.js` (`estTab`, `ficam`) | `pedido-tabela.spec` "2ª página" | ✅ (computador; no celular a lista é em cartões) |
| EST-PED-GRUPO-01 | Pedido: o grupo mostrado em cada produto é o do AppNext como sai na venda (ex.: CHÁ VERDE AROMATIZADO), nunca a parte do pedido ("Chás a granel"); o filtro "Grupo" usa os mesmos grupos do filtro das Vendas; as partes da proporção ficam no filtro "Parte do pedido"; no celular o subgrupo vai ao lado do código | `grupoprod.js`; `pedido.js` (`grpTxt`, `gpTxt`, `cadastroDasLinhas`) | `pedido-tabela.spec` "colunas novas" | ✅ (apresentação; nomes reais dos grupos a conferir na loja) |
| EST-PED-GRUPO-02 | Pedido: o filtro "Grupo" lista só grupos que existem no filtro das Vendas (produto sem venda entra pelo grupo do cadastro convertido pela relação que as vendas mostram; o resto é "sem grupo"); produto sem grupo não mostra a parte do pedido; filtro "No site" mostra só o que dá para colocar no carrinho | `grupoprod.js` (`vendasDe`); `pedido.js` (`gpTxt`, `fx.d`) | `grupoprod.test` GRP-05; `pedido-tabela.spec` "colunas novas" | ✅ |
| EST-PED-ABAS-01 | Pedido: 5 abas na ordem do pedido (Carrinho completo = obrigatório + complemento · Pedido obrigatório · Complemento · Verificar · Site de pedidos completo), cada uma com explicação, quebrando em linhas no celular; "Verificar" só com o que dá para pedir (o resto numa linha com "Mostrar"); quadro das ⭐ Sugestões começa recolhido | `pedido.js` (`FILTROS`, `aVerificar`, `daPraPedir`, `avisoVer`, `state.pedSug`); `styles.css` (`.ped-tools .seg`) | `faixa-abas.spec` "5 abas"; `pedido-tabela.spec`; `sugestoes.spec` | ✅ |
| EST-PED-TAB-03 | Pedido no celular: mudar a quantidade não muda o cartão de lugar (a ordem dos cartões é fixada por aba/filtro; só reordena ao trocar de aba ou de filtro); subgrupo igual ao nome do produto não é mostrado | `pedido.js` (`listaMobile`, `estTab.ordMob`, `subDif`) | `faixa-abas.spec` "apertar ＋ várias vezes" | ✅ |
| EST-PED-CONJ-02 | Favorito e robô: a janela "Venda Conjunta" é reconhecida pelo texto exato do botão (link, botão, campo ou bloco clicável), sem exigir tamanho; janela fechada não conta; segunda tentativa pelo link; quando o site não confirma, o item leva um diagnóstico do que havia na página | `carrinho-site.js` (`vendaConjunta`, `clicar`, `seguirLink`, `diagnostico`, `avisoDoSite`); `nextsoft_pedido.py` (`venda_conjunta`) | `carrinho-conjunta.spec`; `carrinho-salvo.test` | 🟡 (páginas de mentira; no site real a 1ª versão falhou e a causa não foi vista: conferir com o dono) |
| EST-PED-EST-01 | Aviso de estoque do Sistema de Pedidos ("O produto X não possui estoque suficiente", loja real 22/11/2026): o favorito e o robô acham o aviso também fora do `.modal` de sempre (qualquer janela visível ou bloco com a frase), fecham pelo "Fechar", esperam até +8 s pelo aviso antes de dar "sem confirmação" e, quando o aviso chega atrasado durante outro produto, marcam o produto citado no texto (nunca o seguinte); status `sem_estoque` = "Fora de estoque" (sem "Tentar de novo") | `carrinho-site.js` (`avisoDoSite`, `donoDoAviso`, `avisoDe`, `atribuirAviso`); `nextsoft_pedido.py` (`AVISO_JS`, `aviso_do_site`, `dono_do_aviso`, `status_do_aviso`); `pedido.js` (rótulo); `src/sugestoes.js` (motivo) | `carrinho-conjunta.spec` "aviso de estoque atrasado…" e "bloco sem botão…"; `carrinho-salvo.test` "robô: aviso de estoque atrasado…" | 🟡 (páginas de mentira; conferir no site real com o próximo pedido) |
| EST-PED-MAX-01 | Pedido: o máximo por pedido do Sistema de Pedidos aparece ao lado da quantidade e o painel não deixa passar dele | `pedido.js` (`maxPed`, `.ped-max`) | `faixa-abas.spec` "apertar ＋ várias vezes" | ✅ |
| NFE-CFOP-01…04 | CFOP da NF-e de venda e de devolução escolhido pela loja (Configurações → Integrações e passo 5 opcional da configuração guiada): só admin e franqueado da própria loja; só CFOP de saída (5xxx/6xxx) ou automático; opções lidas do AppNext; o robô usa só o escolhido e para se não houver regra fiscal com ele; sem escolha, continua 5102 / regra da loja; o passo opcional nunca vira pendência | `nfecfop.js`; `admin-api.js` (`/lojas/:id/nfe-cfop`, estado); `guia.js` (servidor e tela, `formCfop`); `config.js` (`blocoNfeCfop`); `nfe.js`, `devolucao.js`; `nextsoft_nfe.py` (`LER_CADASTROS.cfops`, `PREENCHER`, `DEVOLVER`) | `nfecfop.test` 01…04; `franqueado-loja.test` "CFOP das NF-e" (gravar e ler); `guia.test`; `guia.spec` (passo 5 com "Buscar no AppNext" e cartão) | 🟡 (robô conferido só pelo código: o primeiro uso real no AppNext precisa ser acompanhado) |
| TELA-FAIXA-01 | Faixa que rola para o lado (abas `TS.seg`, submenu) refeita a cada clique mantém a opção marcada à vista, em vez de voltar para o começo | `components.js` (`TS.ativoVisivel`, `TS.seg`); `main.js` (`TS.subGrupo`) | `faixa-abas.spec` (celular: última aba do Pedido e último item do submenu) | ✅ |
| GRP-01…04 | Grupo do produto no AppNext, definição única para todas as telas: pelo código vendido; chá a granel pelos pacotes dele (o grupo mais frequente, não o do minitin); por último pelo nome; produto pronto não herda grupo de pacote por coincidência de código; sem venda → grupo do cadastro de preços ou nada. Aparece embaixo do nome em Estoque, Rentabilidade, Preços, Pedido, ⭐ Sugestões, Validade, Inventário, Vendas por produto, Lista de espera e busca de produto das Campanhas (nota fiscal e Orçamento ficam sem, decisão do dono) | `grupoprod.js` (`montar`, `de`, `texto`, `marca`, `coluna`); `estoque.js` (`grpDe`), `precos.js`, `pedido.js`, `sugestoes.js`, `validade.js`, `inventario.js`, `pages.js`, `espera.js`, `campanhas.js` | `grupoprod.test` GRP-01…04; `grupo-produto.spec` (Estoque, Rentabilidade, Preços, Pedido) | ✅ conta; 🟡 telas (4 das 10 com teste de tela; nomes reais dos grupos a conferir na loja) |
| FOTO-01…03 | Foto do produto do site nas listas: só endereço https dos servidores conhecidos (ao ler o site e ao entregar); a foto da variante vem primeiro, até 4; a lista para as telas só traz quem tem foto e não leva preço; o cabeçalho de segurança só libera imagem de fora desses servidores. Miniatura antes do nome (40 px computador, 52 px celular) no Pedido e nas ⭐ Sugestões; tocar abre a foto grande; chá a granel e produto sem foto ficam como eram | `site.js` (`fotoOk`, `itensDe`, `fotos`, `HOSTS_FOTO`); `server.js` (`/api/site/fotos`, `img-src`); `fotoprod.js` (`TS.foto`); `pedido.js` (`fotoCel`), `sugestoes.js` | `site-fotos.test` FOTO-01…04 (04: código com letra no fim, zeros, nome sem " - Tea Shop", lista vazia); `foto-produto.spec` (Pedido, Sugestões, cabeçalho) | ✅ (formato, servidor das fotos e tamanho reduzido conferidos com o catálogo real em 20/11/2026) |
| EST-PED-TAB-02 | Pedido: filtro por subgrupo (do cadastro de preços; no chá a granel, o dos pacotes); coluna Margem bruta de tabela (chá a granel = média dos pacotes de 50 g e 100 g, com a conta na dica); classe como ícone no nome (⭐ Estrela, 👍 Joia, 📦 Volume, 💤 Peso morto) no lugar da coluna; sem a coluna "Lucro sem fixos/dia" (a ordem padrão continua por ela) | `pedido.js` (`cadastroDasLinhas`, `CLASSE_ICO`) | `pedido-tabela.spec` "colunas novas" | ✅ na apresentação |
| EST-PED-SALVO-01 | Carrinho salvo do Pedido: guarda as quantidades por 5 dias (um por loja), só para quem tem a tela Pedido e só na loja dela; a tela avisa e "Continuar de onde parei" troca o pedido pelo salvo (produto que saiu do catálogo fica de fora); auditado; na apresentação nada é gravado | `pedido.js` (`rascunho`, `salvarRascunho`, `apagarRascunho`); `PUT/DELETE /api/pedido/rascunho`; `public/js/pedido.js` (`btnSalvar`, `aplicarRasc`) | `carrinho-salvo.test`; `franqueado-loja.test` "carrinho salvo"; `carrinho-salvo.spec` | ✅ — o "continuar" foi testado com o carrinho fictício da apresentação, não com um salvo de verdade na tela |
| EST-PED-CONF-01 | Carrinho montado no site não é pedido feito: o registro pergunta "Este pedido foi finalizado no site?"; Confirmar guarda quem e quando; Excluir apaga o registro, invalida o código do favorito e devolve para o próximo pedido as ⭐ sugestões que tinham ido para "aguardando entrega" naquele carrinho; só quem tem a tela Pedido, na loja dele; auditado; não mexe no site | `pedido.js` (`confirmarCarrinho`, `excluirCarrinho`); `sugestoes.js` `desfazerPedido`; `POST /api/pedido/carrinho/confirmar|excluir`; `public/js/pedido.js` `resultadoCarrinho` | `carrinho-salvo.test` "carrinho montado"; `franqueado-loja.test`; `carrinho-salvo.spec` | ✅ — o fluxo real pela tela (confirmar/excluir gravando) só foi testado nas rotas e no servidor |
| SUG-CARR-01/02 | Sugestão da equipe "aguardando entrega" pertence ao carrinho que a criou: carrinho refeito (pedido ainda não confirmado) leva a espera junto e "Excluir" devolve; pedido confirmado fica firme (outro carrinho não leva nem desfaz); sem carrinho para excluir, "Não pedi" (linha) e "Não fiz este pedido" (todas as não confirmadas) devolvem para o próximo pedido, com auditoria | `sugestoes.js` (`fechar`, `desfazerPedido`, `confirmarPedido`, `devolver`); `server.js` (`/api/pedido/carrinho/confirmar|excluir`, `/api/pedido/sugestoes/devolver`); `pedido.js` (`.sug-naopedi`, `.sug-naofiz`) | `sugestoes.test` SUG-CARR-01/02; `carrinho-salvo.test`; `sugestoes.spec` "Não fiz este pedido" | ✅ |
| PED-EV-01 | "Data comemorativa" sem escolha abre na próxima data (a que começa antes, entre as que não terminaram), nunca a primeira da lista | `pedido.js` (`eventoPadrao`, `TS.pedidoCalc`) | `pedido-tabela.spec` "abre na PRÓXIMA data" | ✅ |
| PED-PEND-01 | Pedido: carrinho anterior que falta confirmar e carrinho salvo numa linha no topo, com as mesmas ações do histórico (sem rota nova); no celular, ajustes recolhidos numa linha de resumo; botão da barra "Ir para o carrinho ›" | `pedido.js` (`.ped-pend`, `acaoCarrinho`, `.ped-ctl-rec`) | `carrinho-salvo.spec` (2); `leiaute.spec` "Pedido: ajustes" | ✅ |
| SUG-TELA-01 | ⭐ Sugestões: confirmação que não some, linha nova em destaque; resposta nova abre na aba dela, diz produto e resultado e o destaque dura a visita; erro da justificativa no campo; "Estoque agora" da vendedora só quando mudou | `sugestoes.js` (`state.sugMsg`, `vis`, `resultadoTxt`) | `sugestoes.spec` "marcar produto…", "aviso de resposta…" | ✅ |
| WPP-EMOJI-01 | Envio manual pelo WhatsApp (campanhas, ficha do cliente, Lista de espera, Orçamento) abre `api.whatsapp.com/send?phone=…&text=…`, não `wa.me/…?text=`: pelo wa.me os emojis chegavam como "��" no celular (acentos passavam). Texto vai bem formado (metade de emoji some, não derruba) | `msgwpp.js` (`linkComTexto`); `clientes.js` (`linkWpp`), `espera.js`, `orcamento.js` | `zapfila.test` WPP-EMOJI-01 | 🟡 (codificação conferida; a entrega no WhatsApp real precisa ser confirmada pelo dono) |
| EST-PED-CONJ-01 | Venda conjunta do site (mug + infusor): o favorito e o robô aceitam em "Colocar Todos no Carrinho" (decisão do dono), uma vez por produto, e nunca finalizam o pedido; o que veio junto aparece no resultado e o par fica guardado por loja | `carrinho-site.js` `vendaConjunta`; `coletor/nextsoft_pedido.py` `venda_conjunta`; `pedido.js` `progresso`, `conjuntos` | `carrinho-salvo.test` (2); `carrinho-salvo.spec` "Favorito" (janela de mentira) | 🟡 — não testado no site real; a janela foi reproduzida pelo print do dono. O robô em Python não tem teste automático |
| EST-ABERTO-01 | Chá a granel: a validade do chá aberto (pacote de 1 kg na lata) é 6 meses a partir da abertura, no lugar da data da chegada, sem teto pela validade do pacote (decisão do dono, 20/11/2026); a coluna Validade mostra essa data final de consumo; lote só com pacote fechado segue a validade do pacote; o pacote aberto é deduzido pelo saldo e os fechados ganham a ordem de abertura; clicar no nome do chá abre os lotes (nota, chegada, aberto ou fechado, abertura, vencimento) | `src/lotes.js` (`pacotesDoLote`, `comAbertura`); `validade.js` (`pacotes`, `janelaPacotes`, coluna Validade) | `abertura.test`; `lotes.test`; `abertura.spec` | ✅ |
| EST-ABERTO-06 | Toda data de vencimento vem preenchida e pode ser editada: validade do pacote (na chegada) e "consumir até" (depois de aberto), com volta para a sugerida; auditado | `lotes.js` `editar`, `editarAbertura` (`ate`); `PUT /api/validade/abertura`, `/api/validade/lote` | `abertura.test` "abri um pacote hoje"; `abertura.spec` | ✅ |
| EST-ABERTO-07 | Histórico de aberturas: quando o pacote acaba, fica registrado por chá (nota, chegada, abertura estimada ou informada por quem, vencimento e quando acabou), por 3 anos, e aparece na janela dos lotes; pacote que deixou de estar aberto porque o estoque voltou atrás não vira histórico; alterações à mão seguem também na auditoria | `lotes.js` (`observarAberturas`, `historicoAberturas`); `/api/validade` (`historico`); `validade.js` `janelaPacotes` | `abertura.test` "primeira observação", "abri um pacote hoje"; `abertura.spec` | ✅ (começa a contar da instalação: não há histórico retroativo) |
| EST-ABERTO-02 | Data de abertura estimada pelo ritmo de compra, nunca antes da chegada; guardada na primeira observação (depois de cada atualização dos dados, não em leitura de tela); a equipe pode corrigir (entre a chegada e hoje), auditado | `lotes.js` (`estimarAbertura`, `observarAberturas`, `editarAbertura`); `PUT /api/validade/abertura` | `abertura.test` "primeira observação"; `abertura.spec` | 🟡 — a estimativa em si não tem como ser conferida sem a loja; a rota de correção não tem teste de permissão próprio (usa `lojaVal`, o mesmo do lote) |
| EST-ABERTO-03 | Saída e entrada pelo AppNext: saída sai do lote mais antigo e abre o próximo pacote; entrada sem nota vira saldo sem data; valor em risco e perdas contam só o que está na lata quando o prazo é o da abertura | `lotes.js` (`distribuir`, `resumo`, `kgVence`); `perdas.js` | `abertura.test` "entrada e saída", "chá parado" | ✅ |
| EST-ABERTO-04 | Aviso no aparelho quando um chá aberto entra nos últimos 30 dias do prazo, uma vez por pacote, para quem usa a Validade | `server.js` (`avaliarEspera`); `push.js` (tipo `validade`) | `abertura.test` "não repete"; `push.test` | 🟡 — o disparo de ponta a ponta não é testado |
| UN-ENV-01 | Chá envasado é vendido em pacote fechado e contado em UNIDADE, mesmo cadastrado em "Kg" no AppNext (decisão do dono: "9,000 kg" = 9 pacotes). Um ponto só: `ES.atual` devolve o envasado como "Un" (`tipoProd`, `unAppNext`) e todas as telas (Estoque, Pedido, mínimo, previsão, inventário) usam unidade; a trava de 100 g é só do granel; a planilha do inventário devolve a unidade do AppNext. Tipo do produto (granel, envasado, alimento) definido uma vez em `src/tipoprod.js`: grupo do AppNext (nota de entrada, cadastro de preços) e, sem grupo, o nome do item em kg | `tipoprod.js` (`tipo`, `normalizar`); `estoque.js` `atual`/`atualCru`; `inventario.js` (`ua`); `demo.js` | `tipoprod.test` (2); `lotes.test` "UN-ENV-01"; `lotes-envasados.spec` "UN-ENV-01" | ✅ |
| LOTE-ENV-01 | Chás envasados e alimentação têm lote e validade como o granel (validade digitada por quem dá a entrada; padrão 12 meses da chegada; PEPS), mas **só isso**: sem abertura, sem "na lata", sem histórico; em unidade. Ficam em `outros` (os `lotes` continuam só do granel: campanhas, Promoção, Pedido e inventário por lote não mudam). Tela Validade com abas Chá a granel / Envasados / Alimentação; avisos do Início, valor em risco e perdas (unidade × custo) | `lotes.js` (`calcular` → `outros`, `paraTela`, `resumo` kg/un); `perdas.js` (`unVencidos`); `validade.js` (`TIPOS`, `doTipo`); `visaodono.js` `avisosValidade` | `lotes.test` "LOTE-ENV-01"; `lotes-envasados.spec` "LOTE-ENV-01" | ✅ |
| LOTE-ENV-02 | Validades diferentes na mesma linha da nota (só envasado e alimentação): "+ outra validade" reparte a quantidade em partes {qtd, validade}; a soma das partes a mais é menor que a quantidade da nota (o resto fica na 1ª, com a validade do lote); cada parte vira um lote e, dentro da nota, sai primeiro a validade mais curta; tirar as partes volta para uma data só | `lotes.js` (`repartir`, `expandirPartes`, `partes` em `validade/lotes.json`); `PUT /api/validade/partes` (auditado); `validade.js` `camposItem` | `lotes.test` "LOTE-ENV-02"; `lotes-envasados.spec` "LOTE-ENV-02" | ✅ (gravação real só no teste de unidade) |
| EST-ABERTO-05 | Janela dos lotes do chá (a mesma ao clicar no nome do chá no Estoque e na Validade): em cima o chá aberto (nota, chegada, abertura, vencimento depois de aberto e quantidade, com as datas editáveis); embaixo os lotes fechados, do mais antigo para o mais novo (nota, chegada, validade do pacote, quantidade) com "Abrir lote", que marca a abertura hoje e o vencimento 6 meses depois; vale mesmo com outro pacote da mesma nota ainda na lata (dois abertos, cada um com a sua data) | `lotes.js` (`comAbertura` → `abertos`, `editarAbertura` com `abrir` e `n`); `validade.js` `janelaPacotes`; `estoque.js` (`est-nome-cha`) | `abertura.test` "abri um pacote hoje", "Abrir lote com outro pacote"; `abertura.spec` (2) | ✅ na apresentação; gravação real só no teste de unidade |
| RD-PED-01 | Pedido → Produtos sem rolar para o lado a 1100 px (6 colunas, detalhe embaixo) | `pedido.js` colunas, CSS `.ped-t` | `tests/datas/datas.spec.js` (DATA-01 Pedido), `pedido-tabela.spec` | ✅ |
| VAL-NF-01 | Na Validade, o "NF nº" do lote abre a janela da nota de entrada por cima da tela (a mesma de Notas fiscais), só para quem tem a tela Notas fiscais | `validade.js` `linkNF`, `precos.js` `TS.abrirNotaEntrada` | `validade-nf.spec` | ✅ |

## 10. Preços, custos e notas de entrada (PRC)

| Código | Regra | Onde está garantida | Teste | Cobertura |
|---|---|---|---|---|
| PRC-01 | Custo e margem nunca para a vendedora (ver PERF-04) | rotas de estoque | `permissoes-telas.test` "telas de custo" | ✅ |
| PRC-02 | Inventário: vendedora sem custo nem quantidade do sistema | `inventario.js` | `inventario.test` | 🟡 |
| PRC-03 | Validade: custo do lote só para quem vê custos | `semCusto` | — | ❌ |
| PRC-05 | "Sincronizar agora" das notas: admin e o franqueado na loja dele | `server.js` | `franqueado-loja.test` "Sincronizar agora (notas de entrada)" | ✅ |
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
| PRC-EF-02…07 | Efeito do reajuste, bordas: preço subiu e a venda caiu demais = ruim; desconta o movimento da loja; cedo demais mostra prévia (< 30 dias) ou nada (< 7); sem base não inventa; reajuste vem do cadastro (o caixa só antes do histórico); amostra mínima de 30 unidades | `public/js/efeitopreco.js` `avaliar`, `reajustesDe` | `efeitopreco.test` PRC-EF-02…07 | ✅ |
| CLS-01…04 | Classe do produto com critério absoluto pela margem mínima/alvo da loja (não só pela mediana): Estrela só com margem boa de verdade; Peso morto só com giro baixo e margem abaixo do alvo; bordas (sem margem sem fixos usa a bruta) | `public/js/classeprod.js` | `classeprod.test` CLS-01…04 | ✅ |
| COMP-03…05 | Compras × vendas, bordas: sem dado não inventa número; janela de 12 meses e teto configurável (1–90%, padrão 32%); apresentação com compras fictícias dos meses anteriores | `public/js/comprasvendas.js`; `src/demo-compras.js` | `comprasvendas.test` COMP-03…05 | ✅ |

## 11. Resultado e rentabilidade (RES)

| Código | Regra | Onde está garantida | Teste | Cobertura |
|---|---|---|---|---|
| RES-01 | Resultado do mês (DRE) | `dre.js` | `contas.test` FAT-02 (o mesmo faturamento no Resultado), EQ-01; `telas.spec` (abre) | 🟡 — texto do ⓘ contradiz a conta, ver D-02 |
| RES-02 | Projeção do mês em andamento | `dre.js` | — | ❌ |
| RES-03 | Comparação com o ano anterior | `dre.js` | — | ❌ |
| RES-04 | Custo na data da venda (notas + fotos do estoque), nunca o custo de hoje no passado; sem histórico, o mais antigo marcado como estimado | `custodata.js`; `dre.js` | `custodata.test` CUSTO-01…03 | ✅ |
| RES-05 | Rentabilidade: lucro, contribuição, curva ABC, por vendedora | `estoque.js` | `regras.spec`, `voltar.spec` (layout) | 🟡 |
| RES-06 | Por tamanho de pacote e "qual pacote oferecer" | `estoque.js` | `voltar.spec` (layout) | 🟡 |
| RES-07 | Margem abaixo da mínima, com o motivo | `estoque.js` | — | ❌ |
| RES-08 | Lucro da promoção | `estoque.js` | — | ❌ |
| RES-09 | Custos que mudaram | `estoque.js` | — | ❌ |
| RES-10 | Ponto de equilíbrio inclui as despesas só deste mês (as mesmas do Resultado) | `contas.js` `pontoEquilibrio`; `estoque.js`; `dre.js` | `contas.test` EQ-01 | ✅ |
| CXP-02…06 | A pagar, detalhes: vencimento da nota estimado (entrada + prazo, só compra concluída); entrada prevista (dinheiro e Pix no dia, cartão N dias depois sem a taxa; parte em cartão pelos fechamentos de caixa); saldo por semana com aviso; conta paga sai das somas (servidor grava por loja e recusa valor inválido); configuração dos prazos | `src/apagar.js`; `public/js/apagar.js` | `apagar.test` CXP-02…06 | ✅ |
| CTD-02…05 | Exportação para o contador: vendas por dia pelo faturamento oficial, notas do mês (entrada pela data de entrada; cancelada fora do total), mês sem nada e só mês fechado, planilha .xlsx com as cinco abas | `src/contador.js` | `contador.test` CTD-02…05 | ✅ |
| LUCRO-01 | Uma definição de lucro em três degraus no Resultado e na Rentabilidade (decisão do dono, 23/11/2026): lucro bruto = venda − custo dos produtos; lucro sem fixos = lucro bruto − Simples, maquininha, royalties, comissão e custos em %; resultado = lucro sem fixos − perdas − custos fixos | `dre.js` `calcular`/`projetar`/`LINHAS`; `estoque.js` Rentabilidade | `contas.spec` | ✅ |
| DRE-MES-01 | Custo fixo de cada mês, uma definição só (pedido do dono, 23/11/2026): o valor real lançado no Resultado vale só naquele mês; sem lançamento, o padrão de Configurações (meses passados sem lançamento acompanham o padrão quando ele muda; o lançado fica). Entra no Resultado, na projeção, na Rentabilidade (rateio pela média dos meses da base), no A pagar, no ponto de equilíbrio e na planilha do contador | `contas.js` `fixoDoMes`; `estoque.js` `criarDeducoes` (`fixoDoMes`, `fixoBase`); `dre.js` `calcular`; `apagar.js` `vencimentos(valorDoMes)`; `src/contador.js` | `dre-mes.test` DRE-MES-01 | ✅ |
| DRE-MES-02 | Histórico do custo fixo mês a mês (lançado ou padrão) com a média, na janela do custo (nome na tabela) | `contas.js` `historicoFixo`; `dre.js` `janelaFixo` | `dre-mes.test` DRE-MES-02; `dre-mes.spec` DRE-MES-09 | ✅ |
| DRE-MES-03…08 | Rota `POST /api/resultado/fixo-mes`: grava por loja em `dados/<loja>/fixos-mes.json` com quem e quando, auditada; só quem tem a tela Resultado (vendedora e gerente sem a tela: 403) e só da loja permitida; exige `X-Painel`; confere valor (≥ 0), mês (AAAA-MM, até 12 à frente) e custo existente; "voltar ao padrão" apaga só aquele mês; mudar o padrão em Configurações não muda o mês lançado; apresentação só confere e responde (nada gravado) | `src/fixosmes.js`; `server.js` (`lojaDre`, `/api/demo/resultado/fixo-mes`) | `dre-mes.test` DRE-MES-03…08 | ✅ |
| DRE-MES-09 | Tela: clicar no valor do custo fixo num mês abre o campo (Salvar, sem gravar a cada dígito; erro em `TS.naoSalvo`), o mês fica com ✎ e o total muda; "Voltar ao padrão" desfaz | `dre.js` `celFixo`/`janelaFixo`/`salvarFixo`; `estoque.js` `TS.estoqueFixosMes` | `dre-mes.spec` DRE-MES-09 (computador e celular) | ✅ |

## 12. Vendas e métricas (VEN)

| Código | Regra | Onde está garantida | Teste | Cobertura |
|---|---|---|---|---|
| VEN-01 | Carrega 24 meses + mês atual | `main.js` `desdeParcial`; servidor | — | ❌ |
| VEN-02 | Histórico completo carrega sozinho quando a tela precisa | `main.js` `precisaCompleto` | — | ❌ |
| VEN-03 | Botão "Carregar desde…" | `pages.js` | — | ❌ |
| VEN-04 | Atalhos de período pelo último dia com venda | `pages.js` | `filtros-topo.spec` PER-ONTEM | 🟡 — só o atalho "Ontem" |
| VEN-05 | Só o mês (sem ano) = o mês em todos os anos | `pages.js`; `core.js` | — | ❌ |
| VEN-06 | Cupom único = cupom + loja + dia | `core.js` | `blind` "chaveCupom…" | ✅ |
| VEN-07 | TKM, PMA e IPA na mesma base (faturamento oficial, itens sem consumível, atendimentos = cupons únicos) | `contas.js` `resumo`; `core.js` `metricas` | `contas.test` ATD-01, FAT-01; `contas.spec` CUP-01 | ✅ |
| VEN-08 | Consumíveis entram no faturamento, não contam como item | `core.js`; `fechamento.js` | `contas.spec` CUP-01 (itens da tela Cupons = conta oficial) | 🟡 — consumível sem controle sem teste próprio |
| VEN-09 | Desconto por unidade ou por linha detectado nos dados | `core.js` | — | ❌ |
| VEN-10 | Prêmio de fidelidade a R$ 0,01 reconhecido | `core.js` `ehResgate` | `voltar.spec` (indireto) | 🟡 |
| VEN-11 | Resumo e Comparativos sem "SEM VENDEDOR" | `pages.js` | — | ❌ |
| VEN-12 | Comparação com o período anterior / ano anterior | `pages.js` | — | ❌ |
| VEN-13 | Meta do mês (ver EQP-01) | `core.js`; `indicadores.js` | `voltar.spec` (só aparece) | 🟡 |
| VEN-14 | Projeção do mês: pelo dia da semana, sem o dia em andamento, feriado/fechado conta zero, período personalizado parte do fim do período; mesma conta na tela e no servidor | `contas.js` `projecaoMes`; `extras.js` | `contas.test` PROJ-01…05; `contas.spec` | ✅ |
| VEN-15 | Promoção: antes × durante, pela média por dia | `pages.js` | `telas.spec`; `regras.spec` | 🟡 |
| VEN-16 | Cupons: CPF só para quem vê clientes; NF-e de mesmo número vira "Nota fiscal" | `pages.js` | `regras.spec` "cupom com NF-e…" | ✅ (NF-e) |
| VEN-17 | Média da franquia anônima | `pages.js`; `/api/rede` | `contas.test` REDE-01 (ritmo da meta, não "meta atingida") | 🟡 — anonimato da rede sem teste |
| VEN-18 | Mapa de calor sem feriados | `mapa.js` | `telas.spec` | 🟡 |
| VEN-19 | Início: avisos por gravidade | `inicio.js` | `ia.spec`; `regras.spec`; `voltar.spec` | 🟡 |
| VEN-20 | Filtros acompanham a pessoa (pedido do dono, 23/11/2026): trocar de loja mantém período (o relativo recalcula pela loja nova), grupo, categoria, produto e tamanho; o que não existe na loja nova sai sozinho; guardados num só lugar para todas as lojas | `main.js` `aplicar`, `keyFiltros`; `TS.filtrosEmTexto`/`filtrosDeTexto` | `filtros-loja.spec` FILTROS-LOJA | ✅ |
| FAT-01…02 | Faturamento da loja: com Espaço Gourmet e sem vendedor, sem taxas e sem itens a R$ 0,01; o MESMO número no Resumo, Início, Resultado e no resumo do servidor | `contas.js` `contaFat`, `resumo`; `core.js` `TS.contaFat` | `contas.test` FAT-01…02; `contas.spec` | ✅ |
| ATD-01 | Atendimentos: por vendedor o cupom conta para cada um; o total da loja nunca soma duas vezes | `contas.js` `resumo`; `core.js` `metricas` | `contas.test` ATD-01 | ✅ |
| CUP-01 | Vendas → Cupons (pedido do dono, 23/11/2026): cupons, itens e valor da tela (herói, totais da árvore e da lista) pela conta oficial `TS.metricas`; linha de taxa, item a R$ 0,01 e consumível sem controle aparecem marcados "não conta" e ficam fora dos totais | `pages.js` (`TS.pages.cupons`, `arvoreCupons`, `naoContaTxt`); `core.js` `TS.metricas` | `contas.spec` CUP-01 | ✅ |
| CONF-DEMO-01 | Conferência na apresentação: o exemplo de caixa fechado depois da meia-noite aparece em qualquer data | `public/js/conferencia.js`; `src/demo.js` | `conferencia.test` CONF-DEMO-01 | ✅ |
| NUM-01 | Faturamento, atendimentos, TKM, PMA e IPA iguais no Resumo, Cupons, Comparativos e Promoção (28 dias e mês) e à conta oficial | `core.js` `TS.metricas`, `contas.js` | `contas.spec` | ✅ |
| NUM-02 | Vendas por produto fecha com itens, chá vendido e faturamento (sem R$ 0,01, sem consumível sem controle, kg só de chá) | `pages.js` Resumo | `contas.spec` | ✅ |
| NUM-03 | Vendas da meta do Comissionamento = conta oficial = Início; TKM da equipe sem Espaço Gourmet, explicado no ⓘ | `rules.js`, `pages.js` Comissionamento | `contas.spec` | ✅ |

## 13. Clientes, fidelidade, WhatsApp e lista de espera (CLI)

| Código | Regra | Onde está garantida | Teste | Cobertura |
|---|---|---|---|---|
| CLI-01 | Vendedora não recebe clientes (ver PERF-06) | servidor | — | ❌ — exceção da Lista de espera, ver A-01 |
| CLI-02 | WhatsApp manual: um clique = uma mensagem, marca contatado | `clientes.js`, `campanhas.js`, `espera.js` | `regras.spec` (2, só vê o item) | 🟡 |
| CLI-03 | Intervalo mínimo entre mensagens por cliente (padrão 21 dias) | `clientes.js` `recebeuRecente`; `campanhas.js` | — | ❌ — vale só na tela, ver C-03 |
| CLI-04 | "Não quer mensagens" tira o cliente de tudo | `server.js` contatos; telas | — | ❌ |
| CLI-05 | Campanha: limite por dia e rodízio das variações | `campanhas.js` | `regras.spec` (outra coisa) | ❌ |
| CLI-06 | Trava de estoque: não oferece produto sem estoque | `clientes.js`; `campanhas.js` | `regras.spec` "Trava de estoque…" | ✅ |
| RESUMO-01…06 | Campanha Resumo diário: lista de Clientes → Hoje só com os motivos escolhidos, um cliente por motivo mais importante, texto do motivo com a vendedora (`{apresentacao}`), mesma conta na tela e no servidor; regra forte do envio manual (409 com explicação: já recebeu no intervalo, não quer, está na fila do robô) | `clientes.js` (`hojeItens`, `enviarWpp`); `campanhas.js` (`listaResumo`, `listaAgora`, `editarResumo`); `msgwpp.js` (`MOTIVOS_RESUMO`, `textosDe`); `campanhas.js` (servidor: `porMotivo`, `m`/`o`); `zapfila.js` (`decidir`, `envioManualBloqueado`); `zapauto.js` (`lista`, `deps.validade`); `server.js` (`/api/contatos`) | `zapfila.test` RESUMO-01…03; `zapauto.test` RESUMO-04; `zap-rotas.test` RESUMO-05; `resumo-diario.spec` RESUMO-06 | ✅ (envio real pelo WhatsApp conferido só com o robô de mentira) |
| CONV-01…12 | Clientes → Conversas (fase 1, só leitura): o serviço guarda as conversas individuais (sem grupos; mídia só a marca) e importa o histórico; o painel busca a cada 30 s, guarda 12 meses sem repetir, marca "N sem resposta" (mensagens do cliente depois da última da loja; decisão do dono 22/11/2026) e as mensagens do robô (🤖 também na lista); no computador, lista à esquerda e conversa à direita, cada coluna rolando sozinha até o pé da janela, trocar de conversa não mexe na lista (CONV-12, decisão do dono 22/11/2026); voltar do celular fecha a conversa; a atualização não tira a leitura do lugar; lista sem Imprimir; apresentação com lista e conversa da mesma conta; desconectar apaga; só admin e franqueado da loja | `zap/sessoes.js` (`guardarConversa`, `conversas`, `historico`), `zap/wa.js` (`message_create`, `historico`); `src/conversas.js`; `server.js` (`/api/conversas*`, `lojaConv`); `zaplaco.js` (`marcarRobo`); `zap-api.js` (desconectar apaga); `public/js/conversas.js`; `src/telas.js` | `zap/tests` CONV-01…02; `conversas.test` CONV-03…06 e CONV-10 (`semRespostaDe`); `franqueado-loja.test` CONV-07; `conversas.spec` CONV-08, CONV-09, CONV-11, CONV-12 | 🟡 (WhatsApp de verdade só com o cliente de mentira: a primeira leitura real precisa ser conferida na VPS) |
| CLI-CEL / CONV-13 | Vínculo da conversa com o cliente (decisão do dono, 22/11/2026): o número da conversa passa a ser o celular do cliente em todo o painel e no robô (substitui o do FIXE no pacote de `/api/dados`); um número é de um cliente só (quem tinha no FIXE fica sem); só admin e franqueado da loja; auditado com CPF abreviado e 4 últimos dígitos; não some ao desconectar o WhatsApp; o "parar" pelo número novo acha o cliente; desfazer volta o do FIXE | `src/celulares.js` (`vincular`, `desfazer`, `aplicar`); `server.js` (`pacote`, `/api/clientes/celular*`, busca da Lista de espera, demo); `src/zaplaco.js` (`lerOptouts`); `public/js/clientes.js` (`celInfo`, `celNota`, `aplicarCelular`); `public/js/conversas.js` (`botaoVinculo`, `escolherCliente`) | `celulares.test` CLI-CEL; `conversas.spec` CONV-13 | ✅ (conferir a primeira troca real na VPS) |
| CONV-14 | Mídia das conversas sob demanda (decisão do dono 22/11/2026: "baixar no computador e não armazenar na VPS"): "Ver foto" / "Ouvir áudio" / "Ver vídeo" / "Baixar documento" pedem ao WhatsApp na hora; o serviço baixa só na memória (`downloadMedia`, limite 16 MB → 413; não disponível → 404) e o painel repassa ao navegador sem gravar nada (`no-store`, `nosniff`; só imagem/áudio/vídeo seguros abrem na página, o resto só como download), só admin e franqueado da loja e só mensagem de mídia daquela conversa guardada; na tela fica só na memória da aba (`blob:`, liberada ao trocar de conversa) com "Baixar"; nada em log nem auditoria (nem o nome do arquivo); apresentação com imagem desenhada e silêncio | `zap/wa.js` (`midia`), `zap/sessoes.js` (`midia`, `MIDIA_MAX`), `zap/server.js` (`GET /midia/<loja>?id=`); `src/zap.js` (`midia`); `src/conversas.js` (`midiaDe`, `responderMidia`, `nomeArquivo`, `demoImagem`, `demoSilencio`); `server.js` (`/api/conversas/midia`, `/api/demo/conversas/midia`, CSP `img-src`/`media-src` com `blob:`); `public/js/conversas.js` (`caixaMidia`, `buscarMidia`, `soltarMidias`) | `zap/tests` CONV-14; `conversas-midia.test` CONV-14; `conversas.spec` CONV-14; `foto-produto.spec` (cabeçalho) | 🟡 (WhatsApp de verdade só com o cliente de mentira: a primeira foto real precisa ser conferida na VPS depois de reconstruir o serviço) |
| CONV-15 | Mídia da conversa: se a ligação cair (internet ou rede que bloqueia áudio/vídeo, como firewall), tenta de novo sozinho uma vez; caindo de novo, a mensagem explica e o botão volta | `conversas.js` `buscarMidia` | `conversas.spec` | ✅ |
| VIS-01…06 | Revisão visual de 22/11/2026 (impeccable, aprovada pelo dono), regras globais: barra do topo fixa (`html, body { min-height: 100% }`), texto de exemplo com contraste ≥ 4,5:1 (`::placeholder` único), caixa de texto com a letra do painel, abas/submenu com sinal de rolagem (`TS.sinalRolagem`) e sem "bolha" ao quebrar, linha de `TS.table` abre pelo teclado, ✨ some ao rolar para baixo e o fim da página tem folga, links de ação com 24 px de toque; Estoque: janela dos lotes com foco e Esc, quadro com Espaço, cartão enxuto por aba no celular (`COLS_MOB`), "no pedido ›" fora do nome, "Próximas semanas" depois da lista, cores do gráfico por token; ⭐ Sugestões sem a gaveta de filtros | `public/styles.css`; `public/js/components.js` (`sinalRolagem`, `TS.table`, rótulos dos gráficos); `public/js/ia.js` (`ia-fab-some`); `public/js/estoque.js`; `public/js/validade.js` (`janelaPacotes`); `public/js/main.js`/`pages.js` (sugestoes sem filtros) | `revisao-visual.spec` VIS-01…06; `ruptura.spec` (colunas do celular) | ✅ |
| RD-EST-01…02 | Redesenho de 22/11/2026 (decisão do dono: visual do protótipo do Início no painel todo), Produtos e Estoque: Rentabilidade, Preços, Site, Validade e contagem do Inventário com o cartão-herói (um número por fato; cada número leva à aba dele); Estoque, Rentabilidade, Validade e Site sem rolagem para o lado (cada aba com as colunas dela, detalhe empilhado na célula, cabeçalho que quebra a linha) | `estoque.js` (`ABA_PC`, herói da Rentabilidade); `precos.js` (`heroiPrecos`); `site.js`; `validade.js` (`resumo`); `inventario.js`; `styles.css` (`#est-tabela`, `est-t-larga`, `.vl-resumo`, `.site-t`) | `redesenho-estoque.spec` RD-EST-01…02; `compras-reajustes.spec` (linha dos reajustes avaliados) | ✅ |
| PECAS-01 | Redesenho do painel (decisão do dono, 22/11/2026: visual limpo do protótipo do Início para todas as telas): peças compartilhadas `TS.heroi`, `TS.acoesNum`, `TS.etqPrazo`, `TS.linhasNum`, `TS.pilulaSit`, `TS.duasColunas`, `TS.cardSec`; quadros sem barra lateral (estado na cor do texto); cartão raio 14 sem sombra; botões 36/44 px; etiquetas de prazo com contraste ≥ 4,5:1 | `public/js/components.js`; `public/styles.css` | `pecas.spec` PECAS-01; `leiaute.spec` (quadros sem barra) | ✅ |
| RD-VENDAS | Redesenho de Vendas e Equipe (22/11/2026): Resumo, Comparativos, Promoção, Cupons, Comissionamento, Minha comissão e Movimento e escala abrem pelo cartão-herói com os números que decidem; os demais ficam numa grade de apoio sem barra lateral (nenhum número saiu); projeção pela mesma conta (`TS.heroiProjecao` = `TS.projecao`); marca do esperado na barra da meta = dias completos ÷ dias do mês | `pages.js` (resumo, comparativos, promocao, cupons, comissionamento); `extras.js` (`heroiProjecao`, minha, `cartaoAlertas`); `mapa.js`; `checklist.js`; `conferencia-tela.js` | `contas.spec` (faturamento, projeção e meta dividida no herói); `leiaute.spec` (variações curtas no herói) | ✅ |
| RESUMO-07…08 | Revisão de 22/11 (decisões do dono): o link que abre a conversa vazia no WhatsApp (lista, tabela, ficha, janela "Não resgataram") passa pela mesma regra forte do envio manual e não marca contatado; na Lista de espera só "não quer mensagens" trava (avisar que chegou é pedido do cliente). "Desfazer" por 10 s depois de tocar em WhatsApp no Hoje: volta a marca de antes, só quem enviou, até 2 minutos, auditado sem o texto | `server.js` (`/api/contatos/conferir`, `/api/contatos/desfazer`, `desfazer` guardado só no servidor); `zapfila.js` (`envioManualBloqueado`, `soOptout`); `clientes.js` (`abrirConversaWpp`, `linkConversa`, `desfazerEnvio`); `espera.js` (`abrirW`) | `zap-rotas.test` RESUMO-07…08; `hoje.spec` HOJE-02 e RESUMO-07 (tela) | ✅ |
| ZAP-LIGAR | Ligar o robô numa campanha mostra antes, numa janela do painel: quantos recebem, quantos ficam para comparar, limite por dia da campanha e do número, dias e horário, término estimado, a primeira mensagem e um exemplo; desligar é um toque; com o robô ligado o envio manual deixa de ser o botão principal | `zap.js` (`TS.zapOpcao`, `estimar`/`TS.zapEstimar`, `TS.janelaConfirmar`); `campanhas.js` (`abrirCampanha`) | `zap.spec` "ligar o robô na campanha mostra antes…" e "ao criar, Quem envia = robô…" (faixa: próxima fora do horário diz quando volta) | ✅ (estimativa; quem decide é `zapfila.js`) |
| CAMP-BASE | Campanha que pega mais de 30% dos clientes com celular avisa perto da contagem e pede confirmação ao salvar; campanha nova começa com o modelo neutro (Novidades) | `campanhas.js` (`BASE_INTEIRA`, `criar`) | `zap.spec`; `auditoria-contas.spec` | ✅ |
| META-VEND-01 | A vendedora vê a parte dela da meta de hoje em Minha comissão; a conta é feita no servidor com as mesmas definições da tela (meta do mês de `metaMes`, vendas da meta de `contas.js`, divisão de `metadia.js` em partes iguais) e ela não recebe a meta da loja, o faturamento nem as colegas; GET sem efeito; loja de fora → 403 | `src/metahoje.js`; `server.js` (`/api/meta-hoje`, `/api/demo/meta-hoje`); `extras.js` (`cartaoMinhaMetaHoje`) | `metahoje.test` META-VEND-01 | 🟡 (dia de feriado nacional sem horário cadastrado conta como aberto no servidor; na tela do Início conta como fechado) |
| HOJE-01 | Clientes → Hoje: a lista vem no topo (a Meta de hoje foi para o Início, `TS.cartaoMetaDia`), contagem no cabeçalho do cartão, mensagem em duas linhas que abre ao tocar, nome com toque ≥ 24 px, chips com dica e `aria-pressed` | `clientes.js` (`TS.pages.hoje`, `TS.cartaoMetaDia`) | `hoje.spec` HOJE-01 | ✅ |
| CLI-SAUDE | Clientes → Indicadores: "Saúde da base" no topo (cartão-herói + ações numeradas, redesenho de 22/11/2026) (quem está sumindo, perdidos, links para a Lista e para o Hoje) e uma linha em cada seção dizendo a quais filtros ela responde; "Clientes novos" segue os mesmos filtros da Recompra; a lista de cartões não é montada nos Indicadores | `clientes.js` (`cartaoSaude`, `baseDeClientes`, `telaClientes`) | `hoje.spec` "Indicadores…" | ✅ |
| CAMP-NAOENV | Clientes → Campanhas, aba "Não enviadas" (pedido do dono, 22/11/2026): quem saiu da fila sem receber (puladas e não quer) e quem espera estoque, da lista atual de cada campanha, com o motivo, filtro por motivo e campanha, busca, "Voltar para a fila" (mesma rota da campanha) e "Ver cliente"; cada campanha mostra o número de não enviadas, que abre a aba filtrada | `campanhas.js` (`naoEnviadasDe`, `motivoNE`, `pintarNaoEnviadas`, `faltaEstoqueDe`, `semearDemo`) | `campanhas-naoenv.spec` CAMP-NAOENV | ✅ |
| CLI-TEL | Clientes → filtro "Telefone" (pedido do dono, 22/11/2026): acha o cliente pelo celular inteiro ou por parte dele, com ou sem o 55 e com ou sem o 9 da frente do celular; aparece como etiqueta "Telefone" na faixa de filtros e sai no "Limpar" | `clientes.js` (`telBusca`, `telConfere`, `filtrosClientes`); `core.js`/`pages.js` (`state.cli.tel`); `main.js` (etiqueta) | `cli-telefone.spec` CLI-TEL | ✅ |
| ZAP-9DIG | O mesmo celular com e sem o 9º dígito é um número só (pedido do dono): "parar" respondido de conta antiga sem o 9 trava o cliente com o 9 no cadastro; "já recebeu" e o dono do número também; registros guardados das duas formas são juntados | `zapfila.js` (`foneChave`, `porChave`, `decidir`, `ligarNumeroAoCliente`, `voltouAAceitar`); `zaplaco.js` (`lerOptouts`, `enviados`) | `zapfila.test` ZAP-9DIG | ✅ |
| ZAP-HORA-LOJA | O robô envia no horário de funcionamento da loja, dia a dia (decisão do dono): da abertura de 30 min antes de abrir até 30 min antes de fechar; feriado fechado ou com horário especial; dia fechado não envia; loja sem horário cadastrado ou "horário próprio" usa das/às/dias; a tela mostra a tabela, a faixa e a janela de ligar pelo mesmo horário (agenda do servidor) | `zapfila.js` (`janelaDoDia`, `agenda`, `MARGEM_FECHA_MIN`, `validarCfg`, `decidir`, `proxima`); `zap-api.js` (`situacao`: `agenda`, `horarioLoja`); `zap.js` (`estimar`, `horarioTxt`, cartão) | `zapfila.test` ZAP-HORA-LOJA e configuração; `zap-rotas.test` (situação com agenda; horario validado); `zap.spec` (cartão e janela de ligar) | ✅ |
| ZAP-SEMWPP | Trava "sem WhatsApp seguidos" (decisão do dono): 5 clientes seguidos que o robô marca como sem WhatsApp pausam o robô sozinho (a conferência do número pode ter falhado); um envio certo no meio zera; auditoria sem número completo, aviso no aparelho e no Início, alerta na faixa com o caminho para os pulados | `zaplaco.js` (`passo`, `semWppSeguidos`); `zapfila.js` (`SEM_WPP_PAUSA`); `zap-api.js` (religar zera); `zap.js` (`.zap-alerta` na faixa) | `zapfila.test` ZAP-SEMWPP (pausa e zera); `zap.spec` ZAP-SEMWPP (alerta na faixa) | ✅ |
| SITE-01…04 | Site público `/site` e `/site/tecnico`: abre sem login, sem JavaScript, sem dado da instalação nem e-mail pessoal; contato só do `SITE_CONTATO` (https ou mailto); o resto da pasta continua fechado; a página técnica cita toda skill, regra e trava do projeto; aviso de projeto independente | `server.js` (`sitePagina`, `siteContato`); `public/site/*` | `push-rotas.test` SITE-01; `site-publico.test` SITE-02…03; `site.spec` SITE-04 | ✅ |
| CLI-07 | Fidelidade: Logs do FIXE lidos sem repetir | `fidelidade.js` | `fidelidade.test` (3) | ✅ |
| CLI-08 | Saldo de pontos por lotes que vencem; cancelamento via PDV | `public/js/fidelidade.js` | `blind`; `regras.spec` | 🟡 |
| CLI-09 | Ciclo de resgate | `public/js/fidelidade.js` | `blind` | 🟡 |
| CLI-10 | RFM e retenção por safra | `clientes.js`; `indicadores.js` | `rfm.test`; `regras.spec` | 🟡 |
| CLI-11 | Lista de espera: esperando → chegou → avisado → comprou/não comprou | `espera.js` | `espera.test` (6) | ✅ |
| CLI-12 | Lista de espera: permissões (ver PERF-26) | servidor | `permissoes-telas.test` "Lista de espera: vendedora sempre; gerente só com a tela" | ✅ |
| CLI-13 | Exceção decidida pelo dono (D-01): na Lista de espera a vendedora busca e vê nome, CPF e celular do cliente | `/api/espera`, `/api/espera/clientes` | `seguranca.test` "Lista de espera: vendedora precisa de 4 letras e tem teto de buscas" | 🟡 — o que volta na busca (nome, CPF, celular) sem teste |
| CLI-14 | Campanha, "O que comprou": mínimo de compras do produto ou grupo escolhido (conta cupons, não unidades; vários produtos somam; respeita "nos últimos X dias"); a mesma conta na tela e no robô | `campanhas.js` `selecionar` (`compraVezes`) | `zapauto.test` "quem entra na lista" | ✅ |
| CAMP-RET-01…04 | Retorno da campanha: só conta compra depois do envio; prazo fechado só depois do último dia; efeito = quem recebeu − quem não recebeu na mesma janela | `public/js/campretorno.js` | `campretorno.test` CAMP-RET-01…04 | ✅ |
| CAMP-CMP-01…03 | Grupo de comparação (~10%, lista com 50+, só pendentes, sorteio estável por CPF + campanha): criado só no servidor, nunca enviado nem pendente; a recorrente antiga passa a guardar na próxima lista | `campretorno.js`; `src/campanhas.js` | `campretorno.test` CAMP-CMP-01…03 | ✅ |
| REC-01…02 | Recompra em 90 dias: só entra quem já teve o prazo inteiro; bordas (90 dias exatos entra; compra no mesmo dia não é volta; sem elegíveis não vira 0%) | `public/js/recompra.js` | `recompra.test` REC-01…02 | ✅ |
| WPP-APRES-01 | {apresentacao} editável em Configurações → loja → Mensagens (decisão do dono, 23/11/2026): dois modelos (com e sem vendedora), só {vendedora} e {loja}, até 120 caracteres; padrão sem artigo ("Aqui é Gabrielly, da …"); o mesmo texto na tela e no robô | `msgwpp.js` `apresentacao`/`apresentacaoValida`, `clientes.js` `valoresWpp`, `admin-api.js` `wpp-modelos`, `config.js` `blocoWpp` | `seguranca.test`, `zapauto.test`, `zap.spec` | ✅ |
| WPP-APRES-02 | "Sempre assinar como a equipe": {apresentacao} usa o modelo sem vendedora mesmo com vendedora favorita; grava só `equipe: true` | `msgwpp.js` `apresentacao`, `config.js` `blocoWpp`, `admin-api.js` wpp-modelos, `src/config.js` | `seguranca.test`, `zap.spec` | ✅ |
| CEL-NOME-01 | Nome nas mensagens do número vinculado (cadastro de uma pessoa, WhatsApp de outra): só com vínculo, só admin e franqueado da loja, só letras até 40, vai no pacote (`celVinc.nome`) e some ao desfazer | `celulares.js` `nomear`/`nomeValido`/`aplicar`, `server.js` `/api/clientes/celular/nome` | `celulares.test` | ✅ |
| CEL-NOME-02 | Com nome nas mensagens, {nome}/{nomecompleto} saem com ele e o aniversário fica fora do Hoje e das campanhas | `clientes.js` `TS.nomeMsgDe`/`valoresWpp`/etiqueta `aniv`, `campanhas.js` filtro de aniversário | `zap.spec` | ✅ |
| CEL-NOME-03 | Com nome nas mensagens, a conversa mostra esse nome no topo, na lista e nas mensagens dele, com "cadastro: <nome da fidelidade>" embaixo (a busca acha pelos dois); Ver cliente abre o cadastro da fidelidade com "WhatsApp do <nome>" | `conversas.js` `nomeConv`/`pintarItens`/topo, `clientes.js` ficha | `conversas.spec` | ✅ |
| CAMP-FORA-01…04 | Clientes → Campanhas (pedido do dono, 23/11/2026): tirar à mão um cliente que atende aos critérios (coluna "Tirar" com ✕ em cada linha de "Quem entra", que tem 3 colunas para o botão ficar à vista sem rolar de lado — o dono não achou o botão quando eram 5; "Tirados à mão (N)" com "Voltar para a campanha"); fica em `filtros.fora` (só CPFs válidos, até 1.000) e vale na tela, no envio manual e no robô (a mesma conta: `selecionar`/`listaResumo`); na campanha já criada sai dos pendentes ao salvar, quem recebeu fica no histórico; auditoria só com as quantidades | `campanhas.js` (`selecionar`, `listaResumo`, `tirar`/`voltar`/`listaFora`, `demoApi`); `src/campanhas.js` (`filtrosOk`, `alterar`); `server.js` (PUT `/api/campanhas/:id`) | `zapauto.test` CAMP-FORA-01; `campanha-fora.test` CAMP-FORA-02, CAMP-FORA-03; `campanha-fora.spec` CAMP-FORA-04 | ✅ |

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
| OPE-INI-01 | Início (revisão de 22/11/2026): grupos de avisos com "Dados e configuração" primeiro e os outros pela gravidade do pior aviso (empate na ordem fixa); aviso já em "O que fazer primeiro" marcado, não repetido como novidade | `inicio.js` (`ordemGrupos`, `TS.inicioCalc`, campo `topo`); `visaodono.js` (`carregarLoja`, `acoes`) | `leiaute.spec` "Dados e configuração primeiro", "a conta da ordem dos grupos" | ✅ |
| OPE-INI-02 | Fonte de aviso que falha aparece ("Não consegui conferir X agora · Tentar de novo"); nunca "Nada pedindo atenção" sem ter conferido | `inicio.js` (`falhas`, `.ini-falhou`) | `leiaute.spec` "uma fonte que falha aparece" | ✅ |
| OPE-INI-03 | Meta de hoje no Início (saiu de Clientes → Hoje); um número por fato: o herói mostra o % da meta e a projeção das vendas da meta, o faturamento do mês fica no Resumo e no Resultado; "Liquidar lotes" no mesmo valor de Validade em risco; saudação pelo relógio de São Paulo | `clientes.js` (`TS.cartaoMetaDia`); `inicio.js` (`heroi`, `horaSP`); `visaodono.js` (`acoes` criticos a custo) | `visaodono.spec` "a meta de hoje é dividida…"; `voltar.spec` "Início: meta do dia"; `leiaute.spec` (horaSP); `visaodono.test` | ✅ |
| INI-HEROI | Início no redesenho de 22/11/2026 (aprovado pelo dono): herói "como estou indo" (% da meta pelas vendas da meta + marca do esperado = dias de loja aberta completos ÷ dias de loja aberta do mês; "para bater a meta" por dia + ritmo da projeção das vendas da meta; semana contra a anterior + o que mais pesou, pela decomposição da análise), sem grade de quadros com barra; "O que fazer agora" com um botão por ação (a 1ª principal); a pílula de situação das vendas | `inicio.js` (`heroi`, `oQuePesou`, `pilulaVendas`); `visaodono.js` (`dadosHeroi`, `carregarLoja`, `acaoTela`); `pecas.js` (provisório) | `visaodono.spec` INI-HEROI; `contas.spec` (o % da meta e as projeções são as das outras telas); `leiaute.spec` (sem `.g-kpi`, ritmo em texto colorido) | ✅ |
| INI-AVISOS | Início: a linha de "Dados e configuração" sempre à vista; depois só os 4 avisos mais importantes (gravidade, depois a ordem de hoje) com etiqueta de prazo em texto (Agora / Esta semana / Para saber, contraste ≥ 4,5:1); "Ver todos os N avisos" abre a lista completa agrupada de sempre (lembrar depois, vermelho não adia); "Estoque em números" só com o que a pessoa vê | `inicio.js` (`pintar`, `linhaResumo`, `estoqueNumeros`, `state.iniTodos`) | `visaodono.spec` INI-AVISOS; `leiaute.spec`, `usabilidade.spec`, `conferencia.spec`, `guia.spec` (pela lista completa ou pelo resumo) | ✅ |

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
| APP-14 | Painel instalável: manifesto, ícones (192, 512, 512 maskable com o desenho na área segura, 180 do iPhone, selo 96 de uma cor) e service worker públicos; tags em todas as telas, inclusive login; o Chrome não aponta impedimento para instalar | `public/manifest.webmanifest`, `public/icones/`, `public/sw.js`; `server.js` (rotas públicas); `index.html`, `login.html`, `trocar-senha.html` | `push-rotas.test` (2); `aplicativo.spec` "manifesto e ícones" | ✅ |
| APP-15 | Service worker só trata push e clique: mostra título, texto e link; só aceita link começando com "/"; mensagem quebrada vira aviso genérico; não guarda página | `public/sw.js` | `aplicativo.spec` "notificação" (entrega pelo CDP); `push.test` | ✅ (o clique na notificação não é simulado) |
| APP-16 | Web Push sem biblioteca: cifra RFC 8291 (aes128gcm) e VAPID RFC 8292 (JWT ES256); chave da instalação criada uma vez, fora do git, arquivo 600; só a parte pública sai para a tela | `src/webpush.js` | `push.test` (cifra aberta pelo "lado do navegador", vetor do RFC, assinatura); `push-rotas.test` | ✅ — conferido à mão contra `http_ece` e `web-push` em pasta de rascunho |
| APP-17 | Endereço de entrega: só https de fcm.googleapis.com, *.push.services.mozilla.com, *.notify.windows.com e *.push.apple.com; sem redirecionamento; espera limitada; enviar nunca lança | `webpush.js` `enderecoOk`, `enviar` | `push.test` "endereço", "envio"; `push-rotas.test` | ✅ |
| APP-18 | Permissão conferida a cada envio (ativo, prazo, senha provisória, loja, tela do assunto); usuário excluído perde os aparelhos; cada pessoa só vê e remove os próprios; resposta sem chave nem endereço | `push.js` `podeReceber`, `avisar`; `push-api.js` | `push.test` "permissão a cada envio", "aparelhos"; `push-rotas.test` "rotas" | ✅ |
| APP-19 | Aparelho que o serviço diz não existir (404/410) sai da lista; outros erros não removem | `push.js` `avisar`, `testar` | `push.test` "aparelho que sumiu" | ✅ |
| APP-20 | Evento nunca repete: a chave é marcada antes do envio; eventos ligados: lista de espera (chegou), ⭐ sugestão nova (menos quem sugeriu), robô do WhatsApp (pausou sozinho, conexão caiu) | `push.js` `avisar`; `server.js` (`avaliarEspera`, `/api/sugestoes`); `zaplaco.js` `avisarAparelhos` | `push.test` "não repete", "cada evento", "os eventos do painel estão ligados" | 🟡 — o gatilho de cada evento é conferido pelo código, não disparado de ponta a ponta; a entrega até um celular real não é testável aqui |
| APP-21 | Tela "Notificações e aplicativo": instalar (convite do navegador + instrução para Android, iPhone e computador), ativar/desativar por aparelho, tipos por aparelho, teste e lista com remover; mensagens para sem suporte, bloqueado e iPhone sem instalar; apresentação não ativa nada | `public/js/notificacoes.js`; `/api/demo/push` | `aplicativo.spec` "tela" | 🟡 — os estados "sem suporte", "bloqueado" e "iPhone" não têm teste automático |
| PASSADA-2 | 2ª passada do layout (23/11/2026, proposta do Figma aprovada pelo dono): só os 2–3 números que decidem no herói com a ação principal ao lado; números de apoio como linhas clicáveis; ferramentas da lista no canto do cabeçalho (no celular, os botões da lista numa linha própria e Imprimir/Expandir juntos); consulta secundária recolhida; tabelas sem rolar para o lado (Estoque, Pedido, Notas, Créditos, Campanhas, Hoje, Resumo, Comparativos, Promoção, Comissionamento) | `estoque.js`, `pedido.js`, `comprasvendas.js`, `precos.js`, `creditos.js`, `campanhas.js`, `clientes.js`, `espera.js`, `zap.js`, `pages.js`, `config.js`; `styles.css` (blocos "2ª passada") | `leiaute.spec`; `estoque.spec`; `ruptura.spec`; `visaodono.spec`; `zap.spec`; `contas.spec`; `revisao-visual.spec`; `redesenho-estoque.spec` RD-EST-02 | 🟡 — Evolução mensal no celular e o lugar dos botões só conferidos em print |
| TAB-BUSCA-01 | `TS.table` guarda o texto buscado na hora (só o redesenho espera): apagar a busca e trocar logo de aba não leva a busca antiga para a tabela nova | `components.js` `TS.table` (`_buscas`) | `lotes-envasados.spec` LOTE-ENV-01 (Alimentação depois de limpar a busca) | 🟡 — só pela Validade |
| AVISO-SALVAR-01 | Erro ao salvar abre a janela "⚠️ Não foi salvo" (pedido do dono, 23/11/2026) com a frase do erro e "Corrigir", que marca o campo (`aria-invalid`, borda e frase embaixo) e dá foco; erro de segundo plano e aviso da apresentação continuam discretos. Já usam: Campanhas, Orçamento, Salvar carrinho do Pedido, Configuração guiada, Checklist e os botões "Salvar…" das Configurações | `components.js` (`TS.naoSalvo`, `TS.marcarCampoErro`, `TS.avisar`); `campanhas.js` (`campoDoErro`); `config.js` (`acao`) | `campanha-fora.spec` AVISO-SALVAR-01 | ✅ |
| DATA-01 | Telas principais sem erro, "NaN/null", rolagem lateral (1100 e 390 px) ou percentual absurdo no 1º do mês, último dia, domingo fechado e 1º de janeiro | `src/demo.js` `agora()` (`PAINEL_HOJE_TESTE` só com NODE_ENV=test) | `tests/datas/datas.spec.js` | ✅ |
| DATA-02 | Projeção e meta válidas no começo e no fim do mês; o "hoje" da tela é o do relógio | `extras.js` `TS.projecaoMes`, `core.js` | `tests/datas/datas.spec.js` | ✅ |
| NOTURNA-01 | Bateria completa (apresentação, perfis e datas) todo dia às 03:17 no main; não libera nem bloqueia versão (o registrar só roda em push) | `.github/workflows/testes.yml` | — (o próprio agendamento) | 🟡 |
| PRINTS-01 | As telas principais (Início, Resumo, Comparativos, Cupons, Estoque, Validade, Pedido, Notas, Hoje, Campanhas, Comissionamento, Resultado, Configurações) não mudam de layout sem querer, no computador e no celular (relógio fixo 20/11/2026 15:30; referências geradas no GitHub) | `playwright.visual.config.js`, `tests/visual/relogio-fixo.js`, `.github/workflows/prints.yml` | `tests/visual/telas.spec.js` | ✅ |
| ERRTELA-01 | Mensagem de erro de tela sem dado pessoal (e-mail, CPF, telefone, número longo, texto digitado, parâmetros do endereço) | `src/errostela.js` `sanear`; `public/js/errostela.js` `limpar` | `errostela.test` | ✅ |
| ERRTELA-02 | Só campos conhecidos; loja só se a pessoa tem; só erro do painel; linha do pacote vira arquivo:linha | `src/errostela.js` `registro`/`arquivo`; `server.js` `obterBundle` | `errostela.test` | ✅ |
| ERRTELA-03 | No máximo 10 avisos por pessoa por minuto; o mesmo erro da mesma pessoa só a cada 10 minutos | `src/errostela.js` `podeGravar` | `errostela.test` | ✅ |
| ERRTELA-04 | Arquivo com 30 dias e no máximo 2 MB; resumo agrupa os repetidos; "novo" = 1ª vez nos últimos 2 dias | `src/errostela.js` `gravar`/`resumo`/`novos` | `errostela.test` | ✅ |
| ERRTELA-05 | Todo perfil envia (com `X-Painel`); admin vê tudo, franqueado só as lojas dele, gerente e vendedora 403; arquivo sem usuário | `src/errostela.js` `registrar` | `errostela.test` (servidor real) | ✅ |
| ERRTELA-06 | Na apresentação o aviso é aceito sem gravar | `src/errostela.js` `demo` | `errostela.test` | ✅ |
| ERRTELA-07 | Erro na tela vira 1 aviso saneado; aba Erros nas telas; aviso de erro novo no Início do admin | `public/js/errostela.js`, `config.js` `abaErros`, `inicio.js` `avisosErrosTela` | `erros-tela.spec` | ✅ |
| GRAF-01 | Gráfico sempre do tamanho do cartão; criado num cartão ainda sem largura, espera a largura para desenhar | `components.js` `TS.chart` | `graficos.spec` | ✅ |
| GRAF-02 | Gráfico com a densidade de pixels errada (só o canto desenhado) se refaz ao voltar do segundo plano, ao girar e quando a densidade muda | `components.js` `TS.ajustarGraficos` | `graficos.spec` | ✅ |
| PORTA-01…02 | Testes que sobem o servidor sorteiam a porta numa faixa só deles, pulando as portas que o `fetch` recusa (4045, 6000…: "o servidor de teste não subiu em 90 s") | `tests/unit/_porta.js` | `portas-teste.test` PORTA-01…02 | ✅ |
| MATRIZ-01…06 | A matriz sempre em dia (decisão do dono, 23/11/2026): códigos únicos; teste citado existe; código de regra no nome de um teste está na matriz; ✅ sempre com teste; resumo em números contado pelas linhas; `npm run testar-alteracao` roda primeiro os testes das regras dos arquivos mexidos e avisa as sem teste; o hook lembra de atualizar a matriz | `scripts/matriz.js`; `scripts/testar-alteracao.js`; `.claude/hooks/lembrar-docs.js` | `matriz.test` MATRIZ-01…06 | ✅ |
| LARG-01 | Nada rola para o lado dentro da tela (tabela, grade, cartão) no computador, a 1366 e a 1100 px, e no celular; só as faixas de abas e o submenu rolam de propósito. As que já rolavam em 23/11/2026 ficam numa lista (`ROLA_CONHECIDO`) que falha também quando uma delas deixa de rolar (achado G-01) | `telas.spec` `quemRolaDeLado`; `styles.css` (cabeçalho que quebra a linha em `.conf-t`, `.cv-t`, `.rfm-t`) | `telas.spec` LARG-01 | ✅ (com as exceções do achado G-01) |
| CLIQUE-VISTA-01 | Todo clique dos testes de tela (apresentação, perfis e datas) é num elemento à vista: se a página ou um bloco precisou rolar para o lado para mostrar o botão, o teste falha. O Playwright rola sozinho e escondia o problema: o "✕ Tirar" da campanha, o "Editar" de Usuários no celular e o "Incluir na devolução" da nota | `tests/e2e/_base.js` (todos os specs importam dele); `config.js` (Usuários em cartão no celular); `precos.js` (nota com `est-t-larga`) | `config-telas.spec`, `lotes-envasados.spec`, `campanha-fora.spec` (e todos os testes de tela) | ✅ |
| CLIQUE-VISTA-02 | Todo spec de tela (e2e, perfis, datas) importa `test`/`expect` de `tests/e2e/_base.js`, senão passaria sem a conferência do clique (fora `aplicativo.spec`, que abre o navegador com perfil próprio) | `tests/e2e/_base.js` | `base-testes.test` CLIQUE-VISTA-02 | ✅ |

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
| C-10 | Teste de tela intermitente: `reajuste.spec` "enviar reclamação de reajuste" falha em cerca de 1 a cada 6 rodadas (o assunto digitado volta ao texto padrão antes do envio), no computador e no celular; já acontecia antes de 20/11/2026. Causa não encontrada: pode ser só do teste ou a janela perdendo o que foi digitado. Investigar antes de mexer nessa janela |
| C-11 | Teste de tela sensível ao tempo: `voltar.spec` "voltar do celular fecha a janela por cima" usa esperas fixas (800 ms / 300 ms) e falhou 1 vez na bateria completa de 20/11/2026 (máquina carregada); passou 6 de 6 sozinho e a mudança daquele dia não toca em Cupons nem no histórico de janelas. Trocar as esperas fixas por espera da condição (`history.state.camada`) **Corrigido em 21/11/2026** (esperas pela condição: página aberta, botão visível, histórico sem a janela). |
| C-12 | Teste que dependia da data: `conferencia.spec` "quadros clicáveis" falhou no GitHub logo depois da meia-noite de Brasília (21/11/2026). O exemplo fictício de "caixa fechado depois da meia-noite" usava sempre o 10º e o 11º dia de venda, que em certas datas não eram dias seguidos ou tinham taxa de serviço. Corrigido em `src/conferencia.js` (`demo`: par de dias seguidos e sem taxa) e travado em `conferencia.test` CONF-DEMO-01 (14 datas em duas semanas × 3 lojas; com 60 datas o teste pesava a ponto de o servidor do `conferencia-rotas.test` não subir em 10 s no GitHub). Limite que continua na regra de verdade: a virada do dia não é reconhecida quando um dos dois dias tem taxa de serviço (a diferença dos dois não se anula) |
| C-13 | Revisão visual pelas regras do impeccable (21/11/2026), medida nas telas da apresentação (computador e celular): antes 1.163 textos abaixo do contraste, 4.759 com letra < 12 px e 1.026 alvos de toque < 24 px; depois 12 (mapa de calor das safras, contagem nas faixas de classe, ícone do Início), 0 fora o "i" do ⓘ, e o ⓘ com área de toque de 28 px. Ficam de fora por decisão do dono: emojis, barra lateral de estado, cartões. Sem teste automático: refazer a medição ao mexer em cores ou tamanhos (contraste pelo fundo real de cada texto, `font-size` calculado, retângulo de cada controle no celular) |
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

### F. Envasados e alimentação (23/11/2026)
- **Achado corrigido:** o chá envasado cadastrado em "Kg" no AppNext (ex.: "Matcha 30G Pacote", 9,000 kg = 9 pacotes) aparecia como 9 kg no Estoque, no Pedido e no Inventário, e o custo da venda casava o pacote como granel (30 g × custo do "kg"). Agora o estoque normaliza a unidade num ponto só (UN-ENV-01).
- **Achado corrigido:** a pílula "Atualização com problema · veja os avisos" do Início não fazia nada ao toque; virou botão que abre a lista completa e leva ao grupo "Dados e configuração" (a amarela "Vendas só até" também) — `inicio.js` `irDados`, `TS.pilulaSit(…, ir)`; `lotes-envasados.spec` "Início".
- **A confirmar com o dono:** o grupo do AppNext dos envasados nas lojas reais (o painel aceita CHÁS ENVASADOS, TEA MOMENTS e FOREST FRIENDLY TEAS; minitin, lata, sachê e "30G" no nome em item em kg também contam como envasado).
- **Achado corrigido (testes, 23/11/2026):** "o servidor de teste não subiu em 90 s" no GitHub não era lentidão: a porta sorteada às vezes era uma que o `fetch` do Node recusa ("bad port": 4045 na segurança, 6000 nas notificações; 3659 e 4190 também estavam em faixas). O sorteio agora pula essas portas (`tests/unit/_porta.js`) e a faixa das notificações não cruza mais a das conversas. Teste: `portas-teste.test.js` (PORTA-01, PORTA-02).
- **Achado corrigido:** Validade a 1100 px rolava de lado quando algum lote ganhava o "📣 Campanha" (texto pequeno sem quebrar); e `TS.table` guardava a busca só depois de 0,12 s, então apagar a busca e trocar logo de aba levava a busca antiga para a outra aba ("Nada encontrado").
- **Achado corrigido:** Vendas → Cupons mostrava 503 "itens" (linhas) no topo e 530 no total da lista (soma crua, com taxas e R$ 0,01); agora cupons, itens e valor saem de `TS.metricas` (CUP-01).
- **Achados corrigidos pelos testes novos (23/11/2026):** Pedido → Produtos rolava para o lado (625 px a 1100) — agora 6 colunas; "null" na "Sua meta de hoje" da vendedora quando as vendas de hoje não chegaram; Vendas por produto somava 516 itens / 7,610 kg (com R$ 0,01, consumível sem controle e kg de acessório) contra 513 / 7,31 da conta oficial; Chá vendido do Resumo somava o chá de brinde a R$ 0,01.
- **Achado (prints, 23/11/2026):** a Validade às vezes volta a mostrar "Carregando os lotes…" depois de pronta (a tela se redesenha sozinha, uma piscada que a pessoa também vê). Em aberto; o teste de prints espera a tela ficar pronta de novo.
- **Corrigido (23/11/2026):** no celular, a tela Criar campanha passava da largura em cerca de 60 px (já era assim antes): as grades `.cp-form` e `.cp-dir` não tinham coluna definida e cresciam até o conteúdo. Agora as duas usam `minmax(0, 1fr)`. O teste de tela mede só a rolagem da página e não pegou (o card corta o excesso).
- **Corrigido (23/11/2026):** no computador, o "✕ Tirar" de Criar campanha ficava escondido à direita (a lista "Quem entra" tinha 5 colunas numa coluna estreita e rolava de lado); o dono não achou o botão. Agora são 3 colunas e o CAMP-FORA-04 confere que o botão aparece sem rolar (o teste antigo clicava no botão mesmo escondido).
- **Em aberto (23/11/2026):** `visaodono.spec` "Lojas lado a lado: projeção e zerados" falhou 1 vez na bateria completa local (zerados 164 × 165 entre as lojas lado a lado e a tela da loja); passou nas 3 repetições. Causa não encontrada.
- **Decidido pelo dono (23/11/2026):** na Minha comissão a vendedora pode ver a meta da loja e a divisão entre as pessoas (só não vê as colegas); o cartão "Sua meta de hoje" segue só com a parte dela.
- **Decidido e corrigido (23/11/2026, LUCRO-01):** antes, "Lucro bruto" do mês tinha dois números — Rentabilidade R$ 10.659 (60,2%) e Resultado R$ 7.339 (41,4%), este perto do "Lucro sem fixos" da Rentabilidade; é diferença de definição/nome (mexer muda o Resultado e a exportação ao contador).
- **Em aberto:** `reajuste.spec` (celular) falhou 2 vezes na bateria completa local (o assunto digitado voltou ao texto padrão); sozinho e sob carga passou 26 vezes. Causa não encontrada.

### G. Tabelas que rolam de lado (LARG-01, 23/11/2026)
- **G-01 · Em aberto (lista `ROLA_CONHECIDO` em `telas.spec`):** precisam de redesenho (juntar informações na célula ou virar cartão). Computador a 1100 px: Resultado → "Mês a mês" (13 colunas, +260 px). Celular: Resultado → "Resultado do mês" e "Mês a mês"; Comparativos → "Sua loja × rede"; Promoção → "Lucro da promoção"; Clientes → Indicadores → "Grupos de clientes (RFM)" e "Retenção por safra"; Escala → grade do mês.
- **No GitHub a letra é mais larga:** a primeira rodada lá pegou também Clientes → "Vendedoras e clientes" a 1100 px (cabeçalho agora quebra a linha) e cartões que cortavam 3 a 9 px de texto (Resultado, Pedido no celular). Bloco que só corta (`overflow: hidden`) tem folga de 16 px; bloco que a pessoa rola, nenhuma.
- **Corrigido junto:** Conferência → "Sobras e faltas de caixa" e Resultado → "Compras × vendas mês a mês" (cabeçalho que quebra a linha, cabem a 1100 px); Configurações → Usuários no celular (cada usuário um cartão, "Editar" ao lado do nome); nota de entrada (a coluna "Lote · validade" com "Incluir na devolução" ficava cortada).

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
| E-37 | Validade: digitar o dia da data já gravava e redesenhava a tela (não dava para terminar a data); Estoque: a aba clicada não ficava marcada no seletor | `validade.js` (`TS.aoConfirmar`); `components.js` `TS.seg`/`TS.segMarcar` | ✅ `usabilidade.spec` (seletor); data da Validade sem teste de tela |
| E-38 | Margem de tabela: produto não abria o histórico de compras | `precos.js` `TS.histCompras`; `estoque.js` `abrirCompras` | ✅ `usabilidade.spec`, `voltar.spec` |
| E-39 | Quadro ⭐ Sugestões no Pedido era pilha de cartões só com ação em lote; tabela de Preços rolava para o lado | `pedido.js` `cartaoSugestoes` (tabela, abas, "+ Adicionar ao pedido", 🛒, ⭐ com dica); `precos.js` `tabela` (4 colunas, célula empilhada `.prc-c`), `efeitopreco.js` | ✅ `sugestoes.spec`, `dicas.spec` ("nenhuma aba rola para o lado") |
| E-40 | Pedido: ordem da tela definida pelo dono (ajustes → Proporção → quadros → Obrigatório → Sugestões → Produtos → Revisão com IA); Sugestões com coluna Classe e seletor 3/6/12 meses | `pedido.js` (`marcaProp`, `blocoIA`, `ctlClasseMeses`, `cartaoSugestoes`) | ✅ `sugestoes.spec` ("ordem da tela", coluna Classe) |
| E-41 | IA só podia ser desligada removendo a chave: agora dá para ligar/desligar por loja guardando a chave | `ia.js` `chaveAtiva`, `alterar({ ligada })`, `mensagens`; `server.js` `/api/ia/estado`, `PATCH /api/ia/chave`; `public/js/ia.js` (botão) | ✅ `ia.test` ("desligar guarda a chave") — botão sem teste de tela (a apresentação não tem chave) |
| E-42 | Redesenho de leiaute aprovado pelo dono (só leiaute, mesma paleta): quadros com barra só quando há estado; cartões sem sombra; subtítulo longo em uma frase + "Como ler"; avisos do Início em lista agrupada por área (`de('<área>')`); ajustes do Pedido em linha; topo do Resultado; filtros em faixa no topo com "Mais filtros" (etiquetas e contador), gaveta no celular. Achado junto: "nullnull" nos cartões do Pedido no celular | `components.js` (`TS.kpi`, `TS.kpiEstado`, `subCurto`); `inicio.js` (`AREAS`); `pedido.js`; `dre.js`; `main.js` (`montarFaixa`, `filtrosAtivos`); `styles.css` | ✅ `leiaute.spec`, `filtros-topo.spec` |
| E-43 | Auditoria de BI (contas): faturamento com três definições e atendimento contado em dobro; meta comparada com venda COM Espaço Gourmet; projeção contando o dia em andamento e linear por dia corrido; período personalizado dividido pelo dia de hoje; meta dividida por qualquer pessoa com venda > 0; faixa do bônus em base diferente do "% da meta"; comissão projetada na faixa mínima; equilíbrio sem as despesas pontuais; premiação sem mínimo de atendimentos; comparação de 30 dias | `public/js/contas.js` (`contaFat`, `resumo`, `projecaoMes`, `divisoresMeta`, `pontoEquilibrio`); `rules.js` (piso `pisoDiasMeta`, `premiacao.minAtend`, faixa do bônus, `projFator`); `core.js`; `pages.js`; `inicio.js`; `dre.js`; `estoque.js`; `src/indicadores.js` | ✅ `contas.test` (FAT, ATD, PROJ, META, BON, PREM, COM-PROJ, EQ, CFG); `contas.spec` |
| E-44 | Auditoria de BI (indicadores que prometiam mais do que mediam): retorno da campanha contava compra do dia do envio e dividia por quem ainda estava no prazo, sem grupo de comparação; classe só relativa à mediana; veredito do reajuste com amostra pequena; custo de hoje em mês passado; recompra com cliente sem prazo completo; perda por ruptura sem teto; compras ÷ vendas do mês parcial pela projeção | `campretorno.js` (st `'c'`, sorteio no servidor em `src/campanhas.js`); `classeprod.js`; `efeitopreco.js`; `custodata.js` (`M.custo`/`M.custoDet`); `recompra.js`; `ruptura.js` `MAX_ACUM`; `comprasvendas.js` | ✅ `campretorno.test`, `classeprod.test`, `efeitopreco.test`, `custodata.test`, `recompra.test`, `ruptura.test`, `comprasvendas.test`, `zapfila.test`; `auditoria-contas.spec` |
| E-45 | Decisões do dono após a auditoria: (1) campanha que se repete criada antes do grupo de comparação passa a guardar os 10% na próxima lista; (2) limite do pedido (CMV real) pelo custo de HOJE — Resultado e Rentabilidade seguem pelo custo da data; (3) base do valor pago no bônus fica como sempre foi; (4) quem tem férias lançadas no mês divide a meta mesmo abaixo do piso | `src/campanhas.js` `comCompara`; `pedido.js` (`M.custoHoje`); `contas.js` `divisoresMeta({ sempre })`, `rules.js` | ✅ `campretorno.test` CAMP-CMP-03; `contas.test` META-04 |
| PERF-17 | Índice das NF-e por data da pasta; compras/notas/histórico e contagens com cache por arquivo; apresentação pré-comprimida; limpeza dos envios ao robô (90 dias) | `nfsaida.js` `indiceDe`; `estoque.js` `lerComCache`; `inventario.js` `resumoDe`; `nfe.js`/`inventario.js` `limparEnvios`; `server.js` | ✅ `cache.test`, `dados-comprimidos.spec` (memo da espera e `packCache` sem teste) |

## Resumo em números

Contado pelas linhas da matriz (`node scripts/matriz.js --resumo`; o guardião confere).

<!-- resumo:inicio -->
| Área | Regras | ✅ | 🟡 | ❌ |
|---|---|---|---|---|
| Perfis e permissões (PERF) | 34 | 10 | 17 | 7 |
| Segurança, segredos, auditoria e apresentação (SEG) | 19 | 1 | 9 | 9 |
| IA (IA) | 16 | 7 | 6 | 3 |
| NF-e, devolução e notas de entrada (NFE) | 41 | 26 | 11 | 4 |
| Dinheiro com a franquia (FRQ) | 12 | 6 | 6 | 0 |
| Coletor e robôs (COL) | 7 | 1 | 2 | 4 |
| Escala, horários, feriados e férias (ESC) | 31 | 7 | 10 | 14 |
| Equipe, metas e comissão (EQP) | 13 | 4 | 3 | 6 |
| Estoque, inventário, lotes e pedido (EST) | 80 | 49 | 14 | 17 |
| Preços, custos e notas de entrada (PRC) | 40 | 13 | 8 | 19 |
| Resultado e rentabilidade (RES) | 17 | 9 | 3 | 5 |
| Vendas e métricas (VEN) | 27 | 12 | 8 | 7 |
| Clientes, fidelidade, WhatsApp e lista de espera (CLI) | 44 | 32 | 8 | 4 |
| Orçamento (ORC) | 7 | 5 | 1 | 1 |
| Checklist, fechamento e avisos (OPE) | 13 | 6 | 3 | 4 |
| Estrutura do painel e atualização (APP) | 42 | 24 | 12 | 6 |
| **Total** | **443** | **212 (48%)** | **121 (27%)** | **110 (25%)** |
<!-- resumo:fim -->

## Próximas etapas

1. ~~Dono decide os itens D-01 a D-08~~ — decidido em 19/11/2026 (ver D).
2. **Corrigir os erros da lista A**, cada um com um teste que mostra o erro antes e passa depois.
3. ~~Teste de permissões no servidor~~ — feito em parte: 10 arquivos sobem o painel com cada perfil (ver a introdução); faltam `/api/dados` para vendedora (CPF/celular), NF-e (rascunho/emitir), reajuste, orçamento e a varredura do X-Painel em todas as rotas.
4. **Testes das contas sem teste**, por prioridade de dinheiro: comissão e metas (EQP), Resultado e margem (RES/PRC), reposição e pedido (EST).
5. ~~Amarração automática~~ — feita em 23/11/2026: o guardião `tests/unit/matriz.test.js` (MATRIZ-01…06) e `npm run testar-alteracao`; falta dar código às regras antigas que ainda não têm no nome do teste.
