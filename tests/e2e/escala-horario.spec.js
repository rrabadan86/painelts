const { test, expect } = require('@playwright/test');

// A escala respeita o horário de funcionamento mesmo quando não é "redondo" (ex.: abre 09:40):
// alguém começa na hora exata da abertura, ninguém começa antes nem sai depois do fechamento
test('Escala: abertura às 09:40 tem gente desde 09:40 (antes começava 10:00) e ninguém passa do horário', async ({ page }) => {
  await page.goto('/apresentacao'); await page.waitForFunction(() => window.TS && TS._escala);
  const r = await page.evaluate(() => {
    const H = (abre, fecha) => ({ abre, fecha, fechado: false });
    const op = {
      funcionamento: { seg: H('09:40', '22:00'), ter: H('09:40', '22:00'), qua: H('09:40', '22:00'), qui: H('09:40', '22:00'), sex: H('09:40', '22:00'), sab: H('09:40', '21:50'), dom: H('12:00', '21:00') },
      equipe: { funcionarios: 3, cargaSemanal: 44, escala: '6x1', intervalo: 60, capacidade: 3, modelo: 'rodizio' },
    };
    const need = Array.from({ length: 7 }, () => Array(24).fill(1));
    const pessoas = ['A', 'B', 'C'].map((nome) => ({ nome, folga: 'auto', folga2: 'auto', turno: 'tanto' }));
    const out = TS._escala.montarRodizio(need, op, pessoas);
    const hm = (s) => +s.slice(0, 2) * 60 + +s.slice(3, 5);
    const DIAS = ['seg', 'ter', 'qua', 'qui', 'sex', 'sab', 'dom']; // como no painel: 0 = segunda
    const dias = [];
    for (const sem of out.semanas) for (let wd = 0; wd < 7; wd++) {
      const ts = sem.turnosP.map((p) => p[wd]).filter(Boolean);
      if (!ts.length) continue;
      const f = op.funcionamento[DIAS[wd]];
      dias.push({ wd, abre: hm(f.abre), fecha: hm(f.fecha), primeiro: Math.min(...ts.map((t) => t.ini)), ultimo: Math.max(...ts.map((t) => t.fim)), antes: ts.some((t) => t.ini < hm(f.abre)), depois: ts.some((t) => t.fim > hm(f.fecha)), duracoes: ts.map((t) => t.fim - t.ini) });
    }
    return dias;
  });
  expect(r.length).toBeGreaterThan(0);
  for (const d of r) {
    expect(d.antes, `ninguém começa antes da abertura (dia ${d.wd})`).toBe(false);
    expect(d.depois, `ninguém sai depois do fechamento (dia ${d.wd})`).toBe(false);
  }
  // segunda a sexta (abre 09:40): o primeiro turno começa às 09:40
  const uteis = r.filter((d) => d.wd <= 4);
  expect(uteis.length).toBeGreaterThan(0);
  for (const d of uteis) expect(d.primeiro).toBe(9 * 60 + 40);
  // sábado fecha 21:50: quem fecha sai às 21:50 (não 21:30)
  for (const d of r.filter((x) => x.wd === 5)) expect(d.ultimo).toBe(21 * 60 + 50);
  // domingo (12:00–21:00) continua certo
  for (const d of r.filter((x) => x.wd === 6)) { expect(d.primeiro).toBe(12 * 60); expect(d.ultimo).toBe(21 * 60); }
});

