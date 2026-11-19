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
