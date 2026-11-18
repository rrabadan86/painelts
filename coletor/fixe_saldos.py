#!/usr/bin/env python3
# Lê no FIXE (dash.epossible.com.br) o saldo oficial de pontos de cada cliente da loja.
# Só leitura: abre a página de Leads (a mesma do fixe_export.py), aproveita a consulta que a própria página faz
# (usersPaginateMulti, com o token CSRF da sessão) e pede as páginas seguintes, 1000 clientes por vez.
# Grava só CPF e pontos: {"em": ..., "total": N, "saldos": [[cpf, pontos], ...]}.
# Variáveis: FIXE_URL, FIXE_USER, FIXE_PASS (as mesmas da exportação), SAIDA_SALDOS (arquivo .json)
import json
import os
import sys
import traceback
from datetime import datetime
from pathlib import Path

from fixe_export import TZ, URL, USER, PASS, log, tela, primeiro, iniciar_watchdog

from playwright.sync_api import sync_playwright

SAIDA = os.getenv("SAIDA_SALDOS", "").strip()
POR_VEZ = 1000

# roda na página: repete a consulta da tela de Leads (mesmo corpo, sem busca), devolve só CPF e pontos
LER = """async ({ corpo, skip, n }) => {
  const c = JSON.parse(corpo);
  c.search = { value: '' }; c.skip = skip; c.length = n;
  const csrf = decodeURIComponent((document.cookie.split(';').map((x) => x.trim()).find((x) => x.startsWith('fixe_csrf=')) || '').slice(10));
  const r = await fetch('/bff/api/usersPaginateMulti', { method: 'POST', credentials: 'include',
    headers: { 'Content-Type': 'application/json', Accept: 'application/json', 'X-CSRF-Token': csrf, 'X-Passbook-Id': c.id_passbook || '' },
    body: JSON.stringify(c) });
  if (!r.ok) return { erro: r.status + ' ' + (await r.text()).slice(0, 200) };
  const j = await r.json();
  return { total: j.recordsTotal ?? j.recordsFiltered ?? 0,
    lista: (j.data || []).map((u) => [String((u.profile && u.profile.uniqueId) || '').replace(/\\D/g, ''), Number(u.total_points) || 0]) };
}"""


def main():
    if not (URL and USER and PASS and SAIDA):
        log("ERRO: acesso ao FIXE incompleto (endereço, usuário e senha).")
        return 2
    iniciar_watchdog(int(os.getenv("MAX_RUNTIME_SECONDS", "600")))
    with sync_playwright() as pw:
        b = pw.chromium.launch(headless=True)
        ctx = b.new_context(viewport={"width": 1400, "height": 900}, locale="pt-BR",
                            user_agent="Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124 Safari/537.36")
        page = ctx.new_page()
        page.set_default_timeout(30000)
        corpos = []
        page.on("request", lambda r: corpos.append(r.post_data) if "usersPaginateMulti" in r.url and r.method == "POST" and r.post_data else None)
        try:
            log("1) Abrindo o FIXE")
            page.goto(URL, wait_until="domcontentloaded", timeout=60000)
            page.wait_for_timeout(2500)
            senha = primeiro(page, ["input[type=password]"], 8000)
            if senha:
                log("2) Login")
                usuario = primeiro(page, ["input[type=email]", "input[name*=email i]", "input[name*=user i]", "input[type=text]"], 5000)
                if not usuario:
                    raise RuntimeError(f"não achei o campo de usuário na tela de login. Na tela: {tela(page)}")
                usuario.fill(USER)
                senha.fill(PASS)
                botao = primeiro(page, ["button[type=submit]", "button:has-text('Entrar')", "button:has-text('Login')", "button:has-text('Acessar')"], 3000)
                (botao.click() if botao else senha.press("Enter"))
                page.wait_for_timeout(4000)
                if primeiro(page, ["input[type=password]"], 1500):
                    raise RuntimeError(f"o login não passou (usuário ou senha do FIXE?). Na tela: {tela(page)}")
                if "/leads" not in page.url:
                    page.goto(URL, wait_until="domcontentloaded", timeout=60000)
            log("3) Esperando a lista de Leads")
            for _ in range(60):
                if corpos:
                    break
                page.wait_for_timeout(500)
            if not corpos:
                raise RuntimeError(f"a página de Leads não fez a consulta de clientes. Na tela: {tela(page)}")
            corpo = corpos[0]
            saldos, total, skip = {}, None, 0
            while True:
                r = page.evaluate(LER, {"corpo": corpo, "skip": skip, "n": POR_VEZ})
                if r.get("erro"):
                    raise RuntimeError(f"o FIXE recusou a consulta: {r['erro']}")
                total = r["total"] if total is None else total
                for cpf, pts in r["lista"]:
                    if 8 <= len(cpf) < 11:
                        cpf = cpf.zfill(11)
                    if len(cpf) == 11 and cpf.strip("0"):
                        saldos[cpf] = max(saldos.get(cpf, 0), pts)  # o mesmo CPF pode ter mais de um cadastro
                skip += POR_VEZ
                log(f"   {min(skip, total)} de {total} clientes")
                if not r["lista"] or skip >= total or skip > 200000:
                    break
            destino = Path(SAIDA)
            destino.parent.mkdir(parents=True, exist_ok=True)
            tmp = destino.with_name(f"{destino.name}.{os.getpid()}.tmp")
            tmp.write_text(json.dumps({"em": datetime.now(TZ).isoformat(), "total": total, "saldos": sorted(saldos.items())}), encoding="utf-8")
            os.chmod(tmp, 0o640)
            tmp.replace(destino)
            log(f"4) Saldos gravados: {len(saldos)} CPFs, {sum(1 for v in saldos.values() if v > 0)} com pontos")
            return 0
        except Exception:  # noqa: BLE001
            log("### ERRO NO FIXE (saldos) ###")
            print(traceback.format_exc())
            return 1
        finally:
            try:
                b.close()
            except Exception:  # noqa: BLE001
                pass


if __name__ == "__main__":
    sys.exit(main())
