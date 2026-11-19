---
paths:
  - "public/**"
  - "tests/e2e/**"
---
# Tela (public/js)

- JavaScript puro, tudo no namespace `TS`: `TS.h()` monta elementos, `TS.table`, `TS.kpi`, `TS.seg`, `TS.chart`, `TS.api`
  (este já sabe se está na apresentação; `TS.demo` diz se é apresentação).
- Script novo precisa entrar em `APP_SCRIPTS` no `server.js` (a ordem importa: `core.js` primeiro, `main.js` por último).
- O versionamento dos arquivos (`?v=`) é automático: não mexa.
- `replaceChildren(...)` com `null` escreve "null" na tela: sempre `[...].filter(Boolean)`.
- Esconder na tela não é permissão: o servidor também precisa negar (custo/margem nunca para vendedora; clientes não vão para vendedora).
- Textos simples e diretos, em português; nada de termos técnicos para a vendedora.
- Toda tela funciona na apresentação (`/apresentacao`, dados fictícios, nada gravado nem enviado).
- Mudou algo visível: confira no celular (390 px) — skill `conferir-celular`. Tela nova: skill `nova-tela`.
- Testes de tela (`tests/e2e`) rodam sempre na apresentação, nos projetos "computador" e "celular".
