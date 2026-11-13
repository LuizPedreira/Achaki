import { icon } from './icons.js';

const site = document.querySelector('#site');
const dialog = document.querySelector('#dialog');
const toast = document.querySelector('#toast');
const session = { user: null, categories: [], locations: [], sector: {}, features: {} };
const statusText = { open: 'Em aberto', reserved: 'Reservado', returned: 'Devolvido', recovered: 'Recuperado',
  pending: 'Pendente', approved: 'Aprovada', rejected: 'Recusada', cancelled: 'Cancelada', delivered: 'Entregue' };
const custodyText = { campus: 'No setor da Fatec', finder: 'Com quem encontrou' };
const publicationText = { public: 'Publicado', pending: 'Em revisão', hidden: 'Oculto', private: 'Privado' };
const kindText = { found: 'Encontrado', lost: 'Perdido' };
const clock = new Intl.DateTimeFormat('sv-SE', { timeZone: 'America/Sao_Paulo' });
const niceDate = value => value ? value.slice(0, 10).split('-').reverse().join('/') : '—';
const today = () => clock.format(new Date());
const e = (value = '') => String(value ?? '').replace(/[&<>"']/g, token => ({ '&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;' })[token]);
const initial = name => (name || '?').trim().split(/\s+/).slice(0, 2).map(word => word[0]).join('').toUpperCase();
const qs = (selector, root = document) => root.querySelector(selector);
const selected = (value, expected) => value === expected ? 'selected' : '';
const checked = value => value ? 'checked' : '';
const actions = Object.create(null);
let navigation = 0;
let toastTimer;
let previousFocus;
let photoDraft = null;
let installPrompt;

async function api(path, { method = 'GET', body, headers = {} } = {}) {
  if (body instanceof Blob) headers['Content-Type'] = body.type;
  else if (body !== undefined) {
    headers['Content-Type'] = 'application/json';
    body = JSON.stringify(body);
  }
  let response;
  try {
    response = await fetch(`/api${path}`, { method, body, headers, credentials: 'same-origin' });
  } catch (error) {
    if (error.name === 'AbortError') throw error;
    throw new Error('Sem conexão com o Achaki. Confira sua internet e tente novamente.');
  }
  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw Object.assign(new Error(data.error || 'O Achaki está temporariamente indisponível.'), { status: response.status });
  return data;
}

async function refreshSession() {
  Object.assign(session, await api('/meta'));
}

function notify(message) {
  toast.textContent = message;
  toast.classList.add('visible');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => toast.classList.remove('visible'), 4200);
}

function go(path, { replace = false, keepScroll = false } = {}) {
  if (dialog.open) dialog.close();
  if (location.pathname + location.search !== path || location.hash) history[replace ? 'replaceState' : 'pushState'](null, '', path);
  if (!keepScroll) window.scrollTo(0, 0);
  void render().then(() => {
    if (!keepScroll) qs('#conteudo')?.focus({ preventScroll:true });
  });
}

const link = (href, label, { cls = 'button secondary', symbol = '', attrs = '' } = {}) =>
  `<a href="${e(href)}" class="${cls}" data-nav ${attrs}>${symbol ? icon(symbol) : ''}${label}</a>`;
const btn = (action, label, symbol = '', cls = 'secondary', attrs = '') =>
  `<button type="button" class="button ${cls}" data-action="${action}" ${attrs}>${symbol ? icon(symbol) : ''}${label}</button>`;
const submit = (label, symbol = '') => `<button class="button primary" type="submit">${symbol ? icon(symbol) : ''}${label}</button>`;
const badge = (value, label = statusText[value] || publicationText[value] || value) => `<span class="badge ${e(value)}"><i></i>${e(label)}</span>`;
const rowInfo = (symbol, label) => `<span class="small-info">${icon(symbol)}${e(label)}</span>`;
const empty = (title, text, action = '', symbol = 'box') =>
  `<div class="empty"><span class="empty-icon">${icon(symbol)}</span><h3>${e(title)}</h3>${text ? `<p>${e(text)}</p>` : ''}${action}</div>`;
const input = (label, name, value = '', attrs = '') => `<label>${label}<input name="${name}" value="${e(value)}" ${attrs}></label>`;
const textarea = (label, name, value = '', attrs = '') => `<label>${label}<textarea name="${name}" ${attrs}>${e(value)}</textarea></label>`;
const select = (label, name, options, value, attrs = '') => `<label>${label}<select name="${name}" ${attrs}>${options.map(([key,text]) =>
  `<option value="${e(key)}" ${selected(value,key)}>${e(text)}</option>`).join('')}</select></label>`;
const categoryOptions = (firstLabel = 'Selecione') => [['', firstLabel], ...session.categories.map(category => [category.id,category.name])];
const locationOptions = () => session.locations.map(location => `<option value="${e(location.name)}"></option>`).join('');
const displayStatus = (values = ['open','reserved','returned']) => values.map(value => [value,statusText[value]]);
const itemHref = id => `/item/${encodeURIComponent(id)}`;
const entry = (path, name, symbol) => `<a href="${path}" data-nav ${location.pathname === path ? 'aria-current="page"' : ''}>${icon(symbol)}<span>${name}</span></a>`;

function brand() {
  return `<a class="brand" href="/" data-nav aria-label="Achaki, início"><span class="brand-mark">${icon('target')}</span><span>achaki<span class="brand-point">.</span><small>FATEC TAQUARITINGA</small></span></a>`;
}

function shell(content, { wide = false, auth = false } = {}) {
  const user = session.user;
  const profile = user ? `<a class="profile-link" data-nav href="/perfil"><span class="avatar">${e(initial(user.name))}</span><span>${e(user.name.split(' ')[0])}</span></a>`
    : link('/entrar','Entrar',{ cls:'button secondary sign-in',symbol:'user' });
  return `<header class="header"><div class="header-inner">${brand()}<nav class="top-nav" aria-label="Principal">
    ${entry('/','Explorar','search')}${user ? entry('/meus-registros','Meus registros','list') : ''}${entry('/ajuda','Como funciona','help')}
    ${user?.role === 'admin' ? entry('/painel','Painel','dashboard') : ''}</nav>
    <div class="header-actions">${profile}${auth ? '' : link('/novo','Registrar item',{ cls:'button primary header-cta',symbol:'plus' })}</div></div></header>
    <main id="conteudo" tabindex="-1" class="${wide ? 'main admin-main' : 'main'}">${content}</main>
    <footer class="footer"><div><span class="footer-brand">Achaki<span>.</span></span><small>Projeto acadêmico · Fatec Taquaritinga</small></div>
      <div>${link('/ajuda','Como funciona',{ cls:'text-link' })}<button type="button" class="text-link install-link" data-action="install" ${installPrompt ? '' : 'hidden'}>Instalar aplicativo</button></div></footer>
    <nav class="dock" aria-label="Navegação móvel">${entry('/','Explorar','search')}${entry('/novo','Registrar','plus')}
    ${entry('/meus-registros','Registros','list')}${user?.role === 'admin' ? entry('/painel','Painel','dashboard') : entry(user ? '/perfil' : '/entrar','Conta','user')}</nav>`;
}

function header(title, description, actions = '', kicker = '') {
  return `<div class="page-heading"><div>${kicker ? `<div class="eyebrow">${e(kicker)}</div>` : ''}<h1>${e(title)}</h1>${description ? `<p>${e(description)}</p>` : ''}</div>${actions ? `<div class="heading-actions">${actions}</div>` : ''}</div>`;
}

function modal(title, content, cls = '') {
  if (dialog.open) dialog.close();
  previousFocus = document.activeElement;
  dialog.className = cls;
  dialog.innerHTML = `<div class="dialog-head"><h2 id="dialog-title">${e(title)}</h2>
    ${btn('close','', 'x','icon-button','aria-label="Fechar"')}</div><div class="dialog-body">${content}</div>`;
  dialog.showModal();
}

dialog.addEventListener('close', () => { if (previousFocus?.isConnected) previousFocus.focus(); });
dialog.addEventListener('click', event => { if (event.target === dialog) dialog.close(); });
actions.close = () => dialog.close();

function confirmAction(title, body, work, label = 'Confirmar') {
  modal(title, `<p>${e(body)}</p><form class="stack" id="confirm-form"><div class="form-error" role="alert"></div>
    <div class="form-actions">${btn('close','Voltar')}${submit(label)}</div></form>`);
  onForm('#confirm-form', work);
}

function onForm(selector, work) {
  const form = qs(selector);
  if (!form) return;
  form.addEventListener('submit', async event => {
    event.preventDefault();
    const error = qs('.form-error', form);
    const button = qs('[type=submit]',form);
    if (error) error.textContent = '';
    if (button) button.disabled = true;
    try {
      await work(Object.fromEntries(new FormData(form)), form);
    } catch (failure) {
      if (error) error.textContent = failure.message;
      else notify(failure.message);
    } finally {
      if (button) button.disabled = false;
    }
  });
}

function withQuery(path, key, value) {
  const url = new URL(path, location.origin);
  if (value) url.searchParams.set(key, value);
  else url.searchParams.delete(key);
  if (key !== 'page') url.searchParams.delete('page');
  return url.pathname + url.search;
}

function pager(path, data) {
  const last = Math.max(1, Math.ceil(data.total / data.perPage));
  if (last <= 1 && data.page <= 1) return '';
  return `<nav class="pagination" aria-label="Paginação">
    ${data.page > 1 ? link(withQuery(path,'page',data.page - 1),'Anterior',{ symbol:'back' }) : '<span></span>'}
    <span>Página ${data.page} de ${last}</span>${data.page < last ? link(withQuery(path,'page',data.page + 1),'Próxima',{ symbol:'chev' }) : '<span></span>'}</nav>`;
}

const illustrations = { eletronicos:'phone', documentos:'list', acessorios:'tag', 'material-escolar':'edit', roupas:'archive', outros:'box' };
function cover(item) {
  return item.photos?.[0] ? `<img src="${e(item.photos[0])}" alt="" loading="lazy" decoding="async">`
    : `<span class="card-art ${e(item.categoryId)}">${icon(illustrations[item.categoryId] || 'box')}</span>`;
}

function card(item) {
  return `<article class="item-card"><a href="${itemHref(item.id)}" class="item-link" data-nav>
    <div class="item-cover">${cover(item)}${badge(item.status)}</div>
    <div class="item-body"><div class="item-category">${e(item.category)}</div><h3>${e(item.title)}</h3>
    <p>${e(item.description)}</p><div class="item-meta">${rowInfo('pin',item.location || 'Local não informado')}${rowInfo('calendar',niceDate(item.occurredOn))}</div>
    <div class="item-bottom"><span>Ver detalhes</span>${icon('arrow')}</div></div></a></article>`;
}

function homeSkeleton() {
  return `<div class="hero"><div class="hero-content"><div class="hero-kicker"><span></span> Achados e Perdidos do campus</div>
  <h1>Perdeu alguma coisa<span>?</span></h1><p>Confira o que apareceu pelo campus ou registre um objeto que você encontrou.</p>
  <form id="search-form" class="search-form" role="search">${icon('search')}<input name="q" value="${e(new URLSearchParams(location.search).get('q'))}" aria-label="Buscar objetos" placeholder="Busque por carteira, chave, fone…"
    maxlength="120"><button type="submit" class="button primary">Buscar</button></form>
  <div class="hero-actions">${link('/novo/found','Encontrei um item',{ cls:'button dark',symbol:'plus' })}${link('/novo/lost','Registrar uma perda',{ cls:'button hero-outline',symbol:'target' })}</div></div>
  <div class="hero-graphic" aria-hidden="true"><div class="orbit orbit-one"></div><div class="orbit orbit-two"></div><div class="orbit orbit-three"></div>
  <div class="graphic-box">${icon('box')}</div><div class="graphic-pin">${icon('pin')}</div><div class="graphic-star">${icon('spark')}</div></div></div>`;
}

async function home(url, token) {
  const data = await api(`/items${url.search}`);
  if (token !== navigation) return;
  const category = url.searchParams.get('category') || '';
  const otherFilters = ['status','location','from','to'].filter(key => url.searchParams.has(key)).length;
  const chips = [['','Todos os itens'], ...session.categories.map(cat => [cat.id,cat.name])].map(([value,label]) =>
    link(withQuery(url.pathname + url.search,'category',value),e(label),{ cls:`chip ${value === category ? 'on' : ''}`,attrs:value === category ? 'aria-current="true"' : '' })).join('');
  site.innerHTML = shell(`${homeSkeleton()}<section class="results" aria-labelledby="results-heading">
    <div class="section-head"><div><h2 id="results-heading">Itens encontrados</h2><p>${data.total === 1 ? '1 objeto encontrado' : `${data.total} objetos encontrados`}</p></div>
    ${btn('filters',`Filtros${otherFilters ? ` <span class="count">${otherFilters}</span>` : ''}`,'filter')}</div>
    <div class="chips" aria-label="Categorias">${chips}</div>
    ${data.items.length ? `<div class="item-grid">${data.items.map(card).join('')}</div>${pager(url.pathname + url.search,data)}`
      : empty('Nenhum item por aqui',url.search ? 'Tente outro termo ou ajuste os filtros da busca.' : 'Os objetos encontrados no campus vão aparecer aqui.',
        url.search ? link('/','Limpar busca') : link('/novo/found','Registrar um item',{ cls:'button primary',symbol:'plus' }),'search')}</section>`);
  onForm('#search-form', ({ q }) => {
    go(withQuery(url.pathname + url.search, 'q', q.trim()), { keepScroll: true });
  });
}

actions.filters = () => {
  const params = new URLSearchParams(location.search);
  modal('Filtrar itens', `<form class="stack" id="filters-form">
    ${select('Status','status',[['','Todos os status'], ...displayStatus()],params.get('status') || '')}
    ${input('Local','location',params.get('location'),'list="locations" placeholder="Ex.: Biblioteca" maxlength="120"')}<datalist id="locations">${locationOptions()}</datalist>
    <div class="form-grid">${input('A partir de','from',params.get('from'),`type="date" max="${today()}"`)}
    ${input('Até','to',params.get('to'),`type="date" max="${today()}"`)}</div>
    <div class="form-error" role="alert"></div><div class="form-actions">${link('/','Limpar filtros')}${submit('Aplicar filtros')}</div></form>`);
  onForm('#filters-form', data => {
    if (data.from && data.to && data.from > data.to) throw new Error('A data inicial precisa vir antes da data final.');
    let path = location.pathname + location.search;
    for (const [key,value] of Object.entries(data)) path = withQuery(path,key,value);
    go(path,{ keepScroll:true });
  });
};

const nextQS = path => `/entrar?next=${encodeURIComponent(path)}`;
function needUser(path) {
  if (session.user) return true;
  go(nextQS(path), { replace: true });
  return false;
}

function authNext(url) {
  const next = url.searchParams.get('next');
  return next && /^\/(?:item\/[a-f0-9-]{36}|novo(?:\/(?:found|lost))?|meus-registros|perfil|configurar-admin|painel(?:\/[a-z]+)?)$/.test(next) ? next : '';
}

function authPage(path, url) {
  const next = authNext(url);
  const target = next ? `?next=${encodeURIComponent(next)}` : '';
  const authTypes = {
    '/entrar': ['Entrar no Achaki','Acompanhe seus registros e solicitações.','Entrar'],
    '/cadastro': ['Criar sua conta','Cadastre-se para registrar objetos e solicitar a devolução.','Criar conta'],
    '/recuperar-senha': ['Recuperar senha','Informe o e-mail da conta para receber um link de redefinição.','Enviar link'],
    '/redefinir-senha': ['Escolher nova senha','Use uma senha com pelo menos 10 caracteres.','Salvar nova senha']
  };
  const [title, description, verb] = authTypes[path];
  const login = path === '/entrar';
  const register = path === '/cadastro';
  const forgot = path === '/recuperar-senha';
  const reset = path === '/redefinir-senha';
  const unavailable = forgot && !session.features.reset;
  const institutional = url.searchParams.get('institucional');
  const institutionMessage = institutional === 'vinculado' ? 'Esta conta institucional já está vinculada.' : institutional === 'falhou' ? 'Não foi possível entrar com a conta institucional. Tente novamente.' : '';
  site.innerHTML = shell(`<section class="auth-wrap"><div class="auth-side"><span class="auth-icon">${icon(login || register ? 'target' : 'lock')}</span>
    <span class="eyebrow">Fatec Taquaritinga</span><h2>Uma conta.<br>Seus objetos e registros.</h2><p>Acompanhe em um só lugar o que você perdeu, encontrou ou recuperou no campus.</p></div>
    <div class="auth-form panel"><div class="form-heading"><h1>${title}</h1><p>${description}</p></div>
    ${unavailable ? `<div class="notice">A recuperação automática por e-mail ainda não está disponível. Procure o setor de Achados e Perdidos.</div>${link('/entrar','Voltar para o login')}` :
    `<form class="stack" id="auth-form">${register ? input('Nome completo','name','','required minlength="2" maxlength="90" autocomplete="name"') : ''}
      ${!reset ? input('E-mail','email','','type="email" required maxlength="254" autocomplete="username" placeholder="voce@exemplo.com"') : ''}
      ${register ? input('Telefone com DDD','phone','','type="tel" required minlength="10" maxlength="26" autocomplete="tel" placeholder="(16) 99999-9999"') : ''}
      ${!forgot ? input('Senha','password','',`type="password" required ${login ? '' : 'minlength="10"'} maxlength="128" autocomplete="${login ? 'current-password' : 'new-password'}"`) : ''}
      ${register || reset ? input('Confirmar senha','confirm','', 'type="password" required minlength="10" maxlength="128" autocomplete="new-password"') : ''}
      ${login ? `<div class="auth-options"><label class="check"><input type="checkbox" name="remember">Manter conectado</label>
        ${link('/recuperar-senha','Esqueci a senha',{ cls:'text-link' })}</div>` : ''}
      <div class="form-error" role="alert">${e(institutionMessage)}</div>${submit(verb,'arrow')}</form>`}
    ${login && session.features.sso ? `<a href="/api/auth/microsoft?next=${encodeURIComponent(next || '/')}" class="button secondary institutional">${icon('building')}Entrar com a conta institucional</a>` : ''}
    <p class="auth-bottom">${login ? 'Não tem conta? ' + link(`/cadastro${target}`,'Criar conta',{ cls:'text-link' }) :
      register ? 'Já tem conta? ' + link(`/entrar${target}`,'Entrar',{ cls:'text-link' }) : ''}</p></div></section>`,{ auth:true });
  onForm('#auth-form', async (data, form) => {
    if ((register || reset) && data.password !== data.confirm) throw new Error('As senhas precisam ser iguais.');
    if (forgot) {
      await api('/auth/forgot',{ method:'POST',body:data });
      form.innerHTML = `<div class="notice success">Se o e-mail estiver cadastrado, você receberá um link para trocar a senha.</div>${link('/entrar','Voltar para o login')}`;
      return;
    }
    if (reset) {
      await api('/auth/reset',{ method:'POST',body:{ token:location.hash.slice(1),password:data.password } });
      session.user = null;
      notify('Senha alterada. Entre com a nova senha.');
      go('/entrar',{ replace:true });
      return;
    }
    const result = await api(login ? '/auth/login' : '/auth/register',{ method:'POST',body:{ ...data,remember:data.remember === 'on' } });
    session.user = result.user;
    notify(register ? 'Conta criada.' : `Olá, ${result.user.name.split(' ')[0]}!`);
    go(next || (result.user.role === 'admin' ? '/painel' : '/'),{ replace:true });
  });
}

async function detail(itemId, token) {
  const { item } = await api(`/items/${itemId}`);
  if (token !== navigation) return;
  const own = item.isMine;
  const active = ['open','reserved'].includes(item.status);
  const photoList = item.photos.map((src,index) => `<button type="button" class="thumb" data-action="gallery" data-index="${index}" aria-label="Ampliar foto ${index + 1}"><img src="${e(src)}" alt=""></button>`).join('');
  const status = item.request?.status;
  let action = '';
  if (item.kind === 'found' && active && !own) {
    if (status === 'pending' || status === 'approved') action = link('/meus-registros?aba=contatos','Acompanhar solicitação',{ cls:'button primary',symbol:'bell' });
    else if (session.user) action = btn('claim','Acho que este item é meu','target','primary');
    else action = link(nextQS(itemHref(item.id)),'Entrar para solicitar contato',{ cls:'button primary',symbol:'lock' });
  }
  if (own || item.canRate) action += link('/meus-registros','Ver meus registros',{ cls:'button secondary',symbol:'list' });
  if (item.canRate && !item.rating) action += btn('rate-current','Avaliar devolução','star','secondary');
  if (item.canManage && active) action += btn('qr-current','Gerar etiqueta QR','qr','secondary');
  site.innerHTML = shell(`<div class="back-row">${link(item.kind === 'lost' ? '/meus-registros' : '/',item.kind === 'lost' ? 'Meus registros' : 'Voltar aos itens',{ cls:'text-link',symbol:'back' })}</div>
    <div class="detail-grid"><div class="gallery panel"><div class="gallery-main ${item.photos[0] ? '' : 'no-picture'}">
    ${item.photos[0] ? `<button type="button" data-action="gallery" data-index="0" aria-label="Ampliar foto do objeto"><img src="${e(item.photos[0])}" alt="${e(item.title)}"></button>` : cover(item)}</div>
    ${item.photos.length > 1 ? `<div class="thumbnails">${photoList}</div>` : ''}</div>
    <section class="detail-content"><div class="detail-tags"><span class="item-category">${e(item.category)}</span>${badge(item.status)}</div>
    <h1>${e(item.title)}</h1><p class="description">${e(item.description)}</p>
    <dl class="details-list"><div><dt>${icon('pin')} Local</dt><dd>${e(item.location || 'Não informado')}</dd></div>
      <div><dt>${icon('calendar')} ${item.kind === 'found' ? 'Encontrado em' : 'Perdido por volta de'}</dt><dd>${niceDate(item.occurredOn)}</dd></div>
      ${item.custody ? `<div><dt>${icon('box')} Guarda</dt><dd>${e(custodyText[item.custody])}</dd></div>` : ''}
      ${item.returnedOn ? `<div><dt>${icon('check')} Devolução</dt><dd>${niceDate(item.returnedOn)}</dd></div>` : ''}</dl>
    <div class="detail-actions">${action}${btn('share','Compartilhar','share','secondary')}</div>
    ${item.kind === 'found' && active && !own && !status ? '<p class="hint">Informe uma característica que só a pessoa dona do objeto saberia. O responsável revisará seu pedido.</p>' : ''}</section></div>`);
  actions.gallery = button => showGallery(item,Number(button.dataset.index));
  actions.claim = () => claim(item);
  actions['rate-current'] = () => rate(item.id);
  actions['qr-current'] = () => qrLabel(item);
}

function showGallery(item, index) {
  modal(item.title, `<div class="lightbox"><img id="light-photo" src="${e(item.photos[index])}" alt="${e(item.title)}">
    ${item.photos.length > 1 ? `<div class="gallery-steps">${btn('gallery-prev','Anterior','back')}<span id="photo-count"></span>${btn('gallery-next','Próxima','chev')}</div>` : ''}</div>`,'wide-dialog');
  function move(delta) {
    index = (index + delta + item.photos.length) % item.photos.length;
    qs('#light-photo').src = item.photos[index];
    if (qs('#photo-count')) qs('#photo-count').textContent = `${index + 1} de ${item.photos.length}`;
  }
  actions['gallery-prev'] = () => move(-1);
  actions['gallery-next'] = () => move(1);
  dialog.onkeydown = event => {
    if (event.key === 'ArrowLeft') move(-1);
    if (event.key === 'ArrowRight') move(1);
  };
  dialog.addEventListener('close', () => { dialog.onkeydown = null; }, { once:true });
  move(0);
}

actions.share = async () => {
  if (navigator.share) {
    try { await navigator.share({ title:document.title,url:location.href }); return; }
    catch (error) { if (error.name === 'AbortError') return; }
  }
  try { await navigator.clipboard.writeText(location.href); notify('Link copiado.'); }
  catch { modal('Compartilhar item', `<label>Link do item<input readonly value="${e(location.href)}"></label>`); }
};

function claim(item, lostId) {
  modal('Solicitar devolução', `<p>Descreva um detalhe que ajude a confirmar que “${e(item.title)}” é seu.</p>
    <form class="stack" id="claim-form">${textarea('Como reconhecer seu objeto?','message','','required minlength="10" maxlength="700" rows="4" placeholder="Ex.: detalhe da capa, marca de uso ou conteúdo…"')}
    <div class="form-error" role="alert"></div><div class="form-actions">${btn('close','Voltar')}${submit('Enviar solicitação','arrow')}</div></form>`);
  onForm('#claim-form', async data => {
    await api(`/items/${item.id}/contact`,{ method:'POST',body:{ ...data,lostId } });
    notify('Solicitação enviada.');
    go('/meus-registros?aba=contatos');
  });
}

async function qrLabel(item) {
  const { default: QR } = await import('./vendor/qr-creator.js');
  modal('Etiqueta do objeto', `<div class="qr-label"><strong>Achaki · Fatec Taquaritinga</strong><p>${e(item.title)}</p>
    <div id="qr-code" aria-label="QR Code para consultar o item"></div><small>${e(item.id.slice(0,8).toUpperCase())}</small></div>
    <div class="form-actions">${btn('qr-download','Baixar etiqueta','download','primary')}</div>`);
  QR.render({ text:new URL(itemHref(item.id),location.origin).href,radius:0,ecLevel:'M',fill:'#151515',background:'#ffffff',size:240 },qs('#qr-code'));
  actions['qr-download'] = () => {
    const code = qs('#qr-code canvas');
    const label = document.createElement('canvas');
    label.width = 320; label.height = 365;
    const ctx = label.getContext('2d');
    ctx.fillStyle = '#fff'; ctx.fillRect(0,0,320,365);
    ctx.textAlign = 'center'; ctx.fillStyle = '#171615'; ctx.font = 'bold 17px sans-serif';
    ctx.fillText('ACHAKI · FATEC',160,36);
    ctx.font = '14px sans-serif'; ctx.fillText(item.title,160,63,275);
    ctx.drawImage(code,40,79);
    ctx.font = '13px monospace'; ctx.fillText(item.id.slice(0,8).toUpperCase(),160,339);
    const a = document.createElement('a');
    a.href = label.toDataURL('image/png'); a.download = `achaki-${item.id.slice(0,8)}.png`; a.click();
  };
}

function newChoice() {
  site.innerHTML = shell(`${header('Registrar um objeto','Escolha o que aconteceu.')}
    <div class="choice-grid"><a class="choice-card panel" href="/novo/found" data-nav><span class="choice-icon">${icon('box')}</span><div><h2>Encontrei um item</h2><p>Publique uma foto e informe onde o objeto está guardado.</p></div>${icon('arrow')}</a>
    <a class="choice-card panel" href="/novo/lost" data-nav><span class="choice-icon">${icon('target')}</span><div><h2>Perdi um item</h2><p>Registre a perda e acompanhe os objetos que podem corresponder.</p></div>${icon('arrow')}</a></div>`);
}

function itemFields(kind, data = {}, categories = session.categories) {
  const found = kind === 'found';
  return `${input('Nome do objeto','title',data.title,'required minlength="3" maxlength="90" placeholder="Ex.: Estojo azul"')}
    ${textarea('Descrição','description',data.description,'required minlength="8" maxlength="1200" rows="4" placeholder="Descreva as características visíveis do objeto."')}
    <div class="form-grid">${select('Categoria','categoryId',[['','Selecione'],...categories.map(c => [c.id,c.name])],data.categoryId,'required')}
    ${input(found ? 'Data em que encontrou' : 'Data aproximada da perda','occurredOn',data.occurredOn || today(),`type="date" max="${today()}" required`)}</div>
    ${input(found ? 'Local onde encontrou' : 'Local da perda (opcional)','location',data.location,`list="item-locations" maxlength="120" ${found ? 'required minlength="2"' : ''} placeholder="Ex.: Biblioteca"`)}
    <datalist id="item-locations">${locationOptions()}</datalist>`;
}

function draftKey(kind) {
  return `achaki_draft:${session.user.id}:${kind}`;
}

function loadDraft(kind) {
  try { return JSON.parse(sessionStorage.getItem(draftKey(kind))) || {}; }
  catch { return {}; }
}

function itemForm(kind) {
  const found = kind === 'found';
  if (!needUser(`/novo/${kind}`)) return;
  if (!session.user.phone) {
    site.innerHTML = shell(empty('Complete seu perfil','Informe seu telefone antes de registrar um objeto.',
      link('/perfil','Editar perfil',{ cls:'button primary' }),'user'));
    return;
  }
  const draft = loadDraft(kind);
  if (!photoDraft || photoDraft.key !== draftKey(kind)) clearPhotoDraft(kind);
  site.innerHTML = shell(`<div class="back-row">${link('/novo','Tipo de registro',{ cls:'text-link',symbol:'back' })}</div>
    ${header(found ? 'Encontrei um item' : 'Registrar uma perda',found
      ? 'Ajude quem perdeu a reconhecer o objeto e encontrar o caminho para recuperá-lo.'
      : 'Guarde os detalhes da perda e consulte itens encontrados que podem corresponder.')}
    <div class="edit-grid"><form class="panel editor stack" id="item-form"><div class="form-heading"><h2>Informações do objeto</h2><p>${found ? 'A foto e o local ajudam a reconhecer o item.' : 'Você pode incluir uma foto para facilitar a identificação.'}</p></div>
      <section class="upload-section"><div class="field-title">${found ? 'Fotos do item' : 'Fotos opcionais'} <span id="photo-total"></span></div>
      <div class="photo-previews" id="photo-previews"></div><div class="upload-actions">
        <label class="button secondary upload-button">${icon('image')}Adicionar foto<input type="file" id="photo-files" accept="image/*" multiple></label>
        <label class="button secondary upload-button">${icon('camera')}Usar câmera<input type="file" id="photo-camera" accept="image/*" capture="environment"></label></div>
      ${session.features.suggestions ? `<div class="suggest"><button type="button" class="text-link" data-action="suggest">${icon('spark')}Sugerir categoria pela foto</button></div>` : ''}
      <p class="hint">${found ? 'De uma a três fotos.' : 'Até três fotos.'} Evite mostrar documentos, números ou rostos.</p></section>
      ${itemFields(kind,draft)}
      ${found ? `<fieldset class="custody"><legend>Com quem o item está?</legend>
        <label class="choice-option"><input type="radio" name="custody" value="finder" ${checked(draft.custody !== 'campus')}>${icon('user')}<span><b>Está comigo</b><small>Eu combino a entrega pelo Achaki.</small></span></label>
        <label class="choice-option"><input type="radio" name="custody" value="campus" ${checked(draft.custody === 'campus')}>${icon('building')}<span><b>Entreguei na Fatec</b><small>O setor confirma a retirada.</small></span></label></fieldset>` :
        `<label class="check"><input type="checkbox" name="sharePhone" ${checked(draft.sharePhone)}>Compartilhar meu WhatsApp com o setor para tratar desta perda</label>`}
      <div class="form-error" role="alert"></div><div class="form-actions">${link('/novo','Voltar')}${submit(found ? 'Publicar item' : 'Registrar perda','arrow')}</div></form>
    <aside class="panel side-note"><span class="choice-icon">${icon(found ? 'shield' : 'target')}</span><h2>${found ? 'Foto e descrição' : 'Como recuperar'}</h2>
    <p>${found ? 'Mostre o suficiente para a pessoa reconhecer o objeto. Guarde algum detalhe para confirmar a identificação na hora da entrega.'
      : 'As perdas ficam nos seus registros. Se um item encontrado parecer seu, você pode vincular os dois ao solicitar a devolução.'}</p>
    ${link('/ajuda','Entenda o processo',{ cls:'text-link',symbol:'arrow' })}</aside></div>`);
  drawPhotos();
  const form = qs('#item-form');
  form.addEventListener('input', event => {
    if (event.target.type === 'file') return;
    try { sessionStorage.setItem(draftKey(kind),JSON.stringify(Object.fromEntries(new FormData(form)))); } catch {}
  });
  for (const key of ['photo-files','photo-camera']) qs(`#${key}`).addEventListener('change', event => void acceptPhotos(event.target));
  onForm('#item-form', async data => {
    const formDraft = photoDraft;
    const photos = [...formDraft.photos];
    if (found && !photos.length) throw new Error('Adicione pelo menos uma foto do item.');
    if (formDraft.busy) throw new Error('Aguarde o processamento da foto.');
    formDraft.busy = true;
    drawPhotos();
    let response;
    try {
      const ids = [];
      for (const photo of photos) {
        if (!photo.id) photo.id = (await api('/media',{ method:'POST',body:photo.blob })).id;
        ids.push(photo.id);
      }
      response = await api('/items',{ method:'POST',body:{ ...data,kind,photos:ids,sharePhone:data.sharePhone === 'on' } });
    } catch (error) {
      if (error.message.includes('foto expirou')) for (const photo of photos) photo.id = null;
      throw error;
    } finally {
      formDraft.busy = false;
      drawPhotos();
    }
    try { sessionStorage.removeItem(draftKey(kind)); } catch {}
    clearPhotoDraft();
    notify(found ? (response.item.publication === 'pending' ? 'Item enviado para revisão.' : 'Item publicado.') : 'Perda registrada.');
    go(itemHref(response.item.id));
  });
}

function clearPhotoDraft(kind) {
  for (const photo of photoDraft?.photos || []) URL.revokeObjectURL(photo.url);
  photoDraft = kind ? { key:draftKey(kind),photos:[],busy:false } : null;
}

function drawPhotos() {
  const preview = qs('#photo-previews');
  if (!preview || !photoDraft) return;
  qs('#photo-total').textContent = `${photoDraft.photos.length}/3`;
  preview.innerHTML = photoDraft.photos.map((photo,index) =>
    `<div class="photo-preview"><img src="${e(photo.url)}" alt="Foto ${index + 1}">
    ${btn('remove-photo','', 'x','icon-button',`aria-label="Remover foto ${index + 1}" data-index="${index}" ${photoDraft.busy ? 'disabled' : ''}`)}</div>`).join('');
  document.querySelectorAll('#photo-files,#photo-camera').forEach(input => { input.disabled = photoDraft.busy || photoDraft.photos.length >= 3; });
}

actions['remove-photo'] = button => {
  const [removed] = photoDraft.photos.splice(Number(button.dataset.index),1);
  if (removed) URL.revokeObjectURL(removed.url);
  drawPhotos();
};

async function compress(photo, maxSide = 1200, maxBytes = 480_000) {
  if (!photo.type.startsWith('image/') || photo.type === 'image/svg+xml' || photo.size > 20_000_000) {
    throw new Error('Escolha uma foto com até 20 MB.');
  }
  const blobUrl = URL.createObjectURL(photo);
  try {
    const image = new Image();
    image.src = blobUrl;
    await image.decode();
    if (!image.naturalWidth || !image.naturalHeight) throw new Error('Formato inválido');
    const scale = Math.min(1,maxSide / Math.max(image.naturalWidth,image.naturalHeight));
    const canvas = document.createElement('canvas');
    canvas.width = Math.max(1,Math.round(image.naturalWidth * scale));
    canvas.height = Math.max(1,Math.round(image.naturalHeight * scale));
    const ctx = canvas.getContext('2d');
    ctx.fillStyle = 'white'; ctx.fillRect(0,0,canvas.width,canvas.height);
    ctx.drawImage(image,0,0,canvas.width,canvas.height);
    for (const quality of [0.84,0.72,0.58,0.43]) {
      const image = await new Promise(resolve => canvas.toBlob(resolve,'image/jpeg',quality));
      if (image && image.size <= maxBytes) return image;
    }
  } catch {
    throw new Error('Não foi possível abrir a foto. Tente um arquivo JPG, PNG ou WebP.');
  } finally {
    URL.revokeObjectURL(blobUrl);
  }
  throw new Error('Use uma foto menor ou com menos detalhes.');
}

async function acceptPhotos(input) {
  const draft = photoDraft;
  if (!draft || draft.busy) return;
  const photos = Array.from(input.files);
  input.value = '';
  const available = 3 - draft.photos.length;
  if (photos.length > available) notify('São permitidas até três fotos.');
  draft.busy = true;
  drawPhotos();
  try {
    for (const file of photos.slice(0,available)) {
      const blob = await compress(file);
      if (draft !== photoDraft) break;
      draft.photos.push({ blob, url:URL.createObjectURL(blob), id:null });
    }
  } catch (error) {
    notify(error.message);
  } finally {
    draft.busy = false;
    drawPhotos();
  }
}

actions.suggest = async button => {
  const firstPhoto = photoDraft?.photos[0];
  if (!firstPhoto) return notify('Adicione uma foto antes de pedir uma sugestão.');
  button.disabled = true;
  try {
    const thumbnail = await compress(firstPhoto.blob,448,100_000);
    const { category } = await api('/media/suggestion',{ method:'POST',body:thumbnail });
    const field = qs('#item-form [name=categoryId]');
    if (category && field) {
      field.value = category.id;
      field.dispatchEvent(new Event('input',{ bubbles:true }));
      notify(`Sugestão: ${category.name}. Você pode ajustar a categoria.`);
    } else notify('Escolha a categoria manualmente para esta foto.');
  } finally { button.disabled = false; }
};

function tabs(items, active) {
  return `<nav class="tabs" aria-label="Seções">${items.map(([url,text,key]) =>
    link(url,text,{ cls:`tab ${key === active ? 'on' : ''}`,attrs:key === active ? 'aria-current="page"' : '' })).join('')}</nav>`;
}

function recordCard(item) {
  const active = ['open','reserved'].includes(item.status);
  const found = item.kind === 'found';
  const mine = session.user.id === item.authorId;
  const controls = [];
  if (found && active && item.custody === 'finder' && mine) {
    controls.push(btn('transfer','Entreguei na Fatec','building','secondary',`data-id="${item.id}"`));
    controls.push(btn('return-record','Registrar devolução','check','primary',`data-id="${item.id}"`));
  }
  if (!found && active) controls.push(btn('matches','Ver itens compatíveis','search','secondary',`data-id="${item.id}"`));
  if (!found && item.recoveredItemId) controls.push(link(itemHref(item.recoveredItemId),'Ver devolução',{ symbol:'check' }));
  if (found && active && item.custody === 'finder' && mine) controls.push(btn('qr-record','Etiqueta QR','qr','secondary',`data-id="${item.id}"`));
  if (item.contactCount && item.custody === 'finder' && active) controls.push(link('/meus-registros?aba=contatos',`${item.contactCount} solicitaç${item.contactCount === 1 ? 'ão' : 'ões'}`,{ cls:'button secondary',symbol:'bell' }));
  if (found && item.status === 'returned' && !item.finderRating && item.recipientId !== session.user.id) {
    controls.push(btn('rate-record','Avaliar devolução','star','primary',`data-id="${item.id}"`));
  }
  return `<article class="record panel"><a href="${itemHref(item.id)}" data-nav class="record-photo" aria-label="Ver ${e(item.title)}">${cover(item)}</a>
    <div class="record-body"><div class="record-tags">${badge(item.status)}${found && item.publication !== 'public' ? badge(item.publication,publicationText[item.publication]) : ''}
      <span class="item-category">${e(item.category)}</span></div><h3>${link(itemHref(item.id),e(item.title),{ cls:'record-title' })}</h3>
      <div class="inline-meta">${rowInfo('calendar',niceDate(item.occurredOn))}${item.custody ? rowInfo('box',custodyText[item.custody]) : ''}</div>
      ${controls.length ? `<div class="record-actions">${controls.join('')}</div>` : ''}</div></article>`;
}

const recordTabs = [
  ['/meus-registros','Encontrei','found'], ['/meus-registros?aba=perdi','Perdi','lost'],
  ['/meus-registros?aba=contatos','Solicitações','contacts'], ['/meus-registros?aba=avaliacoes','Avaliações','ratings']
];

async function records(url, token) {
  if (!needUser('/meus-registros')) return;
  const tab = { perdi:'lost',contatos:'contacts',avaliacoes:'ratings' }[url.searchParams.get('aba')] || 'found';
  let content;
  let rows = [];
  if (tab === 'contacts') {
    const query = new URLSearchParams({ page:url.searchParams.get('page') || '1' });
    const data = await api(`/contacts?${query}`);
    rows = data.contacts;
    content = contactCards(rows) + pager(url.pathname + url.search,data);
  } else if (tab === 'ratings') {
    const [data, deliveries] = await Promise.all([api('/ratings'),api('/returns')]);
    const pending = deliveries.items.filter(item => !item.rating);
    content = pending.length || data.items.length ? `<div class="stack">
      ${pending.map(item => `<article class="panel simple-row"><div><h3>${e(item.title)}</h3><p>Devolução em ${niceDate(item.returnedOn)} · Avaliação disponível</p></div>
        ${btn('rate-record','Avaliar','star','primary',`data-id="${item.id}"`)}</article>`).join('')}
      ${data.items.map(item => `<article class="panel simple-row"><div><h3>${e(item.title)}</h3><p>${e(item.comment || (item.perspective === 'finder' ? 'Avaliação de quem encontrou' : 'Avaliação de quem recuperou'))}</p></div>
        <strong class="rating-number">${icon('star')} ${item.score}/5</strong></article>`).join('')}</div>`
      : empty('Nenhuma avaliação','Depois de uma devolução, você pode avaliar como foi a entrega.','','star');
  } else {
    const data = await api(`/mine?kind=${tab}&page=${encodeURIComponent(url.searchParams.get('page') || '1')}`);
    rows = data.items;
    content = rows.length ? `<div class="record-list">${rows.map(recordCard).join('')}</div>${pager(url.pathname + url.search,data)}`
      : empty(tab === 'found' ? 'Você ainda não registrou itens encontrados' : 'Você ainda não registrou perdas',
        tab === 'found' ? 'Quando publicar um objeto encontrado, ele aparecerá aqui.' : 'Registre uma perda para consultar objetos compatíveis.',
        link(`/novo/${tab}`,tab === 'found' ? 'Registrar um encontrado' : 'Registrar uma perda',{ cls:'button primary',symbol:'plus' }));
  }
  if (token !== navigation) return;
  site.innerHTML = shell(`${header('Meus registros','Acompanhe seus objetos e o andamento das devoluções.',link('/novo','Registrar item',{ cls:'button primary',symbol:'plus' }))}
    ${tabs(recordTabs,tab)}${content}`);
  actions['qr-record'] = button => qrLabel(rows.find(item => item.id === button.dataset.id));
  actions['return-record'] = button => returnDialog(rows.find(item => item.id === button.dataset.id));
  if (tab === 'contacts') bindContactActions(rows);
}

actions.transfer = button => {
  const item = button.dataset.id;
  confirmAction('Entregou o objeto à Fatec?','O setor ficará responsável por analisar solicitações e registrar a devolução.',
    async () => { await api(`/items/${item}/transfer`,{ method:'POST',body:{} }); notify('Guarda atualizada.'); go(location.pathname + location.search); },'Confirmar entrega ao setor');
};

actions.matches = async button => {
  const lostId = button.dataset.id;
  const { items } = await api(`/items/${lostId}/matches`);
  modal('Itens que podem corresponder', items.length ? `<div class="stack">${items.map(item =>
    `<div class="match-row"><div><strong>${e(item.title)}</strong><p>${e(item.location)} · ${niceDate(item.occurredOn)}</p></div>
    ${btn('claim-match','Solicitar','target','secondary',`data-id="${item.id}"`)}</div>`).join('')}</div>` :
    empty('Nenhum item compatível','Volte mais tarde para conferir novos itens da mesma categoria.','','search'));
  actions['claim-match'] = control => claim(items.find(item => item.id === control.dataset.id),lostId);
};

function contactCards(contacts) {
  if (!contacts.length) return empty('Nenhuma solicitação','Os pedidos que você enviar ou receber aparecerão aqui.','','bell');
  return `<div class="stack">${contacts.map(contact => {
    const received = contact.side === 'received';
    const actions = [
      contact.canApprove && btn('contact-approve','Aprovar e reservar','check','primary',`data-id="${contact.id}"`),
      contact.canDeliver && btn('contact-return','Registrar devolução','check','secondary',`data-id="${contact.id}"`),
      (contact.canReview || contact.canRevoke) && btn('contact-reject','Recusar','x','quiet',`data-id="${contact.id}"`),
      !received && ['pending','approved'].includes(contact.status) && btn('contact-cancel','Cancelar pedido','','quiet',`data-id="${contact.id}"`),
      contact.phone && `<a class="button secondary whatsapp" href="https://wa.me/${e(contact.phone)}" target="_blank" rel="noopener noreferrer">${icon('whatsapp')}WhatsApp</a>`
    ].filter(Boolean).join('');
    return `<article class="contact-card panel"><div class="record-tags">${badge(contact.status)}<span class="item-category">${received ? 'Recebida' : 'Enviada'}</span></div>
      <h3>${link(itemHref(contact.itemId),e(contact.title),{ cls:'record-title' })}</h3><p class="contact-by">${e(contact.requesterName || custodyText[contact.custody])} · ${niceDate(contact.createdAt)}</p>
      <p class="contact-message">${e(contact.message)}</p>
      ${contact.sector ? `<p class="notice">${icon('pin')} ${e(contact.sector.location)}${contact.sector.hours ? ' · ' + e(contact.sector.hours) : ''}</p>` : ''}
      ${contact.status === 'delivered' && !received ? `<div class="record-actions">${link(itemHref(contact.itemId),'Ver devolução',{ symbol:'check' })}</div>` : ''}
      ${actions ? `<div class="record-actions">${actions}</div>` : ''}</article>`;
  }).join('')}</div>`;
}

function bindContactActions(contacts) {
  actions['contact-return'] = button => {
    const contact = contacts.find(row => row.id === button.dataset.id);
    returnDialog({ id:contact.itemId, title:contact.title, recipientName:contact.requesterName }, contact);
  };
  for (const [name,verb,description] of [
    ['approve','Aprovar identificação','O objeto ficará reservado e o contato será liberado para combinar a entrega.'],
    ['reject','Recusar solicitação','O pedido será encerrado. A pessoa pode enviar outro com mais detalhes.'],
    ['cancel','Cancelar solicitação','O pedido será retirado e a reserva será liberada, caso já tenha sido feita.']
  ]) {
    actions[`contact-${name}`] = button => confirmAction(verb,description,async () => {
      await api(`/contacts/${button.dataset.id}`,{ method:'PATCH',body:{ action:name } });
      notify('Solicitação atualizada.');
      go(location.pathname + location.search);
    },verb);
  }
}

function returnDialog(item, contact = null, candidates = []) {
  const linked = contact || item.reservedLostId || item.reservedContactId;
  modal('Registrar devolução', `<p>Confirme a entrega de “${e(item.title)}”.</p><form class="stack" id="return-form">
    ${linked ? `<div class="notice">${icon('user')}${e(contact?.requesterName || item.reservationName || 'Devolução vinculada à reserva')}</div>` :
      `${candidates.length ? select('Vincular perda (opcional)','lostId',[['','Entrega sem vínculo'],...candidates.map(row => [row.id,`${row.title} · ${row.name}`])],'') : ''}
       ${input('Quem recebeu','recipientName',item.reservationName || '', 'maxlength="90" placeholder="Nome da pessoa que recebeu"')}`}
    ${input('Data da devolução','returnedOn',today(),`type="date" max="${today()}" ${item.occurredOn ? `min="${e(item.occurredOn)}"` : ''} required`)}
    ${textarea('Observações (opcional)','notes','','maxlength="700" rows="3"')}
    <div class="form-error" role="alert"></div><div class="form-actions">${btn('close','Voltar')}${submit('Confirmar devolução','check')}</div></form>`);
  onForm('#return-form', async data => {
    await api(`/items/${item.id}/return`,{ method:'POST',body:{ ...data,contactId:contact?.id } });
    notify('Devolução registrada.');
    go(location.pathname + location.search);
  });
}

actions['rate-record'] = button => rate(button.dataset.id);
function rate(id) {
  modal('Avaliar devolução', `<p>Como foi o processo de entrega?</p><form class="stack" id="rating-form">
    <fieldset class="stars"><legend>Sua nota</legend>${[1,2,3,4,5].map(score => `<label><input type="radio" name="score" value="${score}" required>
      <span>${icon('star')} ${score}</span></label>`).join('')}</fieldset>
    ${textarea('Comentário (opcional)','comment','','maxlength="700" rows="3" placeholder="Conte o que funcionou ou o que poderia melhorar."')}
    <div class="form-error" role="alert"></div><div class="form-actions">${btn('close','Voltar')}${submit('Enviar avaliação','star')}</div></form>`);
  onForm('#rating-form', async data => {
    await api(`/items/${id}/rating`,{ method:'POST',body:{ ...data,score:Number(data.score) } });
    notify('Avaliação enviada.');
    go(location.pathname + location.search);
  });
}

function profilePage(url) {
  if (!needUser('/perfil')) return;
  const user = session.user;
  const institutional = url.searchParams.get('institucional');
  site.innerHTML = shell(`${header('Minha conta','Gerencie seus dados e seu acesso ao Achaki.')}
    <div class="edit-grid"><form class="panel editor stack" id="profile-form">
    <div class="profile-heading"><span class="avatar avatar-large">${e(initial(user.name))}</span><div><h2>${e(user.name)}</h2><p>${user.role === 'admin' ? 'Administração' : 'Conta pessoal'}</p></div></div>
    ${institutional === 'novo' ? '<p class="notice">Informe seu telefone para poder registrar um item ou solicitar uma devolução.</p>' : ''}
    ${institutional === 'ok' ? '<p class="notice success">Conta institucional vinculada.</p>' : ''}
    ${input('Nome completo','name',user.name,'required minlength="2" maxlength="90" autocomplete="name"')}
    ${user.email ? input('E-mail de acesso','email',user.email,'type="email" readonly') : ''}
    ${input('Telefone com DDD','phone',user.phone,'type="tel" required minlength="10" maxlength="26" autocomplete="tel" placeholder="(16) 99999-9999"')}
    <div class="form-error" role="alert"></div><div class="form-actions">${submit('Salvar alterações','check')}</div></form>
    <aside class="panel side-note"><span class="choice-icon">${icon('shield')}</span><h2>Acesso à conta</h2>
    ${user.hasPassword ? btn('change-password','Alterar senha','lock') : ''}
    ${session.features.sso && !user.institutional ? '<a class="button secondary" href="/api/auth/microsoft?link=1">Vincular conta institucional</a>' : ''}
    ${user.institutional ? '<p class="hint">Conta institucional vinculada.</p>' : ''}
    ${btn('logout','Sair da conta','logout','quiet')}</aside></div>`);
  onForm('#profile-form',async data => {
    session.user = (await api('/profile',{ method:'PATCH',body:data })).user;
    notify('Dados salvos.');
    go('/perfil',{ replace:true });
  });
}

function firstAdmin() {
  if (!needUser('/configurar-admin')) return;
  site.innerHTML = shell(`${header('Ativar primeira administração','Use a chave de configuração com a conta que vai administrar o Achaki.')}
    <form class="panel editor stack settings-form" id="bootstrap-form">
    ${input('Chave de configuração','token','','type="password" required minlength="32" maxlength="512" autocomplete="off"')}
    <div class="form-error" role="alert"></div><div class="form-actions">${submit('Ativar administração','check')}</div></form>`);
  onForm('#bootstrap-form',async ({ token }) => {
    await api('/bootstrap/admin',{ method:'POST',body:{},headers:{ Authorization:'Bearer ' + token.trim() } });
    await refreshSession();
    notify('Conta administrativa ativada.');
    go('/painel',{ replace:true });
  });
}

actions['change-password'] = () => {
  modal('Alterar senha', `<form class="stack" id="password-form">
    ${input('Senha atual','currentPassword','','type="password" autocomplete="current-password" required maxlength="128"')}
    ${input('Nova senha','password','','type="password" autocomplete="new-password" required minlength="10" maxlength="128"')}
    ${input('Confirmar nova senha','confirm','','type="password" autocomplete="new-password" required minlength="10" maxlength="128"')}
    <div class="form-error" role="alert"></div><div class="form-actions">${btn('close','Voltar')}${submit('Alterar senha','check')}</div></form>`);
  onForm('#password-form', async data => {
    if (data.password !== data.confirm) throw new Error('As senhas precisam ser iguais.');
    await api('/profile/password',{ method:'POST',body:data });
    session.user = null;
    clearPhotoDraft();
    notify('Senha alterada. Entre com a nova senha.');
    go('/entrar');
  });
};

actions.logout = () => confirmAction('Sair da conta?','Você pode entrar novamente para continuar acompanhando seus registros.',async () => {
  await api('/auth/logout',{ method:'POST',body:{} });
  session.user = null;
  clearPhotoDraft();
  go('/');
},'Sair');

function helpPage() {
  site.innerHTML = shell(`${header('Como funciona','Achados e Perdidos da Fatec Taquaritinga.')}
    <div class="help-layout"><section class="panel editor">
    <div class="help-step"><span class="choice-icon">${icon('search')}</span><div><h2>Procure o objeto</h2><p>Explore os encontrados por categoria, data, local ou palavra-chave. Se ainda não o encontrou, registre a perda e acompanhe possíveis correspondências.</p></div></div>
    <div class="help-step"><span class="choice-icon">${icon('camera')}</span><div><h2>Registre um encontrado</h2><p>Adicione uma foto, descreva o objeto, indique onde foi encontrado e informe se está com você ou com o setor da Fatec.</p></div></div>
    <div class="help-step"><span class="choice-icon">${icon('check')}</span><div><h2>Combine a retirada</h2><p>Envie uma solicitação com um detalhe do objeto. Depois que o responsável confirmar a identificação, acompanhe a retirada em Meus registros.</p></div></div></section>
    <aside class="panel side-note"><span class="choice-icon">${icon('building')}</span><h2>Setor de Achados e Perdidos</h2>
      <p>${e(session.sector.location || 'Fatec Taquaritinga')}</p>${session.sector.hours ? `<p>${e(session.sector.hours)}</p>` : ''}
      ${link('/novo','Registrar item',{ cls:'button primary',symbol:'plus' })}</aside></div>`);
}

const adminNav = [
  ['/painel','Visão geral','dashboard'], ['/painel/encontrados','Encontrados','box'],
  ['/painel/perdidos','Perdidos','search'], ['/painel/solicitacoes','Solicitações','bell'],
  ['/painel/historico','Histórico','history'], ['/painel/usuarios','Usuários','users'],
  ['/painel/configuracoes','Configurações','settings']
];

function adminShell(content, path) {
  return shell(`<div class="admin-layout"><aside class="admin-sidebar panel"><span class="eyebrow">Área administrativa</span>
    <nav aria-label="Painel">${adminNav.map(([url,name,symbol]) =>
      `<a href="${url}" class="${url === path ? 'on' : ''}" ${url === path ? 'aria-current="page"' : ''} data-nav>${icon(symbol)}<span>${name}</span></a>`).join('')}</nav></aside>
    <section class="admin-body">${content}</section></div>`,{ wide:true });
}

async function adminPage(url, token) {
  const path = url.pathname;
  if (!needUser(path)) return;
  if (session.user.role !== 'admin') {
    site.innerHTML = shell(empty('Área administrativa','Entre com uma conta de administração para acessar o painel.',link('/','Voltar aos itens'),'lock'));
    return;
  }
  if (path === '/painel') return adminOverview(token,path);
  if (path === '/painel/configuracoes') return settingsPage(token,path);
  if (path === '/painel/usuarios') return usersPage(url,token);
  if (path === '/painel/solicitacoes') {
    const query = new URLSearchParams({ scope:'campus',page:url.searchParams.get('page') || '1' });
    const data = await api(`/contacts?${query}`);
    const { contacts } = data;
    if (token !== navigation) return;
    site.innerHTML = adminShell(`${header('Solicitações','Revise os pedidos para objetos guardados no setor.')}${contactCards(contacts)}${pager(path + url.search,data)}`,path);
    bindContactActions(contacts);
    return;
  }
  return itemManagement(url,token);
}

async function adminOverview(token,path) {
  const { counts, recent, categories } = await api('/admin/overview');
  if (token !== navigation) return;
  const stats = [
    ['box',counts.found,'Encontrados em aberto','/painel/encontrados'],
    ['target',counts.lost,'Perdas em aberto','/painel/perdidos'],
    ['check',counts.returned,'Devoluções nos últimos 30 dias','/painel/historico'],
    ['bell',counts.contacts,'Solicitações pendentes','/painel/solicitacoes']
  ];
  const bars = categories.filter(category => category.total);
  const max = Math.max(1,...bars.map(category => category.total));
  site.innerHTML = adminShell(`${header('Visão geral','Acompanhe os registros e a movimentação do setor.',
    link('/novo/found','Registrar encontrado',{ cls:'button primary',symbol:'plus' }))}
    <div class="stat-grid">${stats.map(([symbol,num,label,href]) => `<a href="${href}" class="stat panel" data-nav>
      <span class="choice-icon">${icon(symbol)}</span><strong>${num}</strong><span>${label}</span></a>`).join('')}</div>
    ${counts.review ? `<div class="notice">${icon('bell')}${counts.review} ${counts.review === 1 ? 'registro aguarda' : 'registros aguardam'} revisão.
      ${link('/painel/encontrados?review=1','Revisar registros',{ cls:'text-link' })}</div>` : ''}
    <div class="dashboard-grid"><section class="panel board"><h2>Registros recentes</h2>
      ${recent.length ? recent.map(item => `<div class="board-row"><div>${link(itemHref(item.id),e(item.title),{ cls:'record-title' })}
       <p>${kindText[item.kind]} · ${e(item.category)} · ${niceDate(item.createdAt)}</p></div>${badge(item.status)}</div>`).join('')
       : '<p class="hint">Os novos registros vão aparecer aqui.</p>'}</section>
    <section class="panel board"><h2>Encontrados por categoria</h2>
      ${bars.length ? bars.map(category => `<div class="bar-row"><span>${e(category.name)}</span><progress value="${category.total}" max="${max}" aria-label="${e(category.name)}"></progress><b>${category.total}</b></div>`).join('')
      : '<p class="hint">Nenhum item em aberto.</p>'}
      <div class="board-row"><span>Nota média das devoluções</span><strong class="rating-number">${icon('star')} ${counts.rating ?? '—'}</strong></div></section></div>`,path);
}

async function itemManagement(url,token) {
  const path = url.pathname;
  const historyMode = path === '/painel/historico';
  const lost = path === '/painel/perdidos';
  const params = new URLSearchParams(url.search);
  if (!historyMode) params.set('kind',lost ? 'lost' : 'found');
  if (historyMode && !params.has('history')) params.set('history','complete');
  const data = await api(`/admin/items?${params}`);
  if (token !== navigation) return;
  const archived = params.get('archived') === '1';
  const review = params.get('review') === '1';
  const statuses = historyMode ? [['','Todos'],...displayStatus(['open','reserved','returned','recovered'])]
    : [['','Todos'],...displayStatus(lost ? ['open','recovered'] : ['open','reserved','returned'])];
  const row = item => {
    const controls = [];
    const key = `data-id="${item.id}"`;
    if (archived) controls.push(btn('admin-restore','Restaurar','archive','quiet',key));
    else {
      if (!historyMode) {
        controls.push(btn('admin-edit','Editar','edit','quiet',key));
        if (item.kind === 'found') {
          if (item.publication !== 'public') controls.push(btn('admin-approve','Publicar','check','quiet',key));
          if (item.publication === 'public') controls.push(btn('admin-hide','Ocultar','','quiet',key));
          if (item.status === 'open') controls.push(btn('admin-reserve','Reservar','','quiet',key));
          if (item.status === 'reserved') controls.push(btn('admin-reopen','Reabrir','','quiet',key));
          if (item.status !== 'returned' && item.custody === 'campus') controls.push(btn('admin-return','Devolver','check','primary',key));
          if (item.status !== 'returned' && item.custody === 'finder') controls.push(btn('admin-receive','Receber no setor','building','quiet',key));
          if (item.status !== 'returned') controls.push(btn('admin-qr','Etiqueta','qr','quiet',key));
        }
        if (item.contactPhone) controls.push(`<a class="button quiet" href="https://wa.me/${e(item.contactPhone)}" target="_blank" rel="noopener noreferrer">${icon('whatsapp')}WhatsApp</a>`);
        controls.push(btn('admin-archive','Arquivar','archive','quiet danger',key));
      }
      if (historyMode || item.returnedOn) controls.push(btn('admin-history','Histórico','history','quiet',key));
    }
    return `<tr><td><a href="${itemHref(item.id)}" class="table-item" data-nav><span class="table-cover">${cover(item)}</span><span><b>${e(item.title)}</b>
      <small>${e(item.category)} · ${e(item.authorName)}</small></span></a></td>
      <td>${badge(item.status)}${item.kind === 'found' && item.publication !== 'public' ? badge(item.publication,publicationText[item.publication]) : ''}</td>
      <td><span>${niceDate(item.returnedOn || item.occurredOn)}</span><small>${e(item.location || kindText[item.kind])}</small></td>
      <td>${e(item.recipientName || item.reservationName || custodyText[item.custody] || '—')}</td>
      <td><div class="table-actions">${controls.join('')}</div></td></tr>`;
  };
  let exportQuery = new URLSearchParams();
  for (const key of ['from','to']) if (params.has(key)) exportQuery.set(key,params.get(key));
  const pageTabs = historyMode ? [
    [`${path}?history=complete`,'Devolvidos','complete'],[`${path}?history=pending`,'Não devolvidos','pending'],[`${path}?archived=1`,'Arquivados','archived']
  ] : [
    [path,'Ativos','active'],...(!lost ? [[`${path}?review=1`,'Em revisão','review']] : []),[`${path}?archived=1`,'Arquivados','archived']
  ];
  site.innerHTML = adminShell(`${header(historyMode ? 'Histórico' : lost ? 'Itens perdidos' : 'Itens encontrados',
    historyMode ? 'Consulte entregas concluídas, registros em aberto e avaliações.' : lost ? 'Gerencie as perdas registradas e possíveis correspondências.' : 'Acompanhe a guarda, as reservas e a publicação dos objetos.',
    historyMode ? `<a class="button secondary" href="/api/admin/history.csv?${e(exportQuery.toString())}" download>${icon('download')}Exportar CSV</a>` : lost ? '' : link('/novo/found','Novo encontrado',{ cls:'button primary',symbol:'plus' }))}
    ${tabs(pageTabs,archived ? 'archived' : historyMode ? params.get('history') : review ? 'review' : 'active')}
    <form class="panel table-filter" id="table-filter">${input('Buscar','q',params.get('q'),'maxlength="120" placeholder="Nome, descrição ou local"')}
      ${select('Categoria','category',categoryOptions('Todas'),params.get('category') || '')}
      ${select('Status','status',statuses,params.get('status') || '')}
      ${historyMode ? input('De','from',params.get('from'),`type="date" max="${today()}"`) + input('Até','to',params.get('to'),`type="date" max="${today()}"`) : ''}
      <div class="table-filter-end">${submit('Filtrar','filter')}</div><div class="form-error" role="alert"></div></form>
    ${data.items.length ? `<div class="table-wrap panel"><table><thead><tr><th scope="col">Objeto</th><th scope="col">Status</th>
      <th scope="col">Data e local</th><th scope="col">Responsável ou destinatário</th><th scope="col">Ações</th></tr></thead>
      <tbody>${data.items.map(row).join('')}</tbody></table></div>${pager(path + url.search,data)}` :
      empty('Nenhum registro','Os itens que correspondem a esta seção ou filtro aparecem aqui.','','search')}`,path);
  onForm('#table-filter', data => {
    if (data.from && data.to && data.from > data.to) throw new Error('A data inicial precisa vir antes da data final.');
    let target = path + url.search;
    for (const [key,value] of Object.entries(data)) target = withQuery(target,key,value);
    go(target,{ keepScroll:true });
  });
  bindAdminItems(data.items);
}

function bindAdminItems(items) {
  const itemFor = button => items.find(item => item.id === button.dataset.id);
  const update = async (item,action,info = {}) => {
    await api(`/admin/items/${item.id}/action`,{ method:'POST',body:{ action,...info } });
    notify('Registro atualizado.');
    go(location.pathname + location.search,{ keepScroll:true });
  };
  for (const [action,title,text] of [
    ['approve','Publicar item','O objeto aparecerá na busca pública.'],
    ['hide','Ocultar item','O objeto sairá da busca. Os pedidos existentes continuam no histórico.'],
    ['archive','Arquivar registro','O registro sairá da listagem ativa e solicitações pendentes serão encerradas.'],
    ['restore','Restaurar registro','O registro voltará para a listagem ativa.'],
    ['reopen','Liberar reserva','O objeto ficará em aberto e a solicitação aprovada voltará para análise.'],
    ['receive','Receber no setor','Confirme que o objeto está fisicamente com o setor de Achados e Perdidos da Fatec.']
  ]) {
    actions[`admin-${action}`] = button => confirmAction(title,text,() => update(itemFor(button),action),title);
  }
  actions['admin-edit'] = button => {
    const item = itemFor(button);
    const categories = session.categories.some(cat => cat.id === item.categoryId) ? session.categories : [...session.categories,{ id:item.categoryId,name:item.category }];
    modal('Editar registro',`<form class="stack" id="admin-edit-form">${itemFields(item.kind,item,categories)}
      <div class="form-error" role="alert"></div><div class="form-actions">${btn('close','Voltar')}${submit('Salvar alterações','check')}</div></form>`);
    onForm('#admin-edit-form', async data => {
      await api(`/admin/items/${item.id}`,{ method:'PATCH',body:{ ...data,sharePhone:item.sharePhone } });
      notify('Registro atualizado.');
      go(location.pathname + location.search,{ keepScroll:true });
    });
  };
  actions['admin-return'] = async button => {
    const item = itemFor(button);
    const candidates = item.reservedLostId ? [] : (await api(`/admin/items/${item.id}/candidates`)).items;
    returnDialog(item,null,candidates);
  };
  actions['admin-reserve'] = async button => {
    const item = itemFor(button);
    const { items } = await api(`/admin/items/${item.id}/candidates`);
    modal('Reservar item',`<p>Separe “${e(item.title)}” enquanto a retirada é organizada.</p><form class="stack" id="reserve-form">
      ${items.length ? select('Vincular perda','lostId',[['','Sem registro vinculado'],...items.map(x => [x.id,`${x.title} · ${x.name}`])],items.length === 1 ? items[0].id : '') : ''}
      ${input('Nome de quem vai retirar','recipientName','','maxlength="90" placeholder="Preencha se não houver perda vinculada"')}
      <div class="form-error" role="alert"></div><div class="form-actions">${btn('close','Voltar')}${submit('Reservar','check')}</div></form>`);
    onForm('#reserve-form', data => update(item,'reserve',data));
  };
  actions['admin-qr'] = button => qrLabel(itemFor(button));
  actions['admin-history'] = async button => {
    const item = itemFor(button);
    const { timeline,ratings } = await api(`/admin/items/${item.id}/details`);
    const verbs = { created:'Cadastro',status:'Alteração de status',custody:'Transferência de guarda',publication:'Alteração de publicação',edited:'Edição',archived:'Arquivamento',restored:'Restauração' };
    modal('Histórico do registro',`<h3>${e(item.title)}</h3>
      ${item.returnedOn ? `<p>Devolvido a ${e(item.recipientName)} em ${niceDate(item.returnedOn)}.</p>${item.returnNotes ? `<p>${e(item.returnNotes)}</p>` : ''}` : ''}
      ${ratings.length ? `<h3>Avaliações</h3>${ratings.map(rating => `<div class="board-row"><div><strong>${e(rating.name)} · ${rating.perspective === 'finder' ? 'Quem encontrou' : 'Quem recebeu'}</strong><p>${e(rating.comment)}</p></div><b class="rating-number">${icon('star')} ${rating.score}/5</b></div>`).join('')}` : ''}
      <h3>Movimentações</h3><ol class="timeline">${timeline.map(entry => `<li><strong>${e(verbs[entry.action] || entry.action)}</strong>
        <span>${e(entry.actor)} · ${niceDate(entry.createdAt)}${entry.details ? ` · ${e(statusText[entry.details] || custodyText[entry.details] || publicationText[entry.details] || entry.details)}` : ''}</span></li>`).join('')}</ol>`);
  };
}

async function usersPage(url,token) {
  const data = await api(`/admin/users${url.search}`);
  if (token !== navigation) return;
  site.innerHTML = adminShell(`${header('Usuários','Gerencie contas e acesso à administração.')}
    <form class="panel table-filter users-filter" id="users-filter">${input('Nome ou e-mail','q',url.searchParams.get('q'),'maxlength="100" placeholder="Buscar usuário"')}${submit('Buscar','search')}</form>
    ${data.items.length ? `<div class="table-wrap panel"><table><thead><tr><th scope="col">Conta</th><th scope="col">Perfil</th><th scope="col">Status</th><th scope="col">Cadastro</th><th scope="col">Ações</th></tr></thead>
    <tbody>${data.items.map(user => `<tr><td><div class="table-item"><span class="avatar">${e(initial(user.name))}</span>
      <span><b>${e(user.name)}</b><small>${e(user.email || 'Acesso institucional')}</small></span></div></td><td>${user.role === 'admin' ? 'Administrador' : 'Usuário'}</td>
      <td>${user.active ? badge('open','Ativa') : badge('hidden','Inativa')}</td><td>${niceDate(user.createdAt)}</td>
      <td>${user.id === session.user.id ? '<small>Sua conta</small>' : btn('edit-user','Gerenciar','edit','quiet',`data-id="${user.id}"`)}</td></tr>`).join('')}</tbody></table></div>
      ${pager(url.pathname + url.search,data)}` : empty('Nenhuma conta encontrada','Tente outro nome ou e-mail.','','users')}`,url.pathname);
  onForm('#users-filter',({ q }) => go(withQuery(url.pathname + url.search,'q',q.trim()),{ keepScroll:true }));
  actions['edit-user'] = button => {
    const user = data.items.find(x => x.id === button.dataset.id);
    modal('Gerenciar conta',`<p>${e(user.name)}</p><form class="stack" id="user-form">
      ${select('Perfil','role',[['user','Usuário'],['admin','Administrador']],user.role)}
      <label class="check"><input type="checkbox" name="active" ${checked(user.active)}>Conta ativa</label>
      <div class="form-error" role="alert"></div><div class="form-actions">${btn('close','Voltar')}${submit('Salvar','check')}</div></form>`);
    onForm('#user-form',async data => {
      await api(`/admin/users/${user.id}`,{ method:'PATCH',body:{ role:data.role,active:data.active === 'on' } });
      notify('Conta atualizada.');
      go(location.pathname + location.search,{ keepScroll:true });
    });
  };
}

async function settingsPage(token,path) {
  const data = await api('/admin/settings');
  if (token !== navigation) return;
  const { settings } = data;
  const catalog = (type,title,description) => `<section class="panel board"><div class="section-head"><div><h2>${title}</h2><p>${description}</p></div>
    ${btn('catalog','Adicionar','plus','secondary',`data-type="${type}"`)}</div>
    ${data[type].map(entry => `<div class="board-row"><strong>${e(entry.name)}</strong><div class="record-tags">
      ${!entry.active ? badge('hidden','Inativo') : ''}${btn('catalog','Editar','edit','quiet',`data-type="${type}" data-id="${e(entry.id)}"`)}</div></div>`).join('')}</section>`;
  site.innerHTML = adminShell(`${header('Configurações','Defina como o setor recebe e publica os registros.')}
    <form class="panel editor stack settings-form" id="settings-form">
    <div class="form-heading"><h2>Atendimento</h2><p>Essas informações orientam a retirada após a aprovação do pedido.</p></div>
    <div class="form-grid">${input('Local do setor','location',settings.location,'required minlength="2" maxlength="120"')}
      ${input('WhatsApp institucional (opcional)','phone',settings.phone,'type="tel" maxlength="26"')}</div>
    ${input('Horário de atendimento (opcional)','hours',settings.hours,'maxlength="150" placeholder="Ex.: segunda a sexta, das 13h às 18h"')}
    <label class="check"><input type="checkbox" name="review" ${checked(settings.review)}>Revisar objetos encontrados antes de publicar</label>
    <div class="form-error" role="alert"></div><div class="form-actions">${submit('Salvar configurações','check')}</div></form>
    <div class="dashboard-grid">${catalog('categories','Categorias','Classificação dos objetos.')}${catalog('locations','Locais','Sugestões para preencher os registros.')}</div>`,path);
  onForm('#settings-form',async data => {
    await api('/admin/settings',{ method:'PATCH',body:{ ...data,review:data.review === 'on' } });
    await refreshSession();
    notify('Configurações salvas.');
    go(path,{ keepScroll:true });
  });
  actions.catalog = button => {
    const type = button.dataset.type;
    const entry = data[type].find(item => item.id === button.dataset.id);
    modal(entry ? 'Editar catálogo' : 'Adicionar ao catálogo',`<form class="stack" id="catalog-form">
      ${input('Nome','name',entry?.name,'required minlength="2" maxlength="90"')}
      ${entry ? `<label class="check"><input type="checkbox" name="active" ${checked(entry.active)}>Disponível para novos registros</label>` : ''}
      <div class="form-error" role="alert"></div><div class="form-actions">${btn('close','Voltar')}${submit('Salvar','check')}</div></form>`);
    onForm('#catalog-form',async values => {
      await api(`/admin/${type}${entry ? '/' + entry.id : ''}`,{ method:entry ? 'PATCH' : 'POST',body:{ name:values.name,active:values.active === 'on' } });
      await refreshSession();
      notify('Catálogo atualizado.');
      go(path,{ keepScroll:true });
    });
  };
}

async function render() {
  const token = ++navigation;
  const url = new URL(location.href);
  const path = url.pathname.replace(/\/$/,'') || '/';
  const titles = { '/':'Achados e Perdidos','/novo':'Registrar item','/meus-registros':'Meus registros','/entrar':'Entrar','/cadastro':'Criar conta','/perfil':'Minha conta','/ajuda':'Como funciona' };
  document.title = `${titles[path] || (path.startsWith('/painel') ? 'Painel' : 'Achados e Perdidos')} · Achaki`;
  try {
    if (path === '/') return await home(url,token);
    if (path === '/novo') return newChoice();
    if (path === '/novo/found' || path === '/novo/lost') return itemForm(path.slice(6));
    if (path.startsWith('/item/')) return await detail(encodeURIComponent(path.slice(6)),token);
    if (path === '/meus-registros') return await records(url,token);
    if (path === '/perfil') return profilePage(url);
    if (path === '/configurar-admin') return firstAdmin();
    if (path === '/ajuda') return helpPage();
    if (['/entrar','/cadastro','/recuperar-senha','/redefinir-senha'].includes(path)) return authPage(path,url);
    if (path.startsWith('/painel')) return await adminPage(url,token);
    site.innerHTML = shell(empty('Página não encontrada','Confira o endereço ou volte para a busca de objetos.',link('/','Ir para o início'),'search'));
  } catch (error) {
    if (token !== navigation) return;
    if (error.status === 401 && session.user) {
      session.user = null;
      clearPhotoDraft();
      go(nextQS(path),{ replace:true });
      return;
    }
    site.innerHTML = shell(empty(error.status === 404 ? 'Registro não encontrado' : 'Não foi possível carregar a página',
      error.message, error.status === 404 ? link('/','Voltar à busca') : btn('retry','Tentar novamente','history','primary'),'search'));
  }
}

actions.retry = async () => { await refreshSession(); await render(); };
actions.install = async () => {
  if (!installPrompt) return;
  const prompt = installPrompt;
  installPrompt = null;
  await prompt.prompt();
  document.querySelectorAll('.install-link').forEach(element => { element.hidden = true; });
};

document.addEventListener('click', async event => {
  if (!(event.target instanceof Element)) return;
  const pageLink = event.target.closest('a[data-nav]');
  if (pageLink && event.button === 0 && !event.metaKey && !event.ctrlKey && !event.shiftKey && !event.altKey) {
    event.preventDefault();
    go(pageLink.pathname + pageLink.search);
    return;
  }
  const button = event.target.closest('[data-action]');
  if (!button || !actions[button.dataset.action]) return;
  try { await actions[button.dataset.action](button); }
  catch (error) {
    if (error.status === 401) {
      session.user = null;
      clearPhotoDraft();
      go(nextQS(location.pathname),{ replace:true });
    } else notify(error.message);
  }
});

window.addEventListener('popstate',() => { if (dialog.open) dialog.close(); void render(); });
window.addEventListener('beforeinstallprompt',event => {
  event.preventDefault();
  installPrompt = event;
  document.querySelectorAll('.install-link').forEach(element => { element.hidden = false; });
});

site.innerHTML = shell(`<div class="loading" role="status">Carregando Achaki…</div>`);
try { await refreshSession(); await render(); }
catch (error) {
  site.innerHTML = shell(empty('O Achaki está indisponível agora',error.message,btn('retry','Tentar novamente','history','primary'),'search'));
}
if ('serviceWorker' in navigator) navigator.serviceWorker.register('/sw.js').catch(() => {});
