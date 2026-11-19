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
