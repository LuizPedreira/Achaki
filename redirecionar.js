const producao = 'https://achaki.jrsites.online';
const url = new URL(location.href);
const secao = url.hash.slice(1).replace(/^\//, '');
const rotas = new Map([
  ['login', '/entrar'],
  ['register', '/cadastro'],
  ['forgot', '/recuperar-senha'],
  ['found', '/novo/found'],
  ['lost', '/novo/lost'],
  ['records', '/meus-registros'],
  ['profile', '/perfil'],
  ['admin-dashboard', '/painel'],
  ['admin-found', '/painel/encontrados'],
  ['admin-lost', '/painel/perdidos'],
  ['admin-history', '/painel/historico'],
  ['admin-users', '/painel/usuarios'],
  ['admin-settings', '/painel/configuracoes']
]);

if (url.searchParams.get('prototipo') === '1' || /^(detail|rating)\//.test(secao)) {
  const prototipo = new URL('/Achaki/prototipo.html', url);
  prototipo.hash = url.hash;
  location.replace(prototipo.href);
} else {
  location.replace(producao + (rotas.get(secao) || '/'));
}
