(function () {
  var q = new URLSearchParams(location.search);
  var e = q.get('e');
  if (e) {
    var p = document.getElementById('err');
    var ate = (q.get('ate') || '').match(/^(\d{4})-(\d{2})-(\d{2})$/);
    p.textContent = e === 'limite' ? 'Muitas tentativas. Aguarde 15 minutos e tente de novo.'
      : e === 'expirou' ? 'Seu acesso terminou' + (ate ? ' em ' + ate[3] + '/' + ate[2] + '/' + ate[1] : '') + '. Fale com o responsável pela loja para renovar.'
      : 'Usuário ou senha incorretos.';
    p.hidden = false;
  }
  // link próprio da loja: /login?loja=<id> mostra o logo e o nome dela
  var loja = (q.get('loja') || '').toLowerCase().replace(/[^a-z0-9_-]/g, '');
  if (!loja) return;
  var form = document.querySelector('form');
  var hid = document.createElement('input');
  hid.type = 'hidden'; hid.name = 'loja'; hid.value = loja;
  form.appendChild(hid);
  form.addEventListener('submit', function () { try { localStorage.setItem('teashop.loja', loja); } catch (x) { /* ok */ } });
  fetch('/marca/' + loja + '.json').then(function (r) { return r.ok ? r.json() : null; }).then(function (m) {
    if (!m) return;
    document.querySelector('.sub').textContent = m.nome;
    document.title = m.nome + ' · Painel';
    if (m.logo) {
      var img = document.createElement('img');
      img.src = '/marca/' + loja + '/logo'; img.alt = m.nome; img.className = 'logo-loja';
      var svg = document.querySelector('.box > svg');
      svg.parentNode.replaceChild(img, svg);
    }
  }).catch(function () {});
})();