// Intervalo configurável por faixa de jornada: acima de 8h e até 8h
test('Escala: intervalo da jornada acima de 8h e o da jornada de até 8h são configurados à parte', async ({ page }) => {
  await page.goto('/apresentacao'); await page.waitForFunction(() => window.TS && TS._escala && TS._intervalo && TS.editorOperacao);
  const r = await page.evaluate(() => {
    const { intervaloMin, abaixoClt } = TS._intervalo;
    const H = (abre, fecha) => ({ abre, fecha, fechado: false });
    const func = { seg: H('09:00', '22:00'), ter: H('09:00', '22:00'), qua: H('09:00', '22:00'), qui: H('09:00', '22:00'), sex: H('09:00', '22:00'), sab: H('09:00', '22:00'), dom: H('12:00', '21:00') };
    const need = Array.from({ length: 7 }, () => Array(24).fill(1));
    const pessoas = ['A', 'B', 'C', 'D'].map((nome) => ({ nome, folga: 'auto', folga2: 'auto', turno: 'tanto' }));
    const duracoes = (equipe) => { const out = TS._escala.montarRodizio(need, { funcionamento: func, equipe }, pessoas); const d = new Set(); for (const s of out.semanas) for (const p of s.turnosP) p.forEach((t, wd) => { if (t && wd < 6) d.add(t.fim - t.ini); }); return [...d]; }; // seg a sáb (0 = segunda)
    const base = { funcionarios: 4, cargaSemanal: 44, intervalo: 60, capacidade: 3, modelo: 'rodizio' };
    // editor: os dois campos e a linha que diz qual vale
    const box = TS.editorOperacao({ funcionamento: func, equipe: { ...base, escala: '6x1', intervaloAte8: 30 } }, () => {});
    document.body.append(box);
    const labels = [...box.querySelectorAll('label span')].map((x) => x.textContent);
    const info = box.querySelector('.op-int-info');
    return {
      acima: intervaloMin({ intervalo: 90, intervaloAte8: 30 }, 528), ate8: intervaloMin({ intervalo: 90, intervaloAte8: 30 }, 440),
      semCampo7h: intervaloMin({ intervalo: 60 }, 440), semCampo5h: intervaloMin({ intervalo: 60 }, 300), curta: intervaloMin({ intervalo: 60, intervaloAte8: 30 }, 200),
      clt: [abaixoClt(440, 30), abaixoClt(440, 60), abaixoClt(300, 15), abaixoClt(300, 10)],
      // blocos de 10 min: 6x1 44h = 7h20 exatas + 30 min de intervalo → 7h50; 5x2 44h = 8h48 (8h50 em blocos de 10 min) + 60 → 9h50
      seisPorUm: duracoes({ ...base, escala: '6x1', intervaloAte8: 30 }), cincoPorDois: duracoes({ ...base, escala: '5x2', intervaloAte8: 30 }),
      labels, info: info && info.textContent, infoNeg: info && info.classList.contains('neg'),
    };
  });
  expect(r.acima).toBe(90); expect(r.ate8).toBe(30); expect(r.curta).toBe(0);
  expect(r.semCampo7h).toBe(60); expect(r.semCampo5h).toBe(30); // sem o campo novo: igual a antes
  expect(r.clt).toEqual([true, false, false, true]);
  expect(r.seisPorUm).toEqual([470]);
  expect(r.cincoPorDois).toEqual([590]);
  expect(r.labels).toContain('Intervalo — jornada acima de 8h (min)');
  expect(r.labels).toContain('Intervalo — jornada de até 8h (min)');
  expect(r.info).toMatch(/7h20 por dia → intervalo de 30 min/);
  expect(r.infoNeg).toBe(true); // 30 min numa jornada acima de 6h fica abaixo da CLT: avisa
});

