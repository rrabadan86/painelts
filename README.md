# Tea Shop · Painel de vendas

Painel web que substitui o relatório Power BI "Tea Shop - Igor". Ele aplica as mesmas transformações do Power Query e as mesmas regras das medidas DAX.

- Várias lojas no mesmo endereço: cada usuário vê só a(s) loja(s) dele, e o admin troca de loja ou vê "Todas as lojas".
- Os dados ficam na VPS (`dados/<loja>/`), enviados pelo script diário. O que não estiver lá é lido do Google Drive.
- 5 páginas: Resumo, Comparativos, Comissionamento, Promoção e Clientes. Funciona no celular.

## Estrutura

```
teashop-painel/
├── config/lojas.json        ← lojas, usuários (senha com hash) e token de upload
├── dados/<loja>/*.xlsx      ← planilhas de cada loja (o script diário grava aqui)
├── scripts/admin.js         ← comandos para criar loja, usuário, token
├── exemplos/                ← como enviar a planilha a partir do seu script
├── src/                     ← servidor: leitura das planilhas e transformações
└── public/                  ← interface (páginas e regras de negócio)
```

## Arquivos de cada loja

| Nome (na pasta da loja ou no upload) | Conteúdo | Aba lida |
|---|---|---|
| `importacaoA` | Vendas do período atual (relatório diário) | `Sheet1` |
| `importacaoB` | Histórico de vendas | `Sheet1` |
| `NFA` | Vendas NF-e | `Sheet1` |
| `Xml` | Cupons com CPF | `Xml` |
| `Dados_Clientes` | Cadastro de clientes | `Planilha1` |
| `Meta` | Meta mensal (primeiro número da planilha) | primeira aba |

Para cada arquivo, o painel usa `dados/<loja>/<nome>.xlsx` se existir. Se não existir, usa o ID do Drive que estiver em `lojas.json`. Quando um arquivo novo chega na pasta, a loja é reprocessada no próximo acesso, sem esperar o cache.

As planilhas de vendas precisam ter o mesmo formato do relatório atual: 1ª linha com o título, 2ª linha com os cabeçalhos (`Loja`, `CNPJ`, `Data`, `Número Cupom`, ...).

## Administração (lojas, usuários, token)

Na VPS, dentro da pasta do projeto:

```bash
A="docker compose exec teashop-painel node scripts/admin.js"
$A iniciar                                  # 1ª vez: cria lojas.json com Torres e um token de upload
$A loja palmas "Tea Shop Palmas" 60000      # cria/edita loja (id, nome, meta opcional)
$A usuario igor torres                      # pede a senha; acesso só a Torres
$A usuario rodrigo '*'                      # admin: todas as lojas
$A usuario gerente torres,palmas            # mais de uma loja
$A remover-usuario igor
$A drive palmas Xml <id-do-drive>           # fonte no Drive para um arquivo que não vem do script
$A token                                    # gera um novo token de upload
$A listar                                   # mostra lojas, origem de cada arquivo e usuários
```

O painel relê o `lojas.json` sozinho. Não precisa reiniciar depois desses comandos.

## Envio diário das planilhas

Com o token de upload:

```bash
curl -X POST -H "Authorization: Bearer SEU_TOKEN" \
     --data-binary @relatorio.xlsx \
     https://painel.seudominio.com.br/api/upload/torres/importacaoA
```

A pasta `exemplos/` tem o mesmo envio em Python (`enviar_planilha.py`), Bash e PowerShell. A gravação é atômica: o painel nunca lê um arquivo pela metade.

Se o script rodar na própria VPS, ele pode gravar direto em `dados/<loja>/importacaoA.xlsx`. Grave com outro nome e depois renomeie (`mv`), para a troca ser atômica.

## Coletor: script das lojas rodando na VPS

O serviço `coletor` (pasta `coletor/`) roda o script de exportação do AppNext de cada loja na própria VPS, sem GitHub, sem rclone e sem Drive. A planilha sai direto em `dados/<loja>/importacaoA.xlsx`.

- **Agenda:** roda sozinho nos horários de `COLETOR_HORARIOS` (padrão 13:30 e 23:00), uma loja por vez.
- **Botão de nuvem:** coloca a loja na fila na hora e mostra o andamento.
- **Credenciais:** cada loja tem um arquivo `config/coletor/<loja>.env`, criado a partir do `exemplo.env.modelo`. Ele fica só na VPS.
- **Script próprio:** se uma loja precisar de um script diferente, coloque-o em `config/coletor/<loja>.py`, que ele passa a ser usado no lugar do padrão.
- **Logs:** a última execução de cada loja fica em `coletor-work/<loja>/ultimo.log`. O administrador também vê o final do log no painel quando a execução falha.

