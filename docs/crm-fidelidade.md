# CRM e fidelidade próprios (substituir a FIXE) — o que sabemos e o que foi decidido

Documento interno do projeto. Registra a conversa com o dono de 23 e 24/11/2026: a franquia viu o painel e perguntou se
podemos substituir a FIXE como CRM e programa de pontos da rede. **Ainda não há código desta parte**: o trabalho
começa quando chegar a documentação da integração de fidelidade da NextSoft. Nada aqui tem dado de cliente.

## 1. Decisões do dono (24/11/2026)

| Assunto | Decisão |
|---|---|
| Começar a construir | **Só depois da documentação da integração de fidelidade do AppNext** (NextSoft). Até lá, nada de código. |
| Integração com o caixa | A do AppNext é **padrão** ("já teve outros CRMs antes"): a NextSoft só troca o endereço/chave na loja. |
| Onde roda | **Uma VPS só no começo**: painel, robô do WhatsApp e o serviço da fidelidade, cada um no seu contêiner. Backup diário fora da máquina e aviso no celular se a fidelidade cair, desde o primeiro dia. Pode ir para uma VPS própria depois, sem mudar o código. |
| Tela | **No painel de hoje** (mesmo login e visual). O que fica separado é só o serviço que o caixa chama (API + banco de pontos), no mesmo repositório, como o `zap/`. |
| Perfil novo "Franquia" | Vê **só o CRM** da rede toda: clientes do fidelidade, saldos, regras, prêmios, resgates, ajustes e relatórios de pontos. **Nunca** vendas, faturamento, custos, estoque, pedidos, comissão, Resultado nem Conversas. Trava no servidor. |
| Saldo | **Da rede, não por loja** (confirmado em 24/11/2026): um saldo por cliente, válido em todas as lojas. Na migração, o mesmo cliente vem nos arquivos de várias lojas e conta uma vez só (cliente e movimento). |
| Histórico | **Só o que vem da FIXE. Passado é passado**: não recalculamos pontos antigos; vale o saldo da FIXE na data da troca. |
| Pontos importados sem validade | Ganham **vencimento = data da nossa implantação + 6 meses** e são os primeiros a sair no resgate (opção "C"). Precisa da aprovação da franquia (é regra do programa). |
| Valor do ponto | Configurável **com vigência** ("a partir de dd/mm, R$ 70 = 1 ponto"). Cada venda ganha pela regra do dia dela; pontos já ganhos não mudam. |
| Boas-vindas com bônus de cadastro completo | 1 ponto no cadastro (como hoje) **mais 1 ou 2 pontos de bônus** (a definir) quando o cadastro estiver completo — 2 ou 3 pontos além dos da compra. Objetivo: incentivar cadastro de qualidade. Quais campos contam como "completo" fica para a franquia definir. |
| Ajuste de saldo | **Sem ajuste manual** por loja nem pela tela: toda correção é pedida ao **suporte**, que valida o caso e só lança depois da **aprovação da franquia**, registrando motivo, quem pediu, quem aprovou e quando. |
| Prêmios | Tela no painel: produto do AppNext, quantos pontos custa, ativo, desde quando (e, se quiser, até quando e em quais lojas). Mudar o preço vale para os resgates seguintes. O AppNext recebe a lista pela integração (não cadastra nada lá). |
| Preço | Implantação **R$ 12.000** (sugestão: 3 parcelas — início, piloto rodando, migração completa) com escopo fechado; mensalidade sugerida **R$ 220–250 por loja** (a FIXE cobra R$ 285); contrato mínimo de 12 meses; reajuste anual (IPCA). |

## 2. Como o programa funciona hoje (FIXE + AppNext)

- **27 lojas** na rede, nem todas assinam a FIXE. A FIXE cobra **R$ 285/mês por loja**.
- No caixa, o vendedor informa o **CPF do fidelidade** (que pode não ir na nota). O AppNext consulta a FIXE para saber se o cliente tem cadastro.
- Ao **finalizar a venda**, o AppNext manda a venda para a FIXE. Os pontos ficam disponíveis **24 horas depois** (não é tempo real).
- **Resgate pelo AppNext**: o vendedor informa o CPF, o AppNext consulta a pontuação e o vendedor escolhe o produto (prêmio = produto, pelo número de pontos). O prêmio sai no cupom a **R$ 0,01** (`ehResgate` em `core.js`, VEN-10).
- **Validade: 12 meses** da compra. Boas-vindas: 1 ponto no cadastro. Regra padrão do painel: R$ 50 = 1 ponto, mínimo para resgate 6 pontos (`REGRAS_PADRAO` em `src/fidelidade.js`, ajustável por loja).
- O cliente consulta o saldo num **app da FIXE** — teremos de oferecer o nosso ("Meus pontos").
- Os prêmios entram na conta com a franquia: a franquia paga 50% do custo, descontado nos royalties (FRQ-10, `contafranquia.js`).