// Ajuste manual: atalhos de um toque (abre/meio/fecha) com a jornada certa, relógio de 10 em 10 min e resumo na hora
test('Escala → ajuste manual: atalhos Abre/Meio/Fecha, passo de 10 min e resumo da jornada com avisos', async ({ page }) => {
  await page.goto('/apresentacao'); await page.waitForFunction(() => window.TS && TS.db);
  await page.evaluate(() => { location.hash = '#mapa'; });
  const cel = page.locator('td.trab.clicavel').first();
  await expect(cel).toBeVisible();
  await cel.evaluate((td) => td.click());
  const ed = page.locator('.aj-editor');
  await expect(ed).toBeVisible();
  const at = ed.locator('.aj-atalho');
  const n = await at.count();
  expect(n).toBeGreaterThanOrEqual(2); // Abre e Fecha; "Meio" só quando sobra 1h no dia
  await expect(at.nth(0)).toContainText('Abre');
  await expect(at.nth(n - 1)).toContainText('Fecha');
  await at.nth(0).evaluate((b) => b.click());
  const [ini, fim] = [ed.locator('input[type=time]').nth(0), ed.locator('input[type=time]').nth(1)];
  await expect(ini).toHaveAttribute('step', '600');
  const resumo = ed.locator('.aj-resumo');
  await expect(resumo).toContainText(/no total = \dh\d\d de trabalho/);
  await expect(resumo).not.toContainText('⚠'); // atalho já vem com a jornada padrão, dentro do horário
  // horário maior que a jornada: avisa na hora
  await ini.fill('07:00');
  await expect(resumo).toContainText('fora do horário da loja');
  // Fecha: termina no fechamento
  await at.nth(n - 1).evaluate((b) => b.click());
  const txtFecha = await at.nth(n - 1).locator('small').textContent();
  await expect(fim).toHaveValue(txtFecha.split('–')[1]);
  // aplica e "salva": na apresentação nada vai para o servidor
  await ed.getByRole('button', { name: 'Aplicar' }).click();
  await page.getByRole('button', { name: 'Salvar ajustes' }).click();
  await expect(page.locator('#content')).toContainText('Na apresentação nada é salvo');
});

// Dia curto (domingo 12h–21h = 9h) com jornada de 8h20 + 1h: encurta o trabalho, o intervalo continua de 1h (antes ficava 40 min)
test('Escala: em dia curto o intervalo continua inteiro (CLT) e o trabalho é que encurta', async ({ page }) => {
  await page.goto('/apresentacao'); await page.waitForFunction(() => window.TS && TS._escala);
  const r = await page.evaluate(() => {
    const H = (a, f) => ({ abre: a, fecha: f, fechado: false });
    const op = { funcionamento: { seg: H('09:40', '22:00'), ter: H('09:40', '22:00'), qua: H('09:40', '22:00'), qui: H('09:40', '22:00'), sex: H('09:40', '22:00'), sab: H('09:40', '22:00'), dom: H('12:00', '21:00') },
      equipe: { funcionarios: 3, cargaSemanal: 42, escala: '5x2', intervalo: 60, capacidade: 2, modelo: 'rodizio' } };
    const need = Array.from({ length: 7 }, () => Array(24).fill(1));
    const ps = ['Natalie', 'Isaias', 'Gabi'].map((nome) => ({ nome, folga: 'auto', folga2: 'auto', turno: 'tanto' }));
    const out = TS._escala.montarRodizio(need, op, ps);
    const dom = [], semana = [];
    for (const s of out.semanas) for (const p of s.turnosP) p.forEach((t, wd) => { if (!t) return; (wd === 6 ? dom : semana).push({ total: t.fim - t.ini, int: t.pausa ? t.pausa[1] - t.pausa[0] : 0 }); });
    return { dom, semana };
  });
  expect(r.dom.length).toBeGreaterThan(0);
  for (const t of r.dom) { expect(t.int).toBe(60); expect(t.total).toBe(540); } // 8h de trabalho + 1h
  for (const t of r.semana) { expect(t.int).toBe(60); expect(t.total).toBe(560); } // 8h20 + 1h
});

// Campo de hora do horário de funcionamento: digitar "0950" de uma vez não pode perder o foco no meio (antes saía no "09")
test('Horário e equipe: digitar a hora inteira no campo não perde o foco', async ({ page }, info) => {
  test.skip(info.project.name === 'celular', 'no celular a hora vem do seletor do sistema');
  await page.goto('/apresentacao'); await page.waitForFunction(() => window.TS && TS.db);
  await page.evaluate(() => { TS.state.mapaAba = 'equipe'; location.hash = '#mapa'; });
  const ab = page.locator('table.op-horas input[type=time]').first();
  await ab.waitFor();
  await ab.click({ position: { x: 12, y: 10 } });
  await page.keyboard.type('0950');
  await expect(ab).toBeFocused();
  await expect(ab).toHaveValue('09:50');
});

