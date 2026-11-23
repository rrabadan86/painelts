---
paths:
  - "src/nfe.js"
  - "src/cobranca.js"
  - "public/js/precos.js"
  - "src/nfsaida.js"
  - "src/devolucao.js"
  - "src/xmlarquivos.js"
  - "src/xmlbase.js"
  - "public/js/nfsaida.js"
  - "public/js/devolucao.js"
  - "public/js/danfe.js"
  - "public/js/creditos.js"
  - "public/js/orcamento.js"
  - "coletor/nextsoft_nfe.py"
  - "coletor/nextsoft_xml.py"
  - "tests/unit/nfe.test.js"
  - "tests/unit/nfsaida.test.js"
  - "tests/unit/devolucao.test.js"
---
# NF-e (venda, devolução ao fornecedor e notas emitidas)

- `src/nfe.js`: NF-e de venda como pedido para o robô (`dados/<loja>/nfe/envio/<id>.json` → `<id>.resultado.json`) e histórico em `rascunhos.json`.
- `src/devolucao.js`: devolução ao fornecedor a partir da nota de entrada (itens danificados/faltando/**validade curta**, fotos, planilha, e-mail, NF-e).
- **Motivo "validade curta" (decisão do dono, 23/11/2026):** item que chegou com validade menor que a chegada + o prazo do tipo (`VALIDADE_MIN` em `src/lotes.js`: chá a granel 6 meses, pela validade do PACOTE; envasados e alimentação 30 dias) entra na devolução como tipo `validade` (`qtdValidade`, `obsValidade`, sem foto; seção própria na planilha e no e-mail). O aviso da linha da nota ("Incluir na devolução") **só preenche** o formulário de devolução que já existe desta nota (`TS.devolucao.incluir`) — nunca cria fluxo paralelo; enviar, gravar e emitir a NF-e seguem a revisão de sempre. A NF-e soma as quantidades por código, qualquer que seja o motivo.
- `src/nfsaida.js`: lista as NF-e (modelo 55) a partir dos XMLs que o coletor guarda; NFC-e (65) ficam em Vendas → Cupons.
- `src/brasilapi.js` (rotas `/api/brasil/cnpj|cep`): dados públicos de CNPJ/CEP para preencher parceiro e cliente do orçamento; só preenche campo vazio; vendedora não usa; na apresentação a resposta é fictícia.
- `coletor/nextsoft_nfe.py`: `ACAO=cadastros` só lê; `ACAO=rascunho` preenche e salva rascunho, e com `emitir` conclui e homologa.
  Confere produtos, quantidades, preços e total antes de salvar; se algo não bater, **para sem salvar**. `SIMULAR=1` faz tudo menos o clique final.

## CFOP das notas (decisão do dono)
- A loja escolhe o CFOP da NF-e de **venda** e o da **devolução ao fornecedor** em Configurações → Integrações → "Notas fiscais: CFOP" ou no **passo 5 (opcional) da configuração guiada** — o mesmo formulário (`TS.guia.formCfop`) e a mesma rota (`PUT /api/admin/lojas/:id/nfe-cfop`, só admin e franqueado da loja, auditada). Fica em `loja.nfeCfop = { venda, devolucao }` (`src/nfecfop.js`); vazio = automático, como sempre foi (venda 5102; devolução pela regra fiscal da loja).
- As opções são os CFOPs de saída que o robô leu do AppNext (`cadastros.cfops`). O botão "↻ Buscar no AppNext" fica no próprio formulário (pede `POST /api/nfe/cadastros`, acompanha por `GET /api/nfe` e relê a lista por `GET /api/admin/lojas/:id/nfe-cfop`); é a mesma leitura do "Buscar cadastros" de Notas fiscais → Nova NF-e. Sem a lista, dá para digitar o número (4 dígitos, começando por 5 ou 6).
- O CFOP é a chave: o robô usa a **regra fiscal (sequência) do AppNext** com esse CFOP, e é ela que traz impostos, CST e modalidade do ICMS. O painel não guarda nem copia esses parâmetros.
- O botão usa o login do AppNext já salvo (passo 1 do guia, ou cartão "Acesso ao AppNext"). Sem ele, ou sem o robô ligado, o botão fica desligado com o motivo (e o link para o passo 1); dá para digitar o CFOP.
- O pedido ao robô leva `cfop` (`src/nfe.js` na venda, `src/devolucao.js` na devolução). Na venda, o CFOP (se houver um antigo salvo) só vale para o cabeçalho da nota: a regra de cada produto é a do AppNext (ver abaixo). Na devolução, só a regra com o CFOP escolhido — se não houver, para e diz quais existem (nunca emite com outro).
- **Regras fiscais pelo nome (decisão do dono, 23/11/2026; NFE-REGRA-01…03):** na **venda** não há escolha — cada produto usa a regra fiscal vinculada a ele no AppNext (com ST ou sem ST, na mesma nota); se o AppNext não escolher sozinho, o robô só aceita quando o produto está em UMA regra de venda (em duas, para e avisa qual: nunca chuta); o teste mostra a regra e o CFOP de cada produto (`r.regras` em `nfe.js`, embaixo do nome em `nfsaida.js`). Na **devolução**, a tela mostra as regras pelo nome ("DEVOLUÇÃO AO FORNECEDOR · CFOP 5202 · N produtos") e grava o CFOP dela (a nota de devolução tem um CFOP só; `loja.nfeCfop.devolucao`). A lista vem de `cadastros.regras` (o "Atualizar do AppNext", só leitura) ou, na falta, das regras que o robô viu na última devolução (`nfe/regras-devolucao.json`). `nfeCfop.venda` antigo continua só como CFOP do cabeçalho da nota.
- Perda (inventário) **não** tem nota no painel; fica para depois, conforme o contador do dono responder (CFOP 5.927 no Simples Nacional).

## Regras que não mudam
- O robô conclui e homologa NF-e (venda e devolução) **só depois da revisão** (teste conferido no painel, total igual ao do teste),
  e só para admin, franqueado e gerentes com a tela Notas fiscais. Confira no servidor, não só na tela.
- Toda ação (teste, rascunho, emitir) vai para `C.auditar`. Pedido repetido para a mesma nota (robô já na fila ou nota já gravada) devolve 409.
- Sem coletor ligado na VPS (`COL.ativo()`), as rotas respondem erro em vez de fingir que mandaram.
- Explorando o AppNext: nunca Concluir, Homologar ou Salvar fora desse fluxo.
- Na apresentação nada vai para o robô: resposta simulada.
- A confirmar com o dono: a primeira NF-e real emitida pelo painel ou pelo Orçamento; a linha "campos de desconto no AppNext" no log.
- **Devolução compensada à mão (Créditos com a franquia, decisão do dono 23/11/2026):** o "⋯" da devolução tem "Compensada em nota fiscal de entrada" (janela que procura a nota pelo nº, fornecedor ou data, as mais recentes primeiro e aba "Da franquia"; grava `{nota: id}` em `conta-franquia.json`, o mesmo vínculo do "ligar" e do automático; sem a nota no painel, o nº da NF digitado, que liga sozinho se for de uma nota da loja), "Compensada nos royalties" (mês de referência numa lista do atual e dos 11 anteriores, grava `mes` AAAA-MM) e "Compensada de outro jeito". Não existe mais "no boleto"; registros antigos (boleto, royalties em texto livre) continuam aparecendo com o texto. A conferência é só do servidor (`CF.compensacao`), na mesma rota e com a mesma permissão de antes (`lojaCF`: tela Notas fiscais e loja da pessoa), auditada. Apresentação: a rota só confere e a tela troca na memória. Testes: FRQ-COMP-01…07.
- **Reajuste de custo → franquia:** na nota de entrada, o aviso "O custo subiu" tem "✉ Enviar para a franquia" (só admin e franqueado, `podeReajuste` no servidor). A pessoa marca os itens, edita para/assunto/mensagem e envia pelo e-mail da loja (`POST /api/reajuste/enviar`, `src/cobranca.js` → `tabelaReajuste`); opcionalmente com o gráfico do histórico de compras de cada item (PNG desenhado na tela por `graficoComprasPng`, conferido em `conferirGraficos` e embutido no e-mail por `cid`); fica em `cobrancas.json` (tipo `reajuste`, lembra os destinatários) e na auditoria. Apresentação: `/api/demo/reajuste/...` simula, nada é enviado.
- **Homologar só a saída certa:** sem o id na resposta do AppNext, a devolução não procura (manda homologar lá); a venda só procura com o parceiro e **exatamente uma** candidata. Tempo esgotado na conclusão: a mensagem manda conferir no AppNext antes de emitir de novo (evita nota em dobro).
- Cobrança e reajuste por e-mail à franquia: `podeReajuste`/admin-franqueado em **todas** as rotas (`/api/conta-franquia/email/*`, `/auto`, `/api/reajuste/*`); envio automático com trava (`cobCiclo`) e mês marcado antes de enviar.
- **Estoque antes de emitir:** a tela da NF-e mostra o estoque da última planilha do AppNext em cada produto e avisa (com confirmação) antes de chamar o robô quando a nota pede mais do que tem; o robô, na conferência (teste, rascunho ou emissão), lê o estoque que o AppNext informa do produto e para sem salvar se faltar (`sem estoque no AppNext: …`). O AppNext só recusa de verdade ao concluir ("não possui estoque suficiente").
- **Refazer e detalhes:** na lista "Notas pedidas ao robô", clicar na linha abre os detalhes (itens, estoque de agora, erro completo, ações); "↻ Refazer" abre o formulário já preenchido com o mesmo pedido (parceiro, vendedor, pagamento e produtos achados nos cadastros) para ajustar e testar de novo — sem redigitar. Saída já concluída no AppNext não oferece refazer (evita nota em dobro).
- **DANFE e XML da nota emitida:** a lista "Notas de saída" lê os XMLs que o coletor baixa do AppNext. Quando o robô devolve a NF-e autorizada, o servidor pede ao coletor a importação só do XML do dia (`COL.historico(…, 'xml')`, marcado em `xml: pedido|proxima`); a linha da nota mostra DANFE e XML assim que o arquivo chega (`temXml`, via `NFS.chaves`) e a tela confere a cada 20 s por até 15 min. Coletor ocupado: chega na próxima coleta.
- **Lista "Notas pedidas ao robô" só com o que pede atenção** (decisão do dono): fica teste ainda emitível (2 h, não emitido), rascunho salvo, na fila e erros; nota autorizada some assim que tem DANFE/XML (vai para "Notas de saída"); teste que virou nota some. "↻ Refazer" só no dia do pedido (Brasília) e nunca para nota já emitida.