Os três momentos em que o caixa conversa com o CRM (e que teremos de atender pela integração padrão):

| Momento no caixa | O que o AppNext pede/manda | Prazo |
|---|---|---|
| CPF do fidelidade informado | "este CPF tem cadastro?" | resposta na hora |
| Resgate | saldo + prêmios possíveis; depois "baixa o prêmio" | resposta na hora |
| Venda finalizada | a venda com o CPF do fidelidade | pontos liberados em 24 h |

## 3. O que o painel já faz com a FIXE (hoje: só observar)

- **Logs da FIXE** (exportação "Logs", uma linha por movimento): importados por e-mail ou envio manual (`src/fidelidade.js` → `importar`, `ler`, `evento`; guardados em `dados/<loja>/fixe/eventos.json.gz`; a exportação é sempre o histórico inteiro e substitui a anterior).
- **Saldo oficial**: o robô do FIXE lê o saldo direto na FIXE (sincronização) e a "Base de leads" pode trazer a coluna de saldo; vale o mais recente (`membros()` em `public/js/fidelidade.js`). O saldo da FIXE é **da rede** (confirmado pelo dono em 24/11/2026): o mesmo em todas as bases, como o painel já trata.
- **Saldo pelos Logs** (para comparar e para os vencimentos): lotes de pontos em FIFO, cada lote vence `validadeMeses` depois; resgate, expiração e saída tiram dos lotes mais antigos (`saldos()`); "Operação cancelada via PDV" anula o lançamento de pontos ou resgate mais recente do mesmo dia (até 60 min antes, preferindo o que tem os mesmos produtos).
- **Ciclo de resgate** (quem juntou o mínimo e resgatou ou não em `prazoResgate` dias): `resgates()`.
- Clientes, Hoje, Campanhas, robô do WhatsApp, Conversas e o "retorno do programa" (`fidretorno.js`) já usam esses dados.

### Como o painel acha o cupom de cada movimento da FIXE (a FIXE não guarda o nº do cupom)

**Compras/pontos → cupom** (`ligar()` em `public/js/fidelidade.js`):
1. Só movimentos de compra ou pontos, não anulados, da **própria loja** e em dias em que o painel tem as vendas dela (o resto fica "fora do período").
2. Candidatos: os cupons da mesma loja e do mesmo dia.
   - Se os dois têm hora: no máximo **120 min** de diferença (`JANELA_MIN`).
   - Produtos: o nome de cada produto da FIXE é quebrado em palavras (gramagem junta: "50 g" → "50g") e comparado com as descrições do cupom. Um produto "bate" com 70% das palavras; o cupom precisa de pelo menos metade dos produtos batendo.
   - Pontos: `floor(valor do cupom sem as taxas ÷ R$ por ponto)` tem de ser igual aos pontos lançados. É obrigatório quando só a hora liga.
   - Sem produto e sem hora: não liga.
3. Nota = produtos × 2 + pontos certos (1) + proximidade da hora (0 a 1). Liga do mais certo para o menos certo, **cada cupom uma vez só**, e só quando o melhor é claramente melhor que o segundo (diferença ≥ 0,3; senão fica "ambíguo" com os candidatos para conferir à mão).
4. Resultado: o movimento ganha o cupom (com hora e valor), e a tela conta quantos ficaram sem cupom.

**Resgates → cupom** (`cupomDosResgates()`), nesta ordem:
1. A compra do mesmo cliente no mesmo dia que já foi ligada a um cupom (pontos da mesma venda) → "fixe".
2. Cupom com o CPF dele na NF-e/NFC-e (XML), no dia ou um dia antes/depois → "cpf".
3. Hora (até 120 min) + o produto do prêmio no cupom → "hora".

**Para que serve na migração:** dentro do período de vendas que o painel tem de cada loja, dá para achar o valor em R$ de cada compra da FIXE e **conferir se os pontos batem** com a regra, antes de assumir o saldo. Compras antigas (ex.: as importadas de 2023) ficam de fora — e tudo bem: passado é passado.

## 4. O que vimos nas exportações da FIXE (Flamboyant, 24/11/2026; só contagens)