// Escala do mês: horas líquidas em cada dia e, no feriado, o horário usado e de onde veio
test('Escala do mês: horas líquidas por dia e horário do feriado no cabeçalho', async ({ page }) => {
  await page.goto('/apresentacao'); await page.waitForFunction(() => window.TS && TS.db);
  await page.selectOption('#lojaSel', 'demo-parque');
  await page.evaluate(() => { TS.state.escMesYm = '2026-11'; TS.state.mapaAba = 'escala'; location.hash = '#mapa'; });
  const cel = page.locator('td.trab').first();
  await expect(cel.locator('.liq-dia')).toHaveText(/^\dh(\d\d)? líquidas$/);
  // líquidas = total − intervalo
  const ok = await cel.evaluate((td) => {
    const m = (t) => +t.slice(0, 2) * 60 + +t.slice(3, 5);
    const [a, b] = td.querySelector('b').textContent.match(/\d\d:\d\d/g).map(m);
    const p = (td.querySelector('small') && td.querySelector('small').textContent.match(/\d\d:\d\d/g)) || [];
    const liq = (b - a) - (p.length === 2 && /int/.test(td.querySelector('small').textContent) ? m(p[1]) - m(p[0]) : 0);
    const t = td.querySelector('.liq-dia').textContent.match(/(\d+)h(\d\d)?/);
    return liq === +t[1] * 60 + +(t[2] || 0);
  });
  expect(ok).toBe(true);
  // feriado de novembro (Finados): horário da loja embaixo do nome
  await expect(page.locator('th.fer .fer-hor').first()).toHaveText(/\d\d:\d\d–\d\d:\d\d|fechada/);
});

// Dia de 6h (domingo 14h–20h) e feriado cortado: o intervalo segue o turno real (CLT: até 6h, intervalo curto; nunca sem intervalo acima de 4h)
test('Escala: turno curto de domingo usa o intervalo de até 6h e o feriado cortado mantém intervalo', async ({ page }) => {
  await page.goto('/apresentacao'); await page.waitForFunction(() => window.TS && TS._escala);
  const r = await page.evaluate(() => {
    const H = (a, f) => ({ abre: a, fecha: f, fechado: false });
    const op = { funcionamento: { seg: H('10:00', '22:00'), ter: H('10:00', '22:00'), qua: H('10:00', '22:00'), qui: H('10:00', '22:00'), sex: H('10:00', '22:00'), sab: H('10:00', '22:00'), dom: H('14:00', '20:00') },
      equipe: { funcionarios: 4, cargaSemanal: 44, escala: '6x1', intervalo: 60, capacidade: 3, modelo: 'rodizio' } };
    const need = Array.from({ length: 7 }, () => Array(24).fill(1));
    const ps = ['A', 'B', 'C', 'D'].map((nome) => ({ nome, folga: 'auto', folga2: 'auto', turno: 'tanto' }));
    const out = TS._escala.montarRodizio(need, op, ps);
    const dom = [];
    for (const s of out.semanas) for (const p of s.turnosP) { const t = p[6]; if (t) dom.push({ total: t.fim - t.ini, int: t.pausa ? t.pausa[1] - t.pausa[0] : 0 }); }
    return dom;
  });
  expect(r.length).toBeGreaterThan(0);
  for (const t of r) { expect(t.total).toBe(360); expect(t.int).toBe(30); } // 6h de loja: 5h30 de trabalho + 30 min (antes 5h + 1h)
  // turno digitado de 4h20 (mais de 4h seguidas): tem intervalo; de 4h: não tem
  const p = await page.evaluate(() => [TS._intervalo.pausaDoTurno(840, 1100, { intervalo: 60 }), TS._intervalo.pausaDoTurno(840, 1080, { intervalo: 60 })]);
  expect(p[0] && p[0][1] - p[0][0]).toBe(30);
  expect(p[1]).toBe(null);
});
