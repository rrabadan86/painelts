// botão "Imprimir / salvar em PDF" da página do DANFE (o CSP não deixa script na própria página)
document.addEventListener('DOMContentLoaded', () => { const b = document.getElementById('imprimir'); if (b) b.addEventListener('click', () => window.print()); });