Cada loja tem os **seus arquivos** (o export é por operação). Dois arquivos:

- **Saldos** — colunas `Nome; Data Cadastro; Email; Aniversário; CPF; Loja; Saldo; Telefone; Estado *; Cidade *`. ~1,3 mil clientes, ~750 com saldo; pontos inteiros; CPF só números (uma linha veio com ponto e traço).
- **Logs** — colunas `Nome; Data Cadastro; Email; CPF; Loja; RESGATE; DATA TRANSAÇÃO; Histórico`. ~5 mil movimentos: compra (sem valor e sem pontos), "Adicionado N pontos" (1 a 8 por vez), expirados, resgate de N pontos com o produto, boas-vindas, "Operação cancelada via PDV".
- Formato: **Latin-1 (ISO-8859-1)**, `;`, quebra de linha **dentro** da célula Histórico, datas em dois formatos (`01/05/2026` e `1/5/2026`), "DATA TRANSAÇÃO" com erro em parte das linhas (vale a data do Histórico), coluna RESGATE sempre "Não", nome de loja às vezes com ponto no fim ("FLAMBOYANT."). `src/fidelidade.js` já lê esse formato.
- O preço de um prêmio mudou com o tempo (o mesmo produto resgatado por 10 e depois por 12 pontos): confirma "preço novo só para o futuro".
- **A importação de 02/07/2025** (tudo à meia-noite, "Compra feita em …/2023") trouxe o histórico antigo, mas **os pontos entraram no saldo sem linha "Adicionado"**, ou seja, sem data: cerca de 300 clientes têm saldo maior que a soma dos movimentos (~3,2 mil pontos sem origem) e quase 300 têm saldo sem nenhum movimento. Com 12 meses, teriam vencido em 02/07/2026 e a FIXE não tirou. Decisão: **vencem 6 meses depois da nossa implantação** (seção 1).

## 5. O que teremos de construir (quando chegar a documentação)

1. **Serviço da fidelidade** (contêiner próprio, mesmo repositório): a API no padrão do AppNext (cadastro, saldo + prêmios, resgate, venda, cancelamento), resposta em menos de 1 s, sem contar a mesma venda nem baixar o mesmo resgate duas vezes (chave única por venda/resgate).
2. **Banco de pontos** (banco de dados de verdade, não arquivos): cada movimento com data, origem e quem fez; liberação em 24 h; vencimento por lote (FIFO); estorno; bônus de cadastro completo; correção só pelo suporte com a aprovação da franquia registrada (nunca ajuste livre na tela).
3. **Conferência diária** com as vendas que o painel já lê do AppNext (venda que não chegou, cancelamento).
4. **Telas no painel**: regras (valor do ponto com vigência), prêmios, saldos, ajustes, relatórios por loja; perfil Franquia.
5. **App "Meus pontos"** do cliente: CPF + código pelo WhatsApp; saldo, prêmios, vencimentos, regulamento (o painel já é instalável).
6. **Migração** loja por loja a partir dos arquivos da FIXE: saldo de partida = o da FIXE na data da troca; lotes pelos "Adicionado" dos últimos 12 meses; o que sobrar sem data vira lote com vencimento em implantação + 6 meses.
7. **Troca sem risco**: conferência em paralelo (3–4 semanas), piloto em 1–2 lojas do dono, depois loja por loja.

## 6. O que falta saber (levar à franquia)

- Documentação da integração de fidelidade do AppNext (chamadas, autenticação, o que o caixa faz se o CRM não responder, se a troca é por loja, se a NextSoft cobra).
- A importação sem validade aconteceu em todas as lojas?
- Cadastro completo: quais campos contam (e-mail, celular, aniversário, cidade…) e se o bônus é de 1 ou 2 pontos.
- Regulamento completo: valor do ponto, prêmios e pontos de cada um, mínimo para resgate, regras de estorno, boas-vindas.
- Quais lojas assinam a FIXE e quando vence o contrato.
- Aprovação da regra dos pontos importados (vencimento em implantação + 6 meses) e de como avisar os clientes.

## 7. Cuidados que não mudam

- Os arquivos exportados da FIXE têm nome, CPF, e-mail e telefone: **nunca vão para o Git**, nem para log, auditoria ou conversa com terceiros. Na importação, ficam em `dados/` como o resto.
- LGPD: a franquia é a controladora; nós somos operadores (contrato, política de privacidade, plano para vazamento, devolução dos dados na saída).
- O saldo é dívida da rede com o cliente: toda mudança de saldo é auditada e reversível por movimento contrário, nunca apagada.
