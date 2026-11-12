(function () {
  var q = new URLSearchParams(location.search);
  var primeiro = q.get('primeiro') === '1';
  if (primeiro) {
    document.getElementById('titulo').textContent = 'Crie a sua senha';
    document.getElementById('sub').textContent = 'Você entrou com uma senha provisória. Para continuar, escolha uma senha só sua.';
    document.getElementById('rotAtual').textContent = 'Senha provisória (a que você recebeu)';
  } else {
    document.getElementById('voltar').hidden = false;
  }
  var msgs = {
    atual: primeiro ? 'A senha provisória não confere.' : 'A senha atual não confere.',
    curta: 'A nova senha precisa ter pelo menos 8 caracteres.',
    confirma: 'As duas senhas novas não são iguais.',
    igual: 'A nova senha precisa ser diferente da atual.',
    'usuario-na-senha': 'A senha não pode conter o seu nome de usuário.',
    limite: 'Muitas tentativas. Aguarde 15 minutos e tente de novo.',
    usuario: 'Este acesso não permite trocar a senha por aqui.',
  };
  var e = q.get('e');
  if (e) { var p = document.getElementById('err'); p.textContent = msgs[e] || 'Não foi possível trocar a senha.'; p.hidden = false; }
  var nova = document.getElementById('nova'), conf = document.getElementById('confirma');
  function conferir() {
    document.getElementById('r-tam').className = nova.value.length >= 8 ? 'ok' : '';
    document.getElementById('r-igual').className = nova.value && nova.value === conf.value ? 'ok' : '';
  }
  nova.addEventListener('input', conferir); conf.addEventListener('input', conferir);
  document.getElementById('form').addEventListener('submit', function (ev) {
    if (nova.value !== conf.value) { ev.preventDefault(); var p = document.getElementById('err'); p.textContent = msgs.confirma; p.hidden = false; }
  });
})();
