'use strict';
/**
 * Configuração guiada da loja (os 4 acessos que o franqueado cadastra no primeiro uso):
 * AppNext, Sistema de Pedidos, FIXE e o Gmail da loja. O passo 5 (CFOP das notas fiscais) é opcional: sem ele vale o
 * automático, então não conta como pendente (não abre a janela sozinha nem gera lembrete). Aqui fica só a conta de "o que já está pronto";
 * quem grava cada acesso continua sendo a rota de cada um (as mesmas das Configurações).
 * Nunca devolve usuário nem senha: só sim/não.
 */
const PASSOS = ['appnext', 'pedido', 'fixe', 'email'];

/** env = arquivo do coletor da loja (ou null); pedido = PED.acesso(); fechEmail = NOTIF.publicoLoja() */
function situacao({ env, pedido, fechEmail, nfeCfop }) {
  const e = env || {};
  return {
    appnext: !!(e.APPNEXT_USER && e.APPNEXT_PASS),
    pedido: !!(pedido && pedido.usuario && pedido.temSenha),
    fixe: !!(e.FIXE_URL && e.FIXE_USER && e.FIXE_PASS && e.FIXE_EMAIL),
    email: !!(fechEmail && fechEmail.email && fechEmail.email.configurado),
    // opcional: salvo uma vez (mesmo como automático) = pronto
    nfe: !!(nfeCfop && typeof nfeCfop === 'object'),
  };
}
const pendentes = (passos) => PASSOS.filter((p) => !passos[p]);
/** a janela abre sozinha só para o franqueado, só uma vez por loja, e só se faltar algum acesso */
const abreSozinha = (perfil, passos, visto) => perfil === 'franqueado' && !visto && pendentes(passos).length > 0;

const OPCIONAIS = ['nfe'];
module.exports = { PASSOS, OPCIONAIS, situacao, pendentes, abreSozinha };