Quando o coletor tem a loja configurada, o botão de nuvem usa o coletor. Se não tiver, usa o GitHub (seção abaixo).

## Botão "Atualizar dados do sistema" via GitHub (alternativa)

Entre o ⟳ e o botão de sair aparece um ícone de nuvem nas lojas que têm o script ligado. Ele roda na hora o script da loja no GitHub Actions, mostra o andamento e recarrega o painel quando termina. Se o script já estiver rodando, o botão não dispara outra execução, e há um intervalo mínimo de 2 minutos entre disparos.

1. No GitHub: **Settings → Developer settings → Personal access tokens → Fine-grained tokens → Generate new token**.
   - **Repository access:** *Only select repositories*, marcando os repositórios das lojas (`TS---Torres`, `TS---Palmas`...).
   - **Permissions → Repository permissions → Actions:** *Read and write*. O resto fica como está.
   - **Expiration:** escolha uma data (ex.: 1 ano) e anote para renovar.
2. Na VPS, coloque o token em `GITHUB_TOKEN=` no `.env` e rode `docker compose up -d`.
3. Ligue cada loja ao repositório dela:
   ```bash
   $A github torres rrabadan86/TS---Torres
   $A github palmas rrabadan86/TS---Palmas
   ```
   Se o workflow não se chamar `run.yml` ou a branch não for `main`, informe depois: `$A github palmas dono/repo outro.yml master`.

Qualquer usuário com acesso à loja pode acionar o script dela. O log do painel registra quem acionou.

## Subir na VPS

Veja o guia passo a passo. Resumo:

```bash
cd /opt/teashop-painel
cp .env.example .env && nano .env            # SESSION_SECRET=$(openssl rand -hex 32)
mkdir -p config dados && chown -R 1000:1000 config dados
docker compose up -d --build
docker compose exec teashop-painel node scripts/admin.js iniciar
docker compose exec teashop-painel node scripts/admin.js usuario rodrigo '*'
```

Coloque HTTPS na frente (Caddy ou Nginx) apontando para `127.0.0.1:3000`.

## Onde fica cada regra

| Arquivo | O que tem |
|---|---|
| `src/transform.js` | Etapas do Power Query: grupos, categorias, gramatura, kg de chá, `Grupo - Copiar`, fidelidade, CPF e lojas |
| `public/js/rules.js` | Medidas DAX: metas, comissões por faixa e loja, premiação, bônus, rateio Vila Madalena, gorjetas, royalties |
| `public/js/pages.js` | Páginas Resumo, Comparativos, Comissionamento e Promoção |
| `public/js/clientes.js` | Página Clientes |

## Diferenças em relação ao Power BI

- **Período:** Ano, Mês e Dia viraram um intervalo de datas com atalhos.
- **Ano contra ano:** a variação aparece sempre que existe dado do ano anterior.
- **Comissionamento:** a linha Total soma os vendedores. A meta vem do `lojas.json` ou da planilha "Meta".
- **Royalties:** aparecem por loja.
- **Tipos de chá:** um seletor no lugar de 8 gráficos.
- **Clientes:** cartões com cupons e itens, WhatsApp, filtros de visitas, ausência e aniversário, exportação CSV.
- **Visão consolidada:** "Todas as lojas" junta as lojas. Os cupons são contados por loja, porque a numeração pode se repetir entre elas.

## Teste local

```bash
npm install
mkdir -p dados/torres && cp /suas/planilhas/*.xlsx dados/torres/
node scripts/admin.js iniciar
node scripts/admin.js usuario teste '*' --senha teste1234
SESSION_SECRET=dev node server.js            # http://localhost:3000
```

## Novidades (versão com Configurações)

- **Configurações** (aba ⚙, para administrador e franqueado): lojas, acesso ao AppNext, metas por mês,
  regras de comissão, logo e nome, envio de planilhas, usuários e perfis, horários, resumo diário e histórico de alterações.
  O `scripts/admin.js` continua funcionando como plano B.
- **Histórico mês a mês** em `dados/<loja>/base/`: cada planilha que chega substitui só os dias que ela cobre.
  A rotina do coletor baixa os últimos `COLETOR_JANELA` dias (45). Na primeira vez, as planilhas antigas são
  somadas automaticamente na base e movidas para `dados/<loja>/processados/`.
- **Perfis**: administrador, franqueado, gerente (sem dados de clientes) e vendedor (só "Minha comissão").
- **Resumo diário** por Telegram e/ou e-mail, com alertas.
- **Sua loja × rede**: comparação anônima (mínimo de 4 lojas com vendas no mês).
