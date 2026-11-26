import { icon } from './icons.js';
import { lossFormPath, safePath } from './navigation.js';

const site = document.querySelector('#site');
const dialog = document.querySelector('#dialog');
const toast = document.querySelector('#toast');
const siteName = 'Achados e Perdidos';
const session = { user: null, categories: [], locations: [], sector: {}, features: {}, campus: '' };
const statusText = { open: 'Em aberto', reserved: 'Reservado', returned: 'Devolvido', recovered: 'Recuperado',
  pending: 'Pendente', approved: 'Aprovada', rejected: 'Recusada', cancelled: 'Cancelada', delivered: 'Entregue' };
const custodyText = { campus: 'No setor de Achados e Perdidos', finder: 'Com quem encontrou' };
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
let catalogSearchTimer;
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
    throw new Error('Sem conexão com o sistema. Confira sua internet e tente novamente.');
  }
  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw Object.assign(new Error(data.error || 'O sistema está temporariamente indisponível.'), { status: response.status });
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

function go(path, { replace = false, keepScroll = false, entryState = null } = {}) {
  clearTimeout(catalogSearchTimer);
  if (dialog.open) dialog.close();
  if (location.pathname + location.search !== path || location.hash) history[replace ? 'replaceState' : 'pushState'](entryState, '', path);
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
const receiptHref = id => `/comprovante/${encodeURIComponent(id)}`;
const itemHref = id => `/item/${encodeURIComponent(id)}`;
const entry = (path, name, symbol) => `<a href="${path}" data-nav ${location.pathname === path ? 'aria-current="page"' : ''}>${icon(symbol)}<span>${name}</span></a>`;

function brand() {
  return `<a class="brand" href="/" data-nav aria-label="${siteName}, início"><span class="brand-mark">${icon('tag')}</span>
    <span>${siteName}${session.campus ? `<small>${e(session.campus)}</small>` : ''}</span></a>`;
}

function shell(content,{auth=false,home=false,detail=false}={}) {
  const path=location.pathname;
  const nav=(href,name,symbol,main=false)=>link(href,(main?`<span class="nav-main">${icon(symbol)}</span>`:icon(symbol))+`<span>${name}</span>`,
    {cls:'nav-item'+(path===href?' active':''),attrs:path===href?'aria-current="page"':''});
  const dock=`<nav class="bottom-nav" aria-label="Navegação principal"><div class="rail-brand"><span class="rail-mark">${icon('box')}</span><div><strong>Achados &amp; Perdidos</strong>${session.campus?`<small>${e(session.campus)}</small>`:''}</div></div>${nav('/','Início','home')}${nav('/novo/lost','Perdi algo','search')}${nav('/novo/found','Registrar','plus',true)}${nav('/meus-registros','Registros','list')}${nav('/perfil','Perfil','user')}</nav>`;
  return `<div class="mobile-shell ${auth?'auth-shell':detail?'item-shell':'workspace-shell'}"><main id="conteudo" tabindex="-1" class="mobile-page${home?' home-view':''}${auth?' white no-nav':detail?' detail-page no-nav':''}">${content}</main>${auth||detail?'':dock}</div>`;
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

function card(item, lostId = '') {
  const href = lostId ? withQuery(itemHref(item.id),'perda',lostId) : itemHref(item.id);
  return `<article class="mural-record"><a href="${e(href)}" data-nav>
    <span class="mural-photo">${cover(item)}</span><div class="mural-object"><span class="object-category">${e(item.category)}</span>
      <h3>${e(item.title)}</h3><div class="item-meta">${rowInfo('pin',item.location || 'Local não informado')}${rowInfo('calendar',niceDate(item.occurredOn))}</div>

    </div><div class="mural-state">${badge(item.status,item.status === 'open' ? 'Disponível' : statusText[item.status])}
      ${item.status !== 'returned' ? `<small>${item.custody === 'campus' ? 'No setor' : 'Com quem encontrou'}</small>` : ''}</div>
    <span class="row-arrow">${icon('chev')}</span></a></article>`;
}

async function home(url,token) {
  const params=new URLSearchParams(url.searchParams);
  params.set('recent','1');
  const previousResults=qs('#catalog-results');
  previousResults?.setAttribute('aria-busy','true');
  const data=await api('/items?'+params);
  if(token!==navigation)return;
  const path=url.pathname+url.search,category=url.searchParams.get('category')||'';
  const person=session.user;
  const top=person ? `<div class="row"><div class="avatar">${e(initial(person.name))}</div><div class="user-hello"><b>Olá, ${e(person.name.split(' ')[0])}</b><span>Encontrou ou perdeu algo hoje?</span></div></div>${link(person.role==='admin'?'/painel':contactsPage,icon(person.role==='admin'?'dashboard':'bell'),{cls:'icon-btn',attrs:'aria-label="Abrir solicitações ou painel"'})}` :
    `<div class="brand-mini"><div class="brand-mark">${icon('box')}</div><div><h1 class="brand-title"><span class="handheld-brand">Achados &amp; Perdidos</span><span class="desktop-title">Mural de achados</span></h1><div class="brand-sub">${e(session.campus)}</div></div></div>${link('/entrar','Entrar',{cls:'login-pill'})}`;
  const chips=[{id:'',name:'Todos'},...session.categories].map(c=>link(withQuery(path,'category',c.id),e(c.name),{cls:'chip'+(category===c.id?' active':''),attrs:category===c.id?'aria-current="true"':''})).join('');
  const rows=data.items.map(item=>link(itemHref(item.id),`
    <span class="item-photo">${cover(item)}</span>
    <span class="catalog-name"><span class="item-kicker">${e(item.category)}</span><strong class="item-title">${e(item.title)}</strong></span>
    <span class="catalog-meta">${rowInfo('pin',item.location)}${rowInfo('calendar',niceDate(item.occurredOn))}</span>
    ${badge(item.status)}<span class="catalog-chevron" aria-hidden="true">${icon('chev')}</span>`,{cls:'item-card'})).join('');
  const filterLabels=[
    ['status',statusText[params.get('status')]],['location',params.get('location')],
    ['from',params.get('from')?'Desde '+niceDate(params.get('from')):''],
    ['to',params.get('to')?'Até '+niceDate(params.get('to')):'']
  ].filter(([key,label])=>params.has(key)&&label);
  const filtered=Boolean(category||params.get('q')||filterLabels.length);
  const activeFilters=filterLabels.map(([key,label])=>link(withQuery(path,key,''),e(label)+icon('x'),{
    cls:'applied-filter',attrs:`aria-label="Remover filtro ${e(label)}"`})).join('');
  const heading=filtered?'Resultados da busca':'Itens encontrados recentemente';
  const count=data.total===1?'1 item':data.total+' itens';
  const results=`<nav class="chips catalog-categories" aria-label="Categorias">${chips}</nav>
    ${activeFilters?`<div class="applied-filters">${activeFilters}</div>`:''}
    <div class="section-head"><div><h2>${heading}</h2><span class="result-count" role="status">${count}</span></div>${filtered?link('/','Limpar busca',{cls:'link'}):''}</div>
    <div class="item-list" id="homeItems">${rows||empty(filtered?'Nenhum item encontrado':'Ainda não há itens no mural',filtered?'Tente outro termo ou remova um filtro.':'Os itens publicados aparecerão aqui.','','search')}</div>${pager(path,data)}`;
  if(previousResults) {
    previousResults.innerHTML=results;
    previousResults.removeAttribute('aria-busy');
    const field=qs('#search-form input');
    if(field.value.trim()!==(params.get('q')||'')) field.value=params.get('q')||'';
    return;
  }
  site.innerHTML=shell(`<div class="mobile-top">${top}</div><form class="search-row" id="search-form" role="search"><div class="search-box">${icon('search')}<input class="control" name="q" type="search" aria-label="Buscar por palavra-chave" placeholder="Buscar por palavra-chave" value="${e(params.get('q')||'')}"></div>${btn('filters','','filter','filter-square','aria-label="Filtros"')}</form>
    <div class="quick-grid">${link('/novo/found','<span class="quick-icon">'+icon('plus')+'</span><span><b>Encontrei um item</b><small>Registrar achado</small></span>',{cls:'quick-card red-card'})}
    ${link('/novo/lost','<span class="quick-icon">'+icon('search')+'</span><span><b>Perdi um item</b><small>Abrir solicitação</small></span>',{cls:'quick-card dark-card'})}</div>
    <section id="catalog-results" aria-label="Objetos encontrados">${results}</section>`,{home:true});
  const search=qs('#search-form input');
  const run=()=>{
    clearTimeout(catalogSearchTimer);
    if(!search.isConnected || location.pathname!=='/')return;
    const next=withQuery(location.pathname+location.search,'q',search.value.trim());
    history.replaceState(null,'',next);
    void render();
  };
  search.addEventListener('input',()=>{
    if(location.pathname!=='/')return;
    clearTimeout(catalogSearchTimer);
    ++navigation;
    qs('#catalog-results').setAttribute('aria-busy','true');
    catalogSearchTimer=setTimeout(run,280);
  });
  onForm('#search-form',run);
}

actions.filters = () => {
  const params = new URLSearchParams(location.search);
  params.set('q',qs('#search-form input')?.value.trim()||'');
  const choices = (name,options) => `<div class="chips">${options.map(([value,label]) => `<label class="chip"><input type="radio" name="${name}" value="${e(value)}" ${checked(value===(params.get(name)||''))}>${e(label)}</label>`).join('')}</div>`;
  modal('Filtrar itens', `<form class="stack" id="filters-form">
    <fieldset><legend>Categoria</legend>${choices('category',categoryOptions('Todas'))}</fieldset>
    <fieldset><legend>Status</legend>${choices('status',[['','Todos'],...displayStatus()])}</fieldset>
    ${select('Local','location',[['','Todos os locais'],...session.locations.map(x=>[x.name,x.name])],params.get('location')||'')}
    <div class="form-grid">${input('A partir de','from',params.get('from'),`type="date" max="${today()}"`)}
    ${input('Até','to',params.get('to'),`type="date" max="${today()}"`)}</div>
    <div class="form-error" role="alert"></div><div class="form-actions">${link(withQuery('/','q',params.get('q')),'Limpar filtros')}${submit('Aplicar filtros')}</div></form>`,'prototype-sheet');
  onForm('#filters-form', data => {
    if (data.from && data.to && data.from > data.to) throw new Error('A data inicial precisa vir antes da data final.');
    let path = withQuery('/','q',params.get('q'));
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
  return safePath(url.searchParams.get('next'),'');
}

actions['show-terms']=()=>modal('Uso e privacidade','<p>Use dados verdadeiros e publique apenas fotos do objeto. Os achados ficam no mural público. As perdas são acessíveis à sua conta e ao setor. Quando alguém inicia o contato sobre um achado, o WhatsApp das pessoas envolvidas é usado para combinar a devolução.</p>');
function authPage(path, url) {
  const next = authNext(url);
  const target = next ? `?next=${encodeURIComponent(next)}` : '';
  const authTypes = {
    '/entrar': ['Login','Entre para registrar itens encontrados ou procurar algo que você perdeu no campus.','Entrar'],
    '/cadastro': ['Criar conta','Preencha seus dados para acessar o sistema de achados e perdidos da Fatec.','Criar conta'],
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
  site.innerHTML = shell(`<section class="original-auth"><div class="auth-titlebar">
    ${link(login ? '/' : `/entrar${target}`,'',{ cls:'icon-btn',symbol:'back',attrs:'aria-label="Voltar"' })}
    <h2>${title}</h2><span></span></div><div class="auth-form">
    <div class="form-heading">${login ? `<span class="logo-main">${icon('box')}</span>` : ''}
      ${login?'<h1 class="auth-h1">Achados &amp; Perdidos</h1>':''}${login && session.campus ? `<small class="campus-name">${e(session.campus)}</small>` : ''}<p>${description}</p></div>
    ${unavailable ? `<div class="notice">A recuperação automática por e-mail ainda não está disponível. Procure o setor de Achados e Perdidos.</div>${link('/entrar','Voltar para o login')}` :
    `<form class="stack" id="auth-form">${register ? input('Nome completo','name','','required minlength="2" maxlength="90" autocomplete="name"') : ''}
      ${!reset ? input('E-mail','email','','type="email" required maxlength="254" autocomplete="username" placeholder="voce@exemplo.com"') : ''}
      ${register ? input('Telefone / WhatsApp','phone','','type="tel" required minlength="10" maxlength="26" autocomplete="tel" placeholder="(16) 99999-9999"') : ''}
      ${!forgot ? input('Senha','password','',`type="password" required ${login ? '' : 'minlength="10"'} maxlength="128" autocomplete="${login ? 'current-password' : 'new-password'}" ${login ? '' : 'aria-describedby="password-help"'}`) : ''}
      ${register||reset?'<small id="password-help">Use pelo menos 10 caracteres.</small>':''}
      ${register || reset ? input('Confirmar senha','confirm','', 'type="password" required minlength="10" maxlength="128" autocomplete="new-password"') : ''}
      ${login ? `<div class="auth-options"><label class="check"><input type="checkbox" name="remember">Lembrar de mim</label>
        ${link('/recuperar-senha','Esqueci a senha',{ cls:'text-link' })}</div>` : ''}
      ${register?`<label class="check"><input name="terms" type="checkbox" required><span>Li e aceito as ${btn('show-terms','orientações de uso','','link-button')} e as informações sobre privacidade.</span></label>`:''}
      <div class="form-error" role="alert">${e(institutionMessage)}</div>${submit(verb,'arrow')}</form>`}
    ${login && session.features.sso ? `<a href="/api/auth/microsoft?next=${encodeURIComponent(next || '/')}" class="button secondary institutional">${icon('building')}Entrar com a conta institucional</a>` : ''}
    <p class="auth-bottom">${login ? 'Não tem conta? ' + link(`/cadastro${target}`,'Criar conta',{ cls:'text-link' }) :
      register ? 'Já tem conta? ' + link(`/entrar${target}`,'Entrar',{ cls:'text-link' }) : ''}</p></div></section>`,{ auth:true });
  onForm('#auth-form', async (data, form) => {
    if (register && data.terms !== 'on') throw new Error('Leia e aceite as orientações antes de continuar.');
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
  document.title = item.title + ' · ' + siteName;
  if (item.kind === 'lost' && item.isMine) return ownLossPage(item,token);
  const sourceId = new URLSearchParams(location.search).get('perda');
  const mine=item.isMine, active=['open','reserved'].includes(item.status);
  const info=(symbol,label,value)=>`<div class="info-row">${icon(symbol)}<div><span>${label}</span><b>${e(value)}</b></div></div>`;
  const whatsappButton=btn('start-whatsapp',item.reservedForMe?'Abrir conversa novamente':'Entrar em contato pelo WhatsApp','whatsapp','whatsapp-btn');
  let contact;
  if(!active) contact=`<div class="return-complete">${icon('check')}<div><b>Item devolvido</b><span>${niceDate(item.returnedOn)}</span></div>${item.canViewReceipt?link(receiptHref(item.id),'Ver informações',{cls:'link'}):''}</div>`;
  else if(mine) contact=`<h3>Gerenciar meu registro</h3><p>${item.custody==='campus'?'O setor da Fatec registra a devolução.':'O item está com você.'}</p>${link(contactPath(item),'Ver solicitações',{cls:'btn secondary full'})}${item.custody==='finder'?btn('direct-handover','Registrar devolução manualmente','check','btn full'):''}`;
  else if(!session.user) contact=`<div class="contact-head"><div><h3>Entrar em contato</h3><span>O contato é protegido por login.</span></div><span class="secure-chip">${icon('lock')} Protegido</span></div>
    <div class="locked-contact-v2"><div class="contact-preview-blur" aria-hidden="true"><div class="contact-owner">Responsável pelo item</div><div class="whatsapp-btn">${icon('whatsapp')} Entrar em contato pelo WhatsApp</div></div>
    <div class="contact-gate"><div class="lock-circle">${icon('lock')}</div><div><b>Faça login para continuar</b><span>Entre para conversar com o responsável pelo WhatsApp.</span></div>${link(nextQS(location.pathname+location.search),'Entrar em contato pelo WhatsApp',{cls:'whatsapp-btn guest-whatsapp',symbol:'whatsapp'})}</div></div>`;
  else if(item.status==='reserved'&&!item.reservedForMe)contact='<h3>Item reservado</h3><p>Outro possível proprietário já está combinando a devolução.</p>';
  else contact=`<div class="contact-head"><div><h3>${item.reservedForMe?'Contato em andamento':'Entrar em contato'}</h3><span>Ao abrir o WhatsApp, sua solicitação fica registrada.</span></div></div>
    <div class="contact-owner"><div class="avatar">${e(initial(item.contactName))}</div><div><b>${e(item.contactName)}</b><span>${item.custody==='campus'?'Setor responsável pela guarda':'Pessoa que encontrou o item'}</span></div></div>${whatsappButton}<p id="contact-error" role="alert"></p>`;
  const catalogReturn=safePath(history.state?.catalogOrigin,'/');
  const photos=item.photos||[];
  const gallery=photos.length?`<button class="hero-open" data-action="gallery" data-index="0" aria-label="Ampliar foto de ${e(item.title)}">${cover(item)}<span class="photo-hint">${icon('image')}${photos.length===1?'Ampliar foto':`Ver ${photos.length} fotos`}</span></button>`:cover(item);
  const thumbnails=photos.length>1?`<div class="detail-thumbs" role="group" aria-label="Fotos do objeto">${photos.map((src,i)=>`<button type="button" data-action="gallery" data-index="${i}" aria-label="Ampliar foto ${i+1} de ${photos.length}"><img src="${e(src)}" alt="" decoding="async"></button>`).join('')}</div>`:'';
  site.innerHTML=shell(`<div class="detail-media"><div class="detail-hero">${gallery}<div class="detail-actions">${link(catalogReturn,icon('back'),{cls:'icon-btn',attrs:'aria-label="Voltar ao mural" data-catalog-return'})}${btn('share','','share','icon-btn','aria-label="Compartilhar"')}</div></div>${thumbnails}</div>
    <div class="detail-content"><div class="row between">${badge(item.status)}<span class="detail-code">Código #${e(item.id.slice(0,8).toUpperCase())}</span></div><h1 class="detail-title">${e(item.title)}</h1><p class="detail-description">${e(item.description)}</p>
    <div class="detail-info">${info('box','Categoria',item.category)}${info('pin','Local onde foi encontrado',item.location)}${info('calendar','Data do encontro',niceDate(item.occurredOn))}</div>
    <div class="current-location">${icon('box')}<div><b>Onde o item está agora</b><br>${active?e(custodyText[item.custody]):'Item já devolvido ao proprietário'}${active && item.custody==='campus' && session.sector.location?' · '+e(session.sector.location):''}</div></div><section class="contact-box">${contact}</section></div>`,{detail:true});
  actions.gallery=button=>showGallery(item,Number(button.dataset.index));
  actions['direct-handover']=()=>returnDialog(item);
  actions['start-whatsapp']=async button=>{
    button.disabled=true;
    try {
      const {url}=await api('/items/'+item.id+'/whatsapp',{method:'POST',body:{lostId:sourceId || undefined}});
      location.assign(url);
    } catch(error) {const feedback=qs('#contact-error');if(feedback)feedback.textContent=error.message;}
    finally {button.disabled=false;}
  };
}

async function ownLossPage(item, token) {
  const open = item.status === 'open' && !item.archivedAt;
  const { items } = open ? await api(`/items/${item.id}/matches`) : { items:[] };
  if (token !== navigation) return;
  const matches = items.length ? `<div class="mural-rows">${items.map(found => card(found,item.id)).join('')}</div>` :
    '<p class="loss-empty">Ainda não há achados compatíveis. Volte a esta ficha para conferir os próximos objetos publicados.</p>';
  const photos = item.photos.map((src,index) => `<button class="thumb" type="button" data-action="gallery" data-index="${index}" aria-label="Ampliar foto ${index + 1}"><img src="${e(src)}" alt=""></button>`).join('');
  site.innerHTML = shell(`<div class="loss-page"><div class="back-row">${link('/meus-registros?aba=perdi','Minhas perdas',{ cls:'text-link',symbol:'back' })}</div>
    <header class="loss-heading"><div class="record-tags">${item.archivedAt ? badge('archived','Arquivado') : badge(item.status,open ? 'Em busca' : 'Recuperado')}<span class="private-label">${icon('lock')} Perda privada</span></div>
      <h1>${e(item.title)}</h1><p class="description">${e(item.description)}</p>
      <div class="inline-meta">${rowInfo('tag',item.category)}${item.location ? rowInfo('pin',item.location) : ''}${rowInfo('calendar',niceDate(item.occurredOn))}</div>
      ${photos ? `<div class="thumbnails">${photos}</div>` : ''}</header>
    ${item.contactCount ? link(contactPath(item),'Ver solicitação',{cls:'mini-action primary'}) : ''}
    ${open ? `<section class="loss-matches"><h2>Meu item foi encontrado</h2>${items.length ? '<p>Selecione o item que você acredita ser o seu.</p>' : ''}${matches}</section>` :
      item.archivedAt && item.status === 'open' ? '<p class="loss-empty">Este registro foi arquivado.</p>' :
      `<section class="loss-matches"><h2>Perda encerrada</h2>${item.recoveredItemId ? link(itemHref(item.recoveredItemId),'Ver objeto devolvido',{ cls:'text-link',symbol:'check' }) : '<p>Você informou que recuperou este objeto por conta própria.</p>'}</section>`}
    </div>`);
  actions.gallery = button => showGallery(item,Number(button.dataset.index));
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
  const url = location.origin + location.pathname;
  if (navigator.share) {
    try { await navigator.share({ title:document.title,url }); return; }
    catch (error) { if (error.name === 'AbortError') return; }
  }
  try { await navigator.clipboard.writeText(url); notify('Link copiado.'); }
  catch { modal('Compartilhar item', `<label>Link do item<input readonly value="${e(url)}"></label>`); }
};

function newChoice() {
  site.innerHTML = shell(`${header('Registrar um objeto','Escolha o que aconteceu.')}
    <div class="choice-grid"><a class="choice-card panel" href="/novo/found" data-nav><span class="choice-icon">${icon('box')}</span><div><h2>Encontrei um item</h2><p>Publique uma foto e informe onde o objeto está guardado.</p></div>${icon('arrow')}</a>
    <a class="choice-card panel" href="/novo/lost" data-nav><span class="choice-icon">${icon('target')}</span><div><h2>Perdi um item</h2><p>Registre a perda e acompanhe os objetos que podem corresponder.</p></div>${icon('arrow')}</a></div>`);
}

function itemFields(kind, data = {}, categories = session.categories, lockCategory = false) {
  const found = kind === 'found';
  return `${input('Nome do objeto','title',data.title,'required minlength="3" maxlength="90" placeholder="Ex.: Estojo azul"')}
    ${textarea('Descrição','description',data.description,'required minlength="8" maxlength="1200" rows="4" placeholder="Descreva as características visíveis do objeto."')}
    <div class="form-grid">${select('Categoria','categoryId',[['','Selecione'],...categories.map(c => [c.id,c.name])],data.categoryId,lockCategory ? 'disabled' : 'required')}
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

function itemForm(kind, url) {
  const found = kind === 'found';
  const path = url.pathname + url.search;
  if (!needUser(path)) return;
  if (!session.user.phone) {
    site.innerHTML = shell(empty('Complete seu perfil','Informe seu telefone antes de registrar um objeto.',
      link('/perfil?next=' + encodeURIComponent(path),'Editar perfil',{ cls:'button primary' }),'user'));
    return;
  }
  const saved = loadDraft(kind);
  const params = url.searchParams;
  const prefill = found ? {} : { title:(params.get('objeto') || '').slice(0,90), location:(params.get('local') || '').slice(0,120),
    categoryId:session.categories.find(cat => cat.id === params.get('categoria'))?.id || '' };
  const draft = { ...prefill,...saved };
  if (!photoDraft || photoDraft.key !== draftKey(kind)) clearPhotoDraft(kind);
  const pointOptions = [['','Selecione'],...session.locations.map(l=>[l.name,l.name])];
  if(draft.location && !pointOptions.some(([value])=>value===draft.location)) pointOptions.push([draft.location,draft.location]);
  site.innerHTML=shell(`<div class="auth-titlebar">${link('/',icon('back'),{cls:'icon-btn',attrs:'aria-label="Voltar"'})}<h2>Registrar item ${found?'encontrado':'perdido'}</h2><span></span></div>
    <form class="original-item-form" id="item-form">${found?'':'<div class="notice">Descreva o item com o máximo de detalhes. Você também pode adicionar fotos de referência para facilitar a identificação.</div>'}
    <div class="upload-zone"><div class="upload-title"><div><b>${found?'Fotos do item':'Fotos de referência (opcional)'}</b><div class="tiny muted">${found?'Adicione de 1 a 3 fotos. A primeira será a capa.':'Até 3 fotos do item perdido.'}</div></div><span id="photo-total" class="tiny muted"></span></div>
    <div class="photo-grid" id="photo-previews"></div><div class="photo-actions">
      ${btn('photo-file','<span><b>Escolher foto</b><small>Galeria ou arquivos</small></span>','camera','photo-action-btn')}
      ${btn('photo-capture','<span><b>Usar câmera</b><small>Em celulares compatíveis</small></span>','camera','photo-action-btn')}
      <input type="file" id="photo-files" accept="image/*" multiple hidden><input type="file" id="photo-camera" accept="image/*" capture="environment" hidden></div>
      <div class="photo-message">As fotos são redimensionadas automaticamente.</div></div>
    ${input(found?'Título do item':'O que você perdeu?','title',draft.title,'class="control" required minlength="3" maxlength="90"')}
    ${textarea('Descrição','description',draft.description,'class="control" required minlength="8" maxlength="1200"')}
    <div class="grid2">${select('Categoria','categoryId',categoryOptions(),draft.categoryId,'class="control" required')}
    ${input(found?'Data do encontro':'Data aproximada','occurredOn',draft.occurredOn||today(),`class="control" type="date" required max="${today()}"`)}</div>
    ${select(found?'Local onde foi encontrado':'Onde acha que perdeu? (opcional)','location',pointOptions,draft.location,found?'class="control" required':'class="control"')}
    ${found?`<fieldset class="field"><legend>Onde o item está agora?</legend><div class="choice-grid"><label class="choice-card"><input type="radio" name="custody" value="finder" ${checked(draft.custody==='finder')}><b>Está comigo</b><span>Quem perdeu poderá combinar a retirada com você.</span></label><label class="choice-card"><input type="radio" name="custody" value="campus" ${checked(draft.custody!=='finder')}><b>Entreguei na Fatec</b><span>O item está no setor de Achados e Perdidos.</span></label></div></fieldset>`:`<label class="record-card row between"><span><b>Compartilhar meu contato</b><small>Permite que a equipe fale com você.</small></span><input type="checkbox" name="sharePhone" ${checked(draft.sharePhone==='on')}></label>`}
    <small class="draft-note">${icon('check')} Rascunho salvo automaticamente nesta aba</small>
    ${found?'<div class="notice green">Ao publicar, o item aparece imediatamente na busca.</div>':''}
    <div class="form-error" role="alert"></div>${submit(found?'Publicar registro':'Registrar solicitação')}</form>`);
  drawPhotos();
  const form = qs('#item-form');
  form.addEventListener('input', event => {
    if (event.target.type === 'file') return;
    try { sessionStorage.setItem(draftKey(kind),JSON.stringify(Object.fromEntries(new FormData(form)))); } catch {}
  });
  actions['photo-file']=()=>qs('#photo-files').click();
  actions['photo-capture']=()=>qs('#photo-camera').click();
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
    go('/meus-registros');
    modal(found?'Registro publicado com sucesso':'Solicitação registrada com sucesso',`<p>${found?'O item já está disponível na busca.':e(response.item.title)}</p>${found?`<p><b>${e(response.item.title)}</b><br>Em aberto · ${e(response.item.location)}</p>`:''}<div class="form-actions">${found?link(itemHref(response.item.id),'Ver registro',{cls:'btn full'}):link('/','Voltar ao início',{cls:'btn secondary'})}${link('/meus-registros','Meus registros',{cls:'btn secondary'})}</div>`);

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

function tabs(items, active) {
  return `<nav class="tabs" aria-label="Seções">${items.map(([url,text,key]) =>
    link(url,text,{ cls:`tab ${key === active ? 'on' : ''}`,attrs:key === active ? 'aria-current="page"' : '' })).join('')}</nav>`;
}

const contactsPage = '/meus-registros?aba=contatos';

function contactPath(item) {
  return withQuery(contactsPage,item.kind === 'lost' ? 'lost' : 'item',item.id);
}

function editRecord(item, own = false) {
  const categories = session.categories.some(cat => cat.id === item.categoryId)
    ? session.categories : [...session.categories,{ id:item.categoryId,name:item.category }];
  const changePhoneConsent = own && item.kind === 'lost';
  modal('Editar registro',`<form class="stack" id="edit-record-form">
    ${itemFields(item.kind,item,categories,Boolean(item.recoveryForId))}
    ${changePhoneConsent ? `<label class="check"><input type="checkbox" name="sharePhone" ${checked(item.sharePhone)}>Compartilhar meu WhatsApp com o setor para tratar desta perda</label>` : ''}
    <div class="form-error" role="alert"></div><div class="form-actions">${btn('close','Voltar')}${submit('Salvar alterações','check')}</div></form>`);
  onForm('#edit-record-form',async data => {
    const { publication } = await api(`/${own ? 'mine' : 'admin/items'}/${item.id}`,{ method:'PATCH',body:{
      ...data, categoryId:data.categoryId || item.categoryId, updatedAt:item.updatedAt,
      sharePhone:changePhoneConsent ? data.sharePhone === 'on' : item.sharePhone
    } });
    notify(own && publication === 'pending' ? 'Alterações salvas. O objeto está em revisão.' : 'Registro atualizado.');
    go(location.pathname + location.search,{ keepScroll:true });
  });
}

function recordCard(item) {
  const archived = Boolean(item.archivedAt);
  const active = !archived && ['open','reserved'].includes(item.status);
  const found = item.kind === 'found';
  const mine = session.user.id === item.authorId;
  const key = `data-id="${item.id}"`;
  const controls = [];
  if (found && active && item.custody === 'finder' && mine) {
    controls.push(btn('return-record','Registrar devolução','check','primary',key));
  }
  if (!found && active && !item.recoveryForId && !item.contactCount) controls.push(btn('match-record','Meu item foi encontrado','search','mini-action primary',key));
  if (!archived && !found && item.recoveredItemId) {
    controls.push(link(receiptHref(item.recoveredItemId),'Ver devolução',{symbol:'check'}));
    if (!item.recipientRating) controls.push(btn('rate-record','Avaliar devolução','star','mini-action primary',`data-id="${e(item.recoveredItemId)}"`));
  }

  if (item.contactCount && (!found || item.custody === 'finder') && active) controls.push(link(contactPath(item),`${item.contactCount} solicitaç${item.contactCount === 1 ? 'ão' : 'ões'}`,{ cls:'button secondary',symbol:'bell' }));
  if (!archived && found && item.status === 'returned' && !item.finderRating && item.recipientId !== session.user.id) {
    controls.push(btn('rate-record','Avaliar devolução','star','primary',key));
  }
  if (item.canViewReceipt) controls.push(link(receiptHref(item.id),'Ver devolução',{symbol:'list'}));
  if (item.canChange && archived) controls.push(btn('restore-own','Restaurar','history','secondary',key));
  const photo = archived ? `<div class="record-photo">${cover(item)}</div>` :
    `<a href="${itemHref(item.id)}" data-nav class="record-photo" aria-label="Ver ${e(item.title)}">${cover(item)}</a>`;
  const note=!found ? (item.status==='recovered'?'Item recuperado':item.recoveryForId?'Contato iniciado':'Aguardando localização') :
    item.status==='returned'?'Item devolvido':item.custody==='campus'?'Sob guarda da Fatec':'O item está com você';
  if (!found && item.recoveryForId && active) controls.unshift(link(itemHref(item.recoveryForId),'Ver item',{cls:'mini-action primary'}));
  return `<article class="record-card"><div class="record-main"><div class="item-photo">${photo}</div><div class="grow"><div class="item-kicker">${found?'Você encontrou':'Você perdeu'}</div>
    <div class="item-title">${e(item.title)}</div><div class="item-meta">${e(item.location||'Local não informado')} · ${niceDate(item.occurredOn)}</div></div>${badge(item.status)}</div>
    <div class="record-footer"><span>${found?'Encontrado':'Perdido'}</span>${link(itemHref(item.id),'Ver detalhes ›',{cls:'link'})}</div>
    <div class="record-status-panel"><div><b>${note}</b></div></div><div class="record-actions">${controls.join('')}</div></article>`;
}

const recordTabs = [
  ['/meus-registros','Todos','all'], ['/meus-registros?aba=encontrei','Encontrei','found'], ['/meus-registros?aba=perdi','Perdi','lost']
];

async function records(url, token) {
  const path = url.pathname + url.search;
  if (!needUser(path)) return;
  const tab = { encontrei:'found',perdi:'lost',contatos:'contacts',avaliacoes:'returns',devolucoes:'returns' }[url.searchParams.get('aba')] || 'all';
  let content;
  let rows = [];
  if (tab === 'contacts') {
    const query = new URLSearchParams({ page:url.searchParams.get('page') || '1' });
    for (const key of ['item','lost','fila']) if (url.searchParams.has(key)) query.set(key,url.searchParams.get(key));
    const data = await api(`/contacts?${query}`);
    rows = data.contacts;
    const filtered = query.has('item') || query.has('lost') || query.has('fila');
    const back = filtered ? `<div class="back-row">${link(contactsPage,'Ver todas as solicitações',{ cls:'text-link',symbol:'back' })}</div>` : '';
    const queue = query.get('fila');
    const heading = {responder:'Pedidos para responder',retirar:'Minhas retiradas',entregar:'Objetos para entregar'}[queue];
    content = back + (heading ? `<h2 class="queue-heading">${heading}</h2>` : '') + contactCards(rows,queue) + pager(path,data);
  } else if (tab === 'returns') {
    const data = await api('/returns?page=' + encodeURIComponent(url.searchParams.get('page') || '1'));
    const role = {recipient:'Você recebeu',actor:'Você registrou a entrega',finder:'Você encontrou'};
    content = (data.items.length ? `<div class="return-list">${data.items.map(item =>
      `<article class="return-row"><div><small>${niceDate(item.returnedOn)} · ${role[item.role]}</small><h3>${e(item.title)}</h3>
        ${item.rating ? `<p class="return-rating">${icon('star')} Sua avaliação · ${item.rating}/5</p>` : ''}
        ${item.comment ? `<p class="return-comment">${e(item.comment)}</p>` : ''}</div><div class="record-actions">
        ${item.canViewReceipt ? link(receiptHref(item.id),'Ver devolução',{symbol:'list'}) : ''}
        ${item.canRate && !item.rating ? btn('rate-record','Avaliar entrega','star','quiet',`data-id="${item.id}"`) : ''}</div></article>`).join('')}</div>` :
      empty('Nenhuma devolução registrada','As entregas dos objetos que você encontrou ou recuperou aparecerão aqui.','','box')) + pager(path,data);
  } else {
    const archived = url.searchParams.get('arquivados') === '1';
    const query = new URLSearchParams({ page:url.searchParams.get('page') || '1' });
    if (tab !== 'all') query.set('kind',tab);
    if (archived) query.set('archived','1');
    const data = await api(`/mine?${query}`);
    rows = data.items;
    let list;
    if (rows.length) list = `<div class="record-list">${rows.map(recordCard).join('')}</div>`;
    else if (archived) list = empty('Nenhum registro arquivado','Os registros que você arquivar aparecerão aqui.','','archive');
    else if(tab==='all') list=empty('Você ainda não possui registros nesta categoria.','','','list');
    else list = empty(tab === 'found' ? 'Você ainda não registrou itens encontrados' : 'Você ainda não registrou perdas',
        tab === 'found' ? 'Quando publicar um objeto encontrado, ele aparecerá aqui.' : 'Registre uma perda para consultar objetos compatíveis.',
        link(`/novo/${tab}`,tab === 'found' ? 'Registrar um encontrado' : 'Registrar uma perda',{ cls:'button primary',symbol:'plus' }));
    content = `${list}${pager(path,data)}`;
  }
  if (token !== navigation) return;
  site.innerHTML = shell(`<div class="mobile-top"><h2>${tab==='contacts'?'Solicitações de contato':tab==='returns'?'Minhas avaliações':'Meus registros'}</h2></div>
    ${tabs(recordTabs,tab)}${content}`);
  const itemFor = button => rows.find(item => item.id === button.dataset.id);

  actions['match-record'] = async button => {
    const lost = itemFor(button);
    const {items} = await api('/items/'+lost.id+'/matches');
    if (token !== navigation) return;
    const candidates = items.map(found => `<article class="candidate-card">${cover(found)}<div class="grow"><b>${e(found.title)}</b><span>${e(found.category)} · ${e(found.location)}</span></div>${link(withQuery(itemHref(found.id),'perda',lost.id),'É este item',{cls:'mini-action primary'})}</article>`).join('');
    modal('Meu item foi encontrado',`<p>Selecione o item que você acredita ser o seu.</p><div class="candidate-list">${candidates||'<p>Nenhum item encontrado disponível no momento.</p>'}</div>`,'prototype-sheet');
  };
  actions['return-record'] = button => returnDialog(itemFor(button));
  actions['edit-own'] = button => editRecord(itemFor(button),true);
  for (const [action,title,description] of [
    ['archive','Arquivar registro','O registro sairá da lista ativa. Você poderá restaurá-lo em Arquivados.'],
    ['restore','Restaurar registro','O registro voltará para a sua lista ativa.']
  ]) {
    actions[`${action}-own`] = button => confirmAction(title,description,async () => {
      const item = itemFor(button);
      const { publication } = await api(`/mine/${item.id}/archive`,{ method:'POST',body:{ action,updatedAt:item.updatedAt } });
      notify(action === 'archive' ? 'Registro arquivado.' : publication === 'pending' ? 'Registro restaurado e enviado para revisão.' : 'Registro restaurado.');
      go(path,{ keepScroll:true });
    },title);
  }
  if (tab === 'contacts') bindContactActions(rows);
}

actions.transfer = button => {
  const item = button.dataset.id;
  confirmAction('Entregou o objeto ao setor?','O setor passa a cuidar da entrega. Se já havia um horário combinado, a pessoa precisará combinar a retirada com a equipe.',
    async () => { await api(`/items/${item}/transfer`,{ method:'POST',body:{} }); notify('Guarda atualizada.'); go(location.pathname + location.search); },'Confirmar entrega ao setor');
};

function contactCards(contacts,queue = '') {
  if (!contacts.length) {
    const titles = {responder:'Nenhum pedido aguardando resposta',retirar:'Nenhuma retirada aprovada',entregar:'Nenhuma entrega reservada'};
    return empty(titles[queue] || 'Nenhuma solicitação',queue ? '' : 'Os pedidos que você enviar ou receber aparecerão aqui.','','bell');
  }
  return `<div class="contact-list">${contacts.map(contact => {
    const received = contact.side === 'received';
    const key = `data-id="${contact.id}"`;
    const primary = [], extra = [];
    if (contact.canDeliver) primary.push(btn('contact-return','Confirmar entrega','check','secondary',key));
    if (contact.canReview) primary.push(btn('contact-reject','Não é o proprietário','x','quiet',key));
    if (contact.canRevoke) extra.push(btn('contact-reject','Não é o proprietário','x','quiet',key));
    if (!received && ['pending','approved'].includes(contact.status)) extra.push(btn('contact-cancel','Cancelar pedido','','quiet',key));
    if (contact.side==='sent' && contact.whatsappReservation) primary.push(link(itemHref(contact.itemId),'Abrir conversa novamente',{cls:'whatsapp-btn',symbol:'whatsapp'}));
    if (contact.phone) primary.push(`<a class="whatsapp-btn" href="https://wa.me/${e(contact.phone)}" target="_blank" rel="noopener noreferrer">${icon('whatsapp')}Abrir WhatsApp</a>`);
    if (contact.canViewReceipt) primary.push(link(receiptHref(contact.itemId),'Ver devolução',{symbol:'list'}));
    return `<article class="contact-card panel"><div class="contact-top"><span>${received ? 'Pedido recebido' : 'Meu pedido'} · ${niceDate(contact.createdAt)}</span>${badge(contact.status,contact.whatsappReservation?'Em contato':statusText[contact.status])}</div>
      <h3>${contact.canViewItem ? link(itemHref(contact.itemId),e(contact.title),{cls:'record-title'}) : e(contact.title)}</h3>
      <p class="contact-by">${e(received ? contact.requesterName : custodyText[contact.custody])}</p>
      ${contact.whatsappReservation ? '<p>Contato iniciado pelo WhatsApp. Combine a devolução na conversa.</p>' : contact.status === 'pending' ? `<div class="claim-proof"><small>${received ? 'Como a pessoa identificou o objeto' : 'Detalhe que você informou'}</small><p>${e(contact.message)}</p></div>` :
        `<details class="claim-disclosure"><summary>Detalhe de identificação</summary><p>${e(contact.message)}</p></details>`}
      ${contact.sector && (contact.sector.location || contact.sector.hours) ? `<p class="sector-note">${icon('building')}${e([contact.sector.location,contact.sector.hours].filter(Boolean).join(' · '))}</p>` : ''}

      ${contact.pickup?.agreed?`<p class="sector-note">Retirada já combinada · ${niceDate(contact.pickup.agreed.when)} às ${e(contact.pickup.agreed.when.slice(11))} · ${e(contact.pickup.agreed.place)}</p>`:''}
      ${primary.length ? `<div class="record-actions">${primary.join('')}</div>` : ''}
      ${extra.length ? `<details class="contact-options"><summary>Outras opções</summary><div class="record-actions">${extra.join('')}</div></details>` : ''}
    </article>`;
  }).join('')}</div>`;
}

function bindContactActions(contacts) {
  const find = button => contacts.find(row => row.id === button.dataset.id);
  const refresh = () => go(location.pathname + location.search,{keepScroll:true});
  actions['contact-return'] = button => {
    const contact = find(button);
    returnDialog({id:contact.itemId,title:contact.title,updatedAt:contact.itemUpdatedAt,occurredOn:contact.occurredOn},contact);
  };
  for (const [name,verb,description] of [
    ['approve','Aprovar identificação','O objeto ficará reservado para esta pessoa.'],
    ['reject','Recusar solicitação','O pedido será encerrado. A pessoa poderá enviar outro com mais detalhes.'],
    ['cancel','Cancelar solicitação','O pedido será retirado e uma eventual reserva será liberada.']
  ]) {
    actions['contact-' + name] = button => {
      const contact = find(button);
      const title = name === 'reject' && contact.status === 'approved' ? 'Revogar aprovação' : verb;
      confirmAction(title,description,async () => {
        await api(`/contacts/${contact.id}`,{method:'PATCH',body:{action:name}});
        notify(name === 'approve' ? 'Objeto reservado.' : 'Solicitação atualizada.');
        if (name === 'approve') go(withQuery(contact.custody === 'campus' ? '/painel/solicitacoes' : contactsPage,'item',contact.itemId));
        else refresh();
      },title);
    };
  }
}

function returnDialog(item, contact = null, candidates = []) {
  const linked = contact || item.reservedLostId || item.reservedContactId;
  modal('Registrar devolução', `<p>Registre a entrega de “${e(item.title)}” depois que a pessoa receber o objeto.</p><form class="stack" id="return-form">
    ${linked ? `<div class="notice">${icon('user')}${e(contact?.requesterName || item.reservationName || 'Devolução vinculada à reserva')}</div>` :
      `${candidates.length ? select('Vincular perda (opcional)','lostId',[['','Entrega sem vínculo'],...candidates.map(row => [row.id,`${row.title} · ${row.name}`])],'') : ''}
       ${input('Quem recebeu','recipientName',item.reservationName || '', 'maxlength="90" placeholder="Nome da pessoa que recebeu"')}`}
    ${input('Data da devolução','returnedOn',today(),`type="date" max="${today()}" ${item.occurredOn ? `min="${e(item.occurredOn)}"` : ''} required`)}
    ${textarea('Observações (opcional)','notes','','maxlength="700" rows="3"')}
    <div class="form-error" role="alert"></div><div class="form-actions">${btn('close','Voltar')}${submit('Confirmar devolução','check')}</div></form>`);
  onForm('#return-form', async data => {
    await api(`/items/${item.id}/return`,{ method:'POST',body:{ ...data,updatedAt:item.updatedAt,
      contactId:contact?.id || item.reservedContactId || undefined,lostId:data.lostId || item.reservedLostId || undefined } });
    notify('Entrega registrada.');
    go('/meus-registros');
  });
}

actions['rate-record'] = button => rate(button.dataset.id);
async function receiptPage(itemId,token) {
  if (!needUser(receiptHref(itemId))) return;
  const {receipt} = await api(`/items/${itemId}/receipt`);
  if (token !== navigation) return;
  document.title = 'Informações da devolução · ' + receipt.title;
  const timestamp = new Intl.DateTimeFormat('pt-BR',{timeZone:'America/Sao_Paulo',dateStyle:'short',timeStyle:'short'}).format(new Date(receipt.recordedAt));
  const field = (label,value) => `<div><dt>${label}</dt><dd>${e(value)}</dd></div>`;
  site.innerHTML = shell(`<div class="receipt-page"><div class="receipt-controls">
    ${link('/meus-registros?aba=devolucoes','Minhas devoluções',{cls:'text-link',symbol:'back'})}
</div>
    <article class="receipt-sheet"><header><div class="receipt-brand">${icon('tag')}<span>${siteName}${session.campus ? ' · ' + e(session.campus) : ''}</span></div>
      <h1>Informações da devolução</h1></header>
    <div class="receipt-object"><span>Objeto entregue</span><h2>${e(receipt.title)}</h2><p>${e(receipt.category)}</p></div>
    <dl class="receipt-facts">${field('Data da entrega',niceDate(receipt.returnedOn))}${field('Recebido por',receipt.recipientName)}
      ${field('Registrado por',receipt.recordedBy)}${field('Guarda na entrega',custodyText[receipt.custody])}</dl>
    <footer><p>Registro de ${e(timestamp)} · Horário de Brasília</p><span>Identificador</span><code>${e(receipt.id)}</code></footer></article>
    ${link(itemHref(itemId),'Abrir ficha do objeto',{cls:'text-link receipt-item',symbol:'arrow'})}</div>`);
}
actions['print-receipt'] = () => window.print();

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

async function profilePage(url,token) {
  if (!needUser(url.pathname+url.search)) return;
  const u=session.user;
  const [found,lost,returned]=await Promise.all(['kind=found','kind=lost','kind=found&status=returned'].map(query=>api('/mine?'+query)));
  if(token!==navigation)return;
  const menu=(title,symbol,action)=>btn(action,'<span class="left">'+icon(symbol)+title+'</span>'+icon('chev'),'','profile-option');
  site.innerHTML=shell(`<div class="mobile-top"><h2>Perfil</h2>${btn('profile-data','','edit','icon-btn','aria-label="Editar perfil"')}</div><div class="profile-card"><div class="profile-avatar">${e(initial(u.name))}</div><div><b>${e(u.name)}</b><span>${e(u.email)}</span><span class="red">${u.role==='admin'?'Administrador':'Aluno'}</span></div></div>
    <div class="stats">${[[found.total,'Encontrados'],[lost.total,'Perdidos'],[returned.total,'Devolvidos']].map(([n,t])=>`<div class="stat"><b>${n}</b><span>${t}</span></div>`).join('')}</div>
    <div class="profile-menu">${menu('Dados pessoais','user','profile-data')}${u.hasPassword?menu('Alterar senha','lock','change-password'):''}
    ${menu('Notificações','bell','profile-requests')}${menu('Minhas avaliações','star','profile-ratings')}${menu('Ajuda e termos de uso','help','profile-help')}</div>
    ${u.role==='admin'?link('/painel','Painel administrativo',{cls:'btn full'}):''}
    ${session.features.sso&&!u.institutional?'<a class="btn secondary full" href="/api/auth/microsoft?link=1">Vincular conta institucional</a>':''}
    ${btn('logout','Sair da conta','logout','btn secondary full')}`);
  actions['profile-requests']=()=>go(contactsPage);
  actions['profile-ratings']=async ()=>{
    const {items}=await api('/ratings');
    if(token!==navigation)return;
    const ratings=items.map(r=>`<article class="record-card"><div class="row between"><div><b>${e(r.title)}</b><div class="tiny muted">${r.perspective==='finder'?'Quem encontrou':'Quem recuperou'} · ${niceDate(r.createdAt)}</div></div><span class="badge returned">${e(r.score)}/5 ★</span></div>${r.comment?`<p>${e(r.comment)}</p>`:''}</article>`).join('');
    modal('Minhas avaliações',ratings||'<p>Você ainda não enviou avaliações.</p>','prototype-sheet');
  };
  actions['profile-help']=()=>go('/ajuda');
  actions['profile-data']=()=>{
    modal('Dados pessoais',`<form class="stack" id="profile-form">${input('Nome completo','name',u.name,'required minlength="2" maxlength="90"')}
      ${input('E-mail','email',u.email,'readonly')}${input('Telefone / WhatsApp','phone',u.phone,'type="tel" required')}<div class="form-error" role="alert"></div>${submit('Salvar alterações')}</form>`);
    onForm('#profile-form',async data=>{session.user=(await api('/profile',{method:'PATCH',body:data})).user;go(authNext(url)||'/perfil');});
  };
  if(!u.phone)actions['profile-data']();
}

function firstAdmin() {
  if (!needUser('/configurar-admin')) return;
  site.innerHTML = shell(`${header('Ativar primeira administração','Use a chave de configuração com a conta que vai administrar o sistema.')}
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
  site.innerHTML=shell(`<div class="auth-titlebar">${link('/perfil',icon('back'),{cls:'icon-btn',attrs:'aria-label="Voltar"'})}<h2>Ajuda e termos de uso</h2><span></span></div>
    <div class="notice"><b>Como funciona</b><p>Cadastre objetos encontrados ou perdidos com informações verdadeiras. Para conversar sobre um objeto, entre na sua conta e abra o WhatsApp na ficha.</p></div>
    <div class="notice green"><b>Devolução</b><p>Se o item está com você, registre a devolução depois de entregá-lo. Se foi entregue à Fatec, o setor registra a entrega. Quem encontrou e quem recebeu podem avaliar a devolução.</p></div>`);
}

const adminNav = [
  ['/painel','Visão geral','dashboard'], ['/painel/encontrados','Itens encontrados','box'],
  ['/painel/perdidos','Itens perdidos','search'],
  ['/painel/historico','Histórico','history'], ['/painel/usuarios','Usuários','users'],
  ['/painel/configuracoes','Configurações','settings']
];

function adminShell(content, path) {
  const menu=adminNav.map(([url,name,symbol])=>link(url,icon(symbol)+' '+e(name),{cls:url===path?'active':''})).join('');
  return `<div class="admin-app"><aside class="admin-sidebar"><div class="admin-brand"><div class="brand-mark">${icon('box')}</div><div><b>Achados &amp; Perdidos</b><span>Painel administrativo</span></div></div>
    <nav class="admin-menu">${menu}</nav><div class="admin-spacer"></div><div class="admin-profile"><div class="avatar">${e(initial(session.user.name))}</div><div><b>${e(session.user.name)}</b><span>Administrador</span></div>${btn('logout','','logout','icon-btn','aria-label="Sair"')}</div></aside>
    <main id="conteudo" class="admin-main" tabindex="-1"><header class="admin-topbar"><h1>${e(adminNav.find(([url])=>url===path)?.[1]||'Solicitações de contato')}</h1>${link('/','Início',{cls:'link'})}</header><nav class="mobile-admin-bar">${menu}</nav><div class="admin-content">${content}</div></main></div>`;
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
    if (['responder','entregar'].includes(url.searchParams.get('fila'))) query.set('fila',url.searchParams.get('fila'));
    if (url.searchParams.has('item')) query.set('item',url.searchParams.get('item'));
    const data = await api(`/contacts?${query}`);
    const { contacts } = data;
    if (token !== navigation) return;
    site.innerHTML = adminShell(`${header(({responder:'Pedidos para responder',entregar:'Objetos para entregar'})[query.get('fila')] || 'Solicitações','Consulte quem entrou em contato e registre a entrega dos objetos guardados no setor.',
      query.has('fila') || query.has('item') ? link(path,'Todas as solicitações') : '')}${contactCards(contacts,query.get('fila'))}${pager(path + url.search,data)}`,path);
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

  const statuses = historyMode ? [['','Todos'],...displayStatus(['open','reserved','returned','recovered'])]
    : [['','Todos'],...displayStatus(lost ? ['open','recovered'] : ['open','reserved','returned'])];
  const row = item => {
    const controls = [];
    const key = `data-id="${item.id}"`;
    if (item.canViewReceipt) controls.push(link(receiptHref(item.id),'Ver devolução',{cls:'button quiet',symbol:'list'}));
    if (archived) controls.push(btn('admin-restore','Restaurar','archive','quiet',key));
    else {
      if (!historyMode) {
        controls.push(btn('admin-edit','Editar','edit','quiet',key));
        if (item.kind === 'found') {
          if (item.publication !== 'public') controls.push(btn('admin-approve','Publicar','check','quiet',key));
          if (item.status === 'open') controls.push(btn('admin-reserve','Reservar','','quiet',key));
          if (item.status === 'reserved') controls.push(btn('admin-reopen','Reabrir','','quiet',key));
          if (item.status !== 'returned' && item.custody === 'campus') controls.push(btn('admin-return','Devolver','check','primary',key));

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
    [path,'Ativos','active'],[`${path}?archived=1`,'Arquivados','archived']
  ];
  site.innerHTML = adminShell(`${header(historyMode ? 'Histórico' : lost ? 'Itens perdidos' : 'Itens encontrados',
    historyMode ? 'Consulte entregas concluídas, registros em aberto e avaliações.' : lost ? 'Gerencie as perdas registradas e possíveis correspondências.' : 'Acompanhe a guarda, as reservas e a publicação dos objetos.',
    historyMode ? `<a class="button secondary" href="/api/admin/history.csv?${e(exportQuery.toString())}" download>${icon('download')}Exportar CSV</a>` : lost ? '' : link('/novo/found','Novo encontrado',{ cls:'button primary',symbol:'plus' }))}
    ${tabs(pageTabs,archived ? 'archived' : historyMode ? params.get('history') : 'active')}
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
    ['receive','Receber no setor','Confirme que o setor recebeu o objeto. Se já havia um horário de retirada, a equipe precisará combinar um novo encontro.']
  ]) {
    actions[`admin-${action}`] = button => confirmAction(title,text,() => update(itemFor(button),action),title);
  }
  actions['admin-edit'] = button => editRecord(itemFor(button));
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
    <div class="form-heading"><h2>Atendimento</h2><p>O WhatsApp do setor aparece no contato de objetos entregues à Fatec.</p></div>
    <div class="form-grid">${input('Local do setor','location',settings.location,'required minlength="2" maxlength="120"')}
      ${input('WhatsApp institucional (opcional)','phone',settings.phone,'type="tel" maxlength="26"')}</div>
    ${input('Horário de atendimento (opcional)','hours',settings.hours,'maxlength="150" placeholder="Ex.: segunda a sexta, das 13h às 18h"')}

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
  const pageTitle = path.startsWith('/painel') ? 'Painel administrativo' : titles[path];
  document.title = pageTitle && pageTitle !== siteName ? `${pageTitle} · ${siteName}` : siteName;
  try {
    if (path === '/') return await home(url,token);
    if (path === '/novo') return newChoice();
    if (path === '/novo/found' || path === '/novo/lost') return itemForm(path.slice(6),url);
    if (path.startsWith('/comprovante/')) return await receiptPage(encodeURIComponent(path.slice(13)),token);
    if (path.startsWith('/item/')) return await detail(encodeURIComponent(path.slice(6)),token);
    if (path === '/meus-registros') return await records(url,token);
    if (path === '/perfil') return await profilePage(url,token);
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
      go(nextQS(path + url.search),{ replace:true });
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
    if(pageLink.hasAttribute('data-catalog-return') && history.state?.catalogOrigin===pageLink.pathname+pageLink.search) {
      history.back();
      return;
    }
    if(location.pathname==='/' && pageLink.classList.contains('item-card')) {
      history.replaceState({...history.state,catalogScroll:window.scrollY},'',location.href);
      go(pageLink.pathname+pageLink.search,{entryState:{catalogOrigin:location.pathname+location.search}});
      return;
    }
    const inCatalog=!!pageLink.closest('#catalog-results')&&pageLink.pathname==='/';
    let destination=pageLink.pathname+pageLink.search;
    if(inCatalog && pageLink.matches('.chip,.applied-filter')) {
      destination=withQuery(destination,'q',qs('#search-form input').value.trim());
    }
    go(destination,{keepScroll:inCatalog});
    return;
  }
  const button = event.target.closest('[data-action]');
  if (!button || !actions[button.dataset.action]) return;
  try { await actions[button.dataset.action](button); }
  catch (error) {
    if (error.status === 401) {
      session.user = null;
      clearPhotoDraft();
      go(nextQS(location.pathname + location.search),{ replace:true });
    } else notify(error.message);
  }
});

window.addEventListener('popstate',async () => {
  clearTimeout(catalogSearchTimer);
  if(dialog.open) dialog.close();
  const url=location.href, scroll=history.state?.catalogScroll;
  await render();
  if(location.href===url && location.pathname==='/' && Number.isFinite(scroll)) window.scrollTo(0,scroll);
});
window.addEventListener('beforeinstallprompt',event => {
  event.preventDefault();
  installPrompt = event;
  document.querySelectorAll('.install-link').forEach(element => { element.hidden = false; });
});

site.innerHTML = shell(`<div class="loading" role="status">Carregando…</div>`);
try { await refreshSession(); await render(); }
catch (error) {
  site.innerHTML = shell(empty('Sistema indisponível',error.message,btn('retry','Tentar novamente','history','primary'),'search'));
}
if ('serviceWorker' in navigator) navigator.serviceWorker.register('/sw.js').catch(() => {});
