
const STORE = {
  users:'apg_users_v3',
  session:'apg_session_v3',
  items:'apg_items_v3',
  lost:'apg_lost_v3',
  ratings:'apg_ratings_v3',
  settings:'apg_settings_v3',
  claims:'apg_claims_v3',
  drafts:'apg_drafts_v3'
};

const state = {
  route:'login',
  category:'Todos',
  recordTab:'Todos',
  filters:{category:null,status:null,local:''},
  selectedItem:null,
  rating:4,
  photos:[],
  avatarTemp:null,
  installPrompt:null,
  lastSearch:'',
  heroIndex:0
};

const app = document.getElementById('app');
const nav = document.getElementById('bottomNav');
const modalRoot = document.getElementById('modalRoot');

const read = (k,fallback) => {
  try{
    const v=localStorage.getItem(k);
    return v ? JSON.parse(v) : fallback;
  }catch(e){return fallback}
};
const write = (k,v)=>localStorage.setItem(k,JSON.stringify(v));

function seed(){
  if(!localStorage.getItem(STORE.users)){
    write(STORE.users,[{
      id:'u-demo',
      nome:'Ana Beatriz Rocha',
      email:'ana.rocha@fatec.sp.gov.br',
      telefone:'(16) 99876-5432',
      senha:'1234',
      curso:'ADS',
      campus:'Fatec Taquaritinga',
      avatar:'assets/avatars/ana.jpg'
    }]);
  }
  if(!localStorage.getItem(STORE.items)){
    write(STORE.items,[
      {id:'i101',ownerId:'u-demo',titulo:'Chave de carro',descricao:'Chave de carro vermelha com chaveiro da Ferrari.',categoria:'Acessórios',data:'2026-09-08',local:'Estacionamento',destino:'Entreguei na Fatec',status:'Em aberto',photos:['assets/items/chave.jpg']},
      {id:'i102',ownerId:'u-demo',titulo:'Carteira marrom com corrente',descricao:'Carteira marrom estilo couro com corrente metálica.',categoria:'Documentos',data:'2026-09-07',local:'Cantina',destino:'Entreguei na Fatec',status:'Reservado',photos:['assets/items/carteira.jpg']},
      {id:'i103',ownerId:'u-demo',titulo:'Fone de ouvido',descricao:'Fone de ouvido over-ear na cor prata/cinza.',categoria:'Eletrônicos',data:'2026-09-06',local:'Biblioteca',destino:'Entreguei na Fatec',status:'Em aberto',photos:['assets/items/fone.jpg']}
    ]);
  }
  if(!localStorage.getItem(STORE.lost)) write(STORE.lost,[]);
  if(!localStorage.getItem(STORE.ratings)) write(STORE.ratings,[]);
  if(!localStorage.getItem(STORE.settings)) write(STORE.settings,{notifications:true});
  if(!localStorage.getItem(STORE.claims)) write(STORE.claims,[]);
  if(!localStorage.getItem(STORE.drafts)) write(STORE.drafts,{found:{},lost:{}});
}
seed();

function user(){
  const sid=read(STORE.session,null);
  return read(STORE.users,[]).find(u=>u.id===sid)||null;
}
function escapeHTML(v=''){
  return String(v).replace(/[&<>"']/g,m=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#039;'}[m]));
}
function initials(n='Usuário'){
  return n.split(/\s+/).filter(Boolean).slice(0,2).map(x=>x[0].toUpperCase()).join('');
}
function fmtDate(d){
  if(!d)return 'Não informada';
  const p=d.split('-'); return p.length===3?`${p[2]}/${p[1]}/${p[0]}`:d;
}
function today(){return new Date().toISOString().slice(0,10)}
function iconFor(cat){
  return {'Eletrônicos':'🎧','Documentos':'📄','Acessórios':'🔑','Material escolar':'📚','Roupas':'👕','Outros':'📦'}[cat]||'📦'
}
function statusClass(s){return s==='Reservado'?'reserved':s==='Devolvido'?'returned':'open'}
function statusbar(){return ``}
function normalizeText(v=''){
  return String(v).normalize('NFD').replace(/[\u0300-\u036f]/g,'').toLowerCase().replace(/[^a-z0-9\s]/g,' ');
}
function meaningfulWords(v=''){
  const stop=new Set(['de','da','do','das','dos','um','uma','com','sem','para','por','em','no','na','nos','nas','o','a','os','as','e']);
  return [...new Set(normalizeText(v).split(/\s+/).filter(w=>w.length>2&&!stop.has(w)))];
}
function matchScore(lostItem, foundItem){
  let score=0;
  if(lostItem.categoria===foundItem.categoria) score+=3;
  const a=meaningfulWords(`${lostItem.titulo} ${lostItem.descricao||''}`);
  const b=new Set(meaningfulWords(`${foundItem.titulo} ${foundItem.descricao||''}`));
  score += a.filter(w=>b.has(w)).length*2;
  if(lostItem.local && foundItem.local && normalizeText(lostItem.local)===normalizeText(foundItem.local)) score+=2;
  return score;
}
function bestMatch(lostItem){
  const candidates=read(STORE.items,[]).filter(i=>i.status!=='Devolvido').map(i=>({item:i,score:matchScore(lostItem,i)})).sort((a,b)=>b.score-a.score);
  return candidates[0]&&candidates[0].score>=3?candidates[0]:null;
}
function currentClaims(){
  const u=user(); if(!u)return [];
  return read(STORE.claims,[]).filter(c=>c.userId===u.id);
}
function notifications(){
  const u=user(); if(!u)return [];
  const list=[];
  read(STORE.lost,[]).filter(l=>l.userId===u.id).forEach(l=>{
    const m=bestMatch(l);
    if(m) list.push({type:'match',title:'Possível item encontrado',text:`${m.item.titulo} pode corresponder a “${l.titulo}”.`,itemId:m.item.id});
  });
  currentClaims().forEach(c=>{
    const item=read(STORE.items,[]).find(i=>i.id===c.itemId);
    if(item) list.push({type:'claim',title:'Solicitação registrada',text:`Sua solicitação para “${item.titulo}” está ${c.status.toLowerCase()}.`,itemId:item.id});
  });
  return list.slice(0,6);
}
function activeFilterCount(){return [state.filters.category,state.filters.status,state.filters.local].filter(Boolean).length}
function getDraft(type){return read(STORE.drafts,{found:{},lost:{}})[type]||{}}
function saveDraft(type,data){const d=read(STORE.drafts,{found:{},lost:{}});d[type]={...(d[type]||{}),...data};write(STORE.drafts,d)}
function clearDraft(type){const d=read(STORE.drafts,{found:{},lost:{}});d[type]={};write(STORE.drafts,d)}
function hashFor(route,itemId){return `#${route}${itemId?'/'+encodeURIComponent(itemId):''}`}
function parseHash(){
  const raw=(location.hash||'').replace(/^#/,''); if(!raw)return null;
  const [route,id]=raw.split('/'); return {route,itemId:id?decodeURIComponent(id):null};
}
function toast(msg){
  const el=document.getElementById('toast');
  el.textContent=msg; el.classList.add('show');
  clearTimeout(window.__toast); window.__toast=setTimeout(()=>el.classList.remove('show'),2200)
}
function categories(){return ['Eletrônicos','Documentos','Acessórios','Material escolar','Roupas','Outros']}
function optionsCats(){return categories().map(c=>`<option>${c}</option>`).join('')}
function avatarHTML(u,cls='avatar'){
  return `<div class="${cls}">${u.avatar?`<img src="${u.avatar}" alt="">`:initials(u.nome)}</div>`
}
function setRoute(route,params={},replace=false){
  state.route=route;
  if(params.itemId) state.selectedItem=params.itemId;
  const nextHash=hashFor(route,params.itemId||((route==='detail'||route==='rating')?state.selectedItem:null));
  if(location.hash!==nextHash){
    if(replace) history.replaceState({},'',nextHash); else history.pushState({},'',nextHash);
  }
  render();
  window.scrollTo({top:0,behavior:'instant'});
}
function authRoute(){return ['login','register','forgot'].includes(state.route)}
function render(){
  if(!user()&&!authRoute()) state.route='login';
  const map={login,register,forgot,home,found,lost,records,detail,rating,profile,editProfile,changePassword};
  (map[state.route]||login)();
  setupNav()
}
function setupNav(){
  const hide=!user()||authRoute()||['detail','rating','editProfile','changePassword'].includes(state.route);
  nav.classList.toggle('hidden',hide);
  nav.querySelectorAll('[data-route]').forEach(b=>{
    const active=b.dataset.route===state.route;
    b.classList.toggle('active',active);
    if(active)b.setAttribute('aria-current','page');else b.removeAttribute('aria-current');
    b.onclick=()=>setRoute(b.dataset.route)
  })
}
function passwordField(id,placeholder='••••••••'){
  return `<div class="password-wrap"><input id="${id}" class="control" type="password" placeholder="${placeholder}"><button class="password-eye" type="button" data-eye="${id}">◉</button></div>`
}
function bindEyes(){
  document.querySelectorAll('[data-eye]').forEach(b=>b.onclick=()=>{
    const i=document.getElementById(b.dataset.eye);
    i.type=i.type==='password'?'text':'password';
    b.textContent=i.type==='password'?'◉':'◎'
  })
}

function login(){
  app.innerHTML=`
  <section class="screen white no-nav">
    ${statusbar()}
    <div class="logo">⌑</div>
    <h1>Achados & Perdidos</h1>
    <div class="campus">Fatec Taquaritinga</div>
    <p class="subtitle" style="margin-bottom:17px">Entre para registrar itens encontrados ou procurar algo que você perdeu no campus.</p>
    <div class="field"><label>E-mail</label><input id="loginEmail" class="control" type="email" placeholder="seu@email.com"></div>
    <div class="field"><label>Senha</label>${passwordField('loginPass')}</div>
    <div class="row between" style="font-size:9px;margin:4px 0 14px"><label class="row" style="gap:5px"><input type="checkbox"> Lembrar de mim</label><span class="link" id="forgotLink">Esqueci minha senha</span></div>
    <button class="btn" id="loginBtn">Entrar</button>
    <div class="auth-foot">Não tem conta? <span class="link" id="regLink">Cadastre-se</span></div>
    <div class="notice" style="margin-top:20px"><b>Acesso rápido para apresentação</b><br>ana.rocha@fatec.sp.gov.br • senha 1234</div>
  </section>`;
  bindEyes();
  document.getElementById('loginBtn').onclick=()=>{
    const email=document.getElementById('loginEmail').value.trim().toLowerCase();
    const senha=document.getElementById('loginPass').value;
    const u=read(STORE.users,[]).find(x=>x.email.toLowerCase()===email&&x.senha===senha);
    if(!u)return toast('E-mail ou senha inválidos.');
    write(STORE.session,u.id); setRoute('home'); toast('Login realizado com sucesso.')
  };
  document.getElementById('regLink').onclick=()=>setRoute('register');
  document.getElementById('forgotLink').onclick=()=>setRoute('forgot');
  document.getElementById('loginPass').addEventListener('keydown',e=>{if(e.key==='Enter')document.getElementById('loginBtn').click()})
}

function register(){
  app.innerHTML=`
  <section class="screen white no-nav">
    ${statusbar()}
    <div class="topbar"><button class="icon-btn" id="back">‹</button><h2>Criar conta</h2><span></span></div>
    <p class="subtitle" style="margin-bottom:13px">Preencha seus dados para acessar o sistema de achados e perdidos da Fatec.</p>
    <div class="field"><label>Nome completo</label><input id="regName" class="control" placeholder="Seu nome completo"></div>
    <div class="field"><label>E-mail</label><input id="regEmail" class="control" type="email" placeholder="seu@email.com"></div>
    <div class="field"><label>Telefone</label><input id="regPhone" class="control" placeholder="(16) 99999-9999"></div>
    <div class="grid2"><div class="field"><label>Curso</label><input id="regCourse" class="control" value="ADS"></div><div class="field"><label>Campus</label><input id="regCampus" class="control" value="Fatec Taquaritinga"></div></div>
    <div class="field"><label>Senha</label>${passwordField('regPass','Mínimo 4 caracteres')}<div class="progress"><span id="strength" style="width:0%"></span></div></div>
    <div class="field"><label>Confirmar senha</label>${passwordField('regConfirm','Repita a senha')}</div>
    <label class="checkrow"><input id="terms" type="checkbox"><span>Li e aceito os Termos de uso e a Política de privacidade.</span></label>
    <button class="btn" id="createAccount" style="margin-top:13px">Criar conta</button>
    <div class="auth-foot">Já tem conta? <span class="link" id="loginLink">Entrar</span></div>
  </section>`;
  bindEyes();
  document.getElementById('back').onclick=document.getElementById('loginLink').onclick=()=>setRoute('login');
  document.getElementById('regPass').oninput=e=>document.getElementById('strength').style.width=`${Math.min(100,e.target.value.length*18)}%`;
  document.getElementById('createAccount').onclick=()=>{
    const nome=document.getElementById('regName').value.trim();
    const email=document.getElementById('regEmail').value.trim().toLowerCase();
    const senha=document.getElementById('regPass').value;
    if(!nome||!email||!senha)return toast('Preencha nome, e-mail e senha.');
    if(!email.includes('@'))return toast('Digite um e-mail válido.');
    if(senha.length<4)return toast('A senha precisa ter pelo menos 4 caracteres.');
    if(senha!==document.getElementById('regConfirm').value)return toast('As senhas não conferem.');
    if(!document.getElementById('terms').checked)return toast('Aceite os termos para continuar.');
    const users=read(STORE.users,[]);
    if(users.some(u=>u.email.toLowerCase()===email))return toast('Esse e-mail já está cadastrado.');
    const u={id:'u'+Date.now(),nome,email,telefone:document.getElementById('regPhone').value.trim(),senha,curso:document.getElementById('regCourse').value.trim(),campus:document.getElementById('regCampus').value.trim(),avatar:null};
    users.push(u); write(STORE.users,users); write(STORE.session,u.id);
    setRoute('home'); toast('Conta criada com sucesso.')
  }
}

function forgot(){
  app.innerHTML=`
  <section class="screen white no-nav">
    ${statusbar()}
    <div class="topbar"><button class="icon-btn" id="back">×</button><h2>Recuperar senha</h2><span></span></div>
    <div class="logo" style="background:#fff0f0;color:var(--red)">♧</div>
    <h2>Esqueceu sua senha?</h2>
    <p class="subtitle" style="margin-bottom:16px">Informe o e-mail cadastrado. Nesta versão acadêmica, a senha é exibida apenas para demonstração.</p>
    <div class="field"><label>E-mail cadastrado</label><input id="forgotEmail" class="control" type="email"></div>
    <button class="btn" id="recover">Recuperar senha</button>
    <div class="notice success" style="margin-top:13px">Nenhum e-mail real é enviado neste protótipo.</div>
  </section>`;
  document.getElementById('back').onclick=()=>setRoute('login');
  document.getElementById('recover').onclick=()=>{
    const e=document.getElementById('forgotEmail').value.trim().toLowerCase();
    const u=read(STORE.users,[]).find(x=>x.email.toLowerCase()===e);
    if(!u)return toast('E-mail não encontrado.');
    alert(`Protótipo acadêmico\n\nSenha cadastrada: ${u.senha}\n\nEm produção, seria enviado um link de recuperação.`)
  }
}

function home(){
  const u=user();
  const notes=notifications();
  const filterCount=activeFilterCount();
  app.innerHTML=`
  <section class="screen page-enter">
    <div class="home-head premium-head">
      <div class="row">${avatarHTML(u)}<div class="greet"><strong>Olá, ${escapeHTML(u.nome.split(' ')[0])}</strong><span class="tiny muted">Encontrou ou perdeu algo hoje?</span></div></div>
      <button class="icon-btn notification-btn" id="bell" aria-label="Notificações">♢${notes.length?`<span class="notify-dot">${notes.length}</span>`:''}</button>
    </div>
    <div class="search-row"><div class="search-box"><span>⌕</span><input id="search" class="control" value="${escapeHTML(state.lastSearch)}" placeholder="Buscar por palavra-chave"></div><button class="filter-btn" id="filters" aria-label="Filtros">☷${filterCount?`<span class="filter-count">${filterCount}</span>`:''}</button></div>
    <div class="quick-grid">
      <button class="quick-card red" id="foundBtn"><span class="qicon">＋</span><span><b>Encontrei um item</b><small>Registrar achado</small></span></button>
      <button class="quick-card dark" id="lostBtn"><span class="qicon">⌕</span><span><b>Perdi um item</b><small>Abrir solicitação</small></span></button>
    </div>
    ${renderMatchBanner()}
    <div class="chips" id="categoryChips">${['Todos',...categories().slice(0,5)].map(c=>`<button class="chip ${state.category===c?'active':''}" data-cat="${c}">${c}</button>`).join('')}</div>
    <div class="section-head"><h3>Itens encontrados recentemente</h3><span class="tiny muted" id="resultCount"></span></div>
    <div id="itemList" class="item-list"></div>
  </section>`;
  document.getElementById('foundBtn').onclick=()=>setRoute('found');
  document.getElementById('lostBtn').onclick=()=>setRoute('lost');
  document.getElementById('filters').onclick=openFilters;
  document.getElementById('search').oninput=e=>{state.lastSearch=e.target.value;renderItems()};
  document.getElementById('bell').onclick=openNotifications;
  document.querySelectorAll('[data-cat]').forEach(b=>b.onclick=()=>{state.category=b.dataset.cat;home()});
  document.querySelectorAll('[data-match-item]').forEach(b=>b.onclick=()=>setRoute('detail',{itemId:b.dataset.matchItem}));
  renderItems()
}
function renderMatchBanner(){
  const u=user(); if(!u)return '';
  const lost=read(STORE.lost,[]).filter(l=>l.userId===u.id);
  for(const l of lost){
    const m=bestMatch(l);
    if(m) return `<button class="match-banner" data-match-item="${m.item.id}"><span class="match-icon">✦</span><span><b>Encontramos uma possível correspondência</b><small>${escapeHTML(m.item.titulo)} pode ser o seu item perdido.</small></span><span class="match-arrow">›</span></button>`;
  }
  return '';
}
function openNotifications(){
  const notes=notifications();
  modalRoot.innerHTML=`<div class="modal-backdrop" id="notesBackdrop"><div class="sheet"><div class="handle"></div><div class="sheet-head"><div><h3>Notificações</h3><div class="tiny muted">Atualizações importantes dos seus registros</div></div><button class="icon-btn flat" id="closeNotes">×</button></div>${notes.length?`<div class="notification-list">${notes.map((n,idx)=>`<button class="notification-card" data-note-item="${n.itemId}"><span class="note-icon">${n.type==='match'?'✦':'✓'}</span><span><b>${escapeHTML(n.title)}</b><small>${escapeHTML(n.text)}</small></span><span>›</span></button>`).join('')}</div>`:`<div class="empty"><div class="big">♢</div>Nenhuma notificação no momento.</div>`}</div></div>`;
  document.getElementById('closeNotes').onclick=closeModal;
  document.getElementById('notesBackdrop').onclick=e=>{if(e.target.id==='notesBackdrop')closeModal()};
  document.querySelectorAll('[data-note-item]').forEach(b=>b.onclick=()=>{closeModal();setRoute('detail',{itemId:b.dataset.noteItem})});
}

function thumb(i){return i.photos?.[0]?`<img src="${i.photos[0]}" alt="Foto de ${escapeHTML(i.titulo)}" loading="lazy">`:iconFor(i.categoria)}
function filteredItems(){
  const q=(document.getElementById('search')?.value||'').trim().toLowerCase();
  return read(STORE.items,[]).filter(i=>{
    const search=!q||`${i.titulo} ${i.descricao} ${i.local} ${i.categoria}`.toLowerCase().includes(q);
    const cat=state.category==='Todos'||i.categoria===state.category;
    const fcat=!state.filters.category||i.categoria===state.filters.category;
    const fstatus=!state.filters.status||i.status===state.filters.status;
    const flocal=!state.filters.local||i.local.toLowerCase().includes(state.filters.local.toLowerCase());
    return search&&cat&&fcat&&fstatus&&flocal
  })
}
function renderItems(){
  const el=document.getElementById('itemList'); if(!el)return;
  const items=filteredItems();
  const count=document.getElementById('resultCount');if(count)count.textContent=`${items.length} ${items.length===1?'item':'itens'}`;
  el.innerHTML=items.length?items.map(i=>`
  <article class="item-card clickable" data-item="${i.id}">
    <div class="item-thumb">${thumb(i)}</div>
    <div>
      <div class="row between"><span class="tiny muted">${escapeHTML(i.categoria)}</span><span class="badge ${statusClass(i.status)}">${i.status}</span></div>
      <div class="item-title">${escapeHTML(i.titulo)}</div>
      <div class="item-meta">⌖ ${escapeHTML(i.local)} &nbsp; ▣ ${fmtDate(i.data)}</div>
    </div>
  </article>`).join(''):`<div class="empty"><div class="big">⌕</div>Nenhum item encontrado.</div>`;
  document.querySelectorAll('[data-item]').forEach(x=>x.onclick=()=>setRoute('detail',{itemId:x.dataset.item}))
}

function openFilters(){
  modalRoot.innerHTML=`
  <div class="modal-backdrop" id="filterBackdrop">
    <div class="sheet">
      <div class="handle"></div>
      <div class="sheet-head"><h3>Filtros</h3><span class="link tiny" id="clear">Limpar tudo</span></div>
      <div class="filter-block"><strong>Categoria</strong><div class="filter-wrap" id="filterCats">${['Todas',...categories()].map(c=>`<button class="chip ${(c==='Todas'&&!state.filters.category)||state.filters.category===c?'active':''}" data-fcat="${c}">${c}</button>`).join('')}</div></div>
      <div class="filter-block"><strong>Status</strong><div class="filter-wrap" id="filterStatus">${['Em aberto','Reservado','Devolvido'].map(s=>`<button class="chip ${state.filters.status===s?'active':''}" data-fstatus="${s}">${s}</button>`).join('')}</div></div>
      <div class="field"><label>Local</label><input id="filterLocal" class="control" value="${escapeHTML(state.filters.local)}" placeholder="Todos os locais"></div>
      <div class="grid2"><button class="btn secondary" id="cancelFilters">Cancelar</button><button class="btn" id="applyFilters">Aplicar filtros</button></div>
    </div>
  </div>`;
  document.querySelectorAll('[data-fcat]').forEach(b=>b.onclick=()=>{
    document.querySelectorAll('[data-fcat]').forEach(x=>x.classList.remove('active'));
    b.classList.add('active'); state.filters.category=b.dataset.fcat==='Todas'?null:b.dataset.fcat
  });
  document.querySelectorAll('[data-fstatus]').forEach(b=>b.onclick=()=>{
    const active=b.classList.contains('active');
    document.querySelectorAll('[data-fstatus]').forEach(x=>x.classList.remove('active'));
    state.filters.status=null;
    if(!active){b.classList.add('active');state.filters.status=b.dataset.fstatus}
  });
  document.getElementById('clear').onclick=()=>{state.filters={category:null,status:null,local:''};closeModal();renderItems()};
  document.getElementById('cancelFilters').onclick=closeModal;
  document.getElementById('applyFilters').onclick=()=>{state.filters.local=document.getElementById('filterLocal').value.trim();closeModal();renderItems()};
  document.getElementById('filterBackdrop').onclick=e=>{if(e.target.id==='filterBackdrop')closeModal()}
}
function closeModal(){modalRoot.innerHTML=''}

function found(){
  const draft=getDraft('found');
  state.photos=Array.isArray(draft.photos)?draft.photos:[];
  app.innerHTML=`
  <section class="screen page-enter">
    <div class="topbar"><button class="icon-btn" id="back">×</button><h2>Registrar item encontrado</h2><span></span></div>
    <div class="form-progress"><span></span><span></span><span></span></div>
    <div class="upload-zone">
      <div class="upload-head"><div><b class="small">Fotos do item</b><div class="tiny muted">Até 3 fotos. Elas são comprimidas automaticamente.</div></div><span id="photoCount" class="tiny muted">${state.photos.length}/3</span></div>
      <div class="photo-grid" id="photoGrid"></div>
    </div>
    <div class="field"><label>Título do item</label><input id="fTitle" class="control" maxlength="60" value="${escapeHTML(draft.titulo||'')}" placeholder="Ex.: Fone de ouvido sem fio"><div class="field-hint"><span>Seja objetivo</span><span id="titleCount">${(draft.titulo||'').length}/60</span></div></div>
    <div class="field"><label>Descrição</label><textarea id="fDesc" class="control" maxlength="240" placeholder="Cor, marca, estado e outros detalhes">${escapeHTML(draft.descricao||'')}</textarea><div class="field-hint"><span>Detalhes ajudam na identificação</span><span id="descCount">${(draft.descricao||'').length}/240</span></div></div>
    <div class="grid2"><div class="field"><label>Categoria</label><select id="fCat" class="control">${optionsCats()}</select></div><div class="field"><label>Data do encontro</label><input id="fDate" class="control" type="date" value="${draft.data||today()}"></div></div>
    <div class="field"><label>Local onde foi encontrado</label><input id="fLocal" class="control" value="${escapeHTML(draft.local||'')}" placeholder="Ex.: Laboratório de Informática 3"></div>
    <div class="field"><label>Onde o item está agora?</label><select id="fDest" class="control"><option>Entreguei na Fatec</option><option>Está comigo</option></select></div>
    <div class="draft-status">✓ Rascunho salvo automaticamente neste dispositivo</div>
    <button id="publish" class="btn" style="margin-top:11px">Publicar registro</button>
  </section>`;
  if(draft.categoria)document.getElementById('fCat').value=draft.categoria;
  if(draft.destino)document.getElementById('fDest').value=draft.destino;
  document.getElementById('back').onclick=()=>setRoute('home');
  renderPhotoGrid();
  bindFoundDraft();
  document.getElementById('publish').onclick=saveFound
}
function bindFoundDraft(){
  const ids=['fTitle','fDesc','fCat','fDate','fLocal','fDest'];
  const save=()=>saveDraft('found',{titulo:document.getElementById('fTitle').value,descricao:document.getElementById('fDesc').value,categoria:document.getElementById('fCat').value,data:document.getElementById('fDate').value,local:document.getElementById('fLocal').value,destino:document.getElementById('fDest').value,photos:[...state.photos]});
  ids.forEach(id=>document.getElementById(id).addEventListener('input',save));
  document.getElementById('fTitle').addEventListener('input',e=>document.getElementById('titleCount').textContent=`${e.target.value.length}/60`);
  document.getElementById('fDesc').addEventListener('input',e=>document.getElementById('descCount').textContent=`${e.target.value.length}/240`);
}

async function handlePhotos(files){
  for(const f of [...files]){
    if(state.photos.length>=3)break;
    if(!f.type.startsWith('image/'))continue;
    try{state.photos.push(await compressImage(f,640,.60))}
    catch(e){toast('Não foi possível processar uma foto.')}
  }
  renderPhotoGrid();saveDraft('found',{photos:[...state.photos]})
}
function compressImage(file,max=760,quality=.64){
  return new Promise((res,rej)=>{
    const r=new FileReader();
    r.onload=()=>{
      const img=new Image();
      img.onload=()=>{
        let w=img.width,h=img.height,scale=Math.min(1,max/Math.max(w,h));
        w=Math.round(w*scale);h=Math.round(h*scale);
        const c=document.createElement('canvas');c.width=w;c.height=h;
        c.getContext('2d').drawImage(img,0,0,w,h);
        res(c.toDataURL('image/jpeg',quality))
      };
      img.onerror=rej; img.src=r.result
    };
    r.onerror=rej;r.readAsDataURL(file)
  })
}
function renderPhotoGrid(){
  const grid=document.getElementById('photoGrid');if(!grid)return;
  grid.innerHTML=state.photos.map((p,i)=>`<div class="photo-slot"><img src="${p}" alt=""><button class="remove-photo" data-rm="${i}">×</button></div>`).join('')+(state.photos.length<3?`<label class="upload-button"><span>▧</span><b>Adicionar</b><input id="photoInput2" hidden type="file" accept="image/*" capture="environment" multiple></label>`:'');
  document.getElementById('photoCount').textContent=`${state.photos.length}/3`;
  document.querySelectorAll('[data-rm]').forEach(b=>b.onclick=e=>{e.preventDefault();state.photos.splice(+b.dataset.rm,1);renderPhotoGrid();saveDraft('found',{photos:[...state.photos]})});
  const inp=document.getElementById('photoInput2');if(inp)inp.onchange=e=>handlePhotos(e.target.files)
}
function saveFound(){
  const title=document.getElementById('fTitle').value.trim(),local=document.getElementById('fLocal').value.trim();
  if(!title)return toast('Informe o título do item.');
  if(!local)return toast('Informe o local onde foi encontrado.');
  const items=read(STORE.items,[]);
  const item={id:'i'+Date.now(),ownerId:user().id,titulo:title,descricao:document.getElementById('fDesc').value.trim(),categoria:document.getElementById('fCat').value,data:document.getElementById('fDate').value||today(),local,destino:document.getElementById('fDest').value,status:'Em aberto',photos:[...state.photos],createdAt:new Date().toISOString()};
  try{items.unshift(item);write(STORE.items,items)}
  catch(e){return toast('Armazenamento cheio. Remova uma foto e tente novamente.')}
  clearDraft('found');state.photos=[];state.selectedItem=item.id; setRoute('detail',{itemId:item.id}); toast('Item publicado com sucesso.')
}

function lost(){
  const draft=getDraft('lost');
  app.innerHTML=`
  <section class="screen page-enter">
    <div class="topbar"><button class="icon-btn" id="back">‹</button><h2>Registrar item perdido</h2><span></span></div>
    <div class="notice info-strong"><b>Quanto mais detalhes, melhor.</b><br>O sistema compara seu registro com itens encontrados e pode sugerir correspondências.</div>
    <div class="field" style="margin-top:11px"><label>O que você perdeu?</label><input id="lTitle" class="control" maxlength="60" value="${escapeHTML(draft.titulo||'')}" placeholder="Ex.: Chave de carro vermelha"></div>
    <div class="field"><label>Descrição</label><textarea id="lDesc" class="control" maxlength="240" placeholder="Cor, marca, adesivos ou qualquer detalhe">${escapeHTML(draft.descricao||'')}</textarea></div>
    <div class="grid2"><div class="field"><label>Categoria</label><select id="lCat" class="control">${optionsCats()}</select></div><div class="field"><label>Data aproximada</label><input id="lDate" class="control" type="date" value="${draft.data||today()}"></div></div>
    <div class="field"><label>Onde acha que perdeu? (opcional)</label><input id="lLocal" class="control" value="${escapeHTML(draft.local||'')}" placeholder="Ex.: Estacionamento"></div>
    <div class="card row between" style="margin-bottom:10px"><div><b class="small">Compartilhar meu contato</b><div class="tiny muted">Permite que a equipe fale com você.</div></div><button id="contactSwitch" class="switch ${draft.compartilharContato===false?'':'on'}"></button></div>
    <div class="draft-status">✓ Rascunho salvo automaticamente neste dispositivo</div>
    <button id="saveLost" class="btn" style="margin-top:10px">Registrar solicitação</button>
  </section>`;
  if(draft.categoria)document.getElementById('lCat').value=draft.categoria;
  document.getElementById('back').onclick=()=>setRoute('home');
  document.getElementById('contactSwitch').onclick=e=>{e.currentTarget.classList.toggle('on');saveLostDraft()};
  ['lTitle','lDesc','lCat','lDate','lLocal'].forEach(id=>document.getElementById(id).addEventListener('input',saveLostDraft));
  document.getElementById('saveLost').onclick=()=>{
    const t=document.getElementById('lTitle').value.trim();
    if(!t)return toast('Informe o item que você perdeu.');
    const arr=read(STORE.lost,[]);
    const item={id:'l'+Date.now(),userId:user().id,titulo:t,descricao:document.getElementById('lDesc').value.trim(),categoria:document.getElementById('lCat').value,data:document.getElementById('lDate').value,local:document.getElementById('lLocal').value.trim(),compartilharContato:document.getElementById('contactSwitch').classList.contains('on'),status:'Em aberto',createdAt:new Date().toISOString()};
    arr.unshift(item);write(STORE.lost,arr);clearDraft('lost');
    const m=bestMatch(item);
    setRoute('records');toast(m?'Solicitação registrada. Encontramos uma possível correspondência!':'Solicitação registrada.')
  }
}
function saveLostDraft(){
  saveDraft('lost',{titulo:document.getElementById('lTitle').value,descricao:document.getElementById('lDesc').value,categoria:document.getElementById('lCat').value,data:document.getElementById('lDate').value,local:document.getElementById('lLocal').value,compartilharContato:document.getElementById('contactSwitch').classList.contains('on')})
}

function detail(){
  const i=read(STORE.items,[]).find(x=>x.id===state.selectedItem);
  if(!i)return setRoute('home');
  const photos=i.photos||[];
  const myClaim=currentClaims().find(c=>c.itemId===i.id);
  app.innerHTML=`
  <section class="screen no-nav" style="padding-bottom:82px">
    ${statusbar()}
    <div class="detail-hero">
      ${photos[0]?`<img id="heroImage" class="zoomable" src="${photos[0]}" alt="Foto de ${escapeHTML(i.titulo)}">`:`<div class="detail-placeholder">${iconFor(i.categoria)}</div>`}
      <div class="hero-actions"><button id="back" class="icon-btn">‹</button><button id="share" class="icon-btn">↗</button></div>
      ${photos.length>1?`<div class="dots">${photos.map((_,idx)=>`<span class="dot ${idx===0?'active':''}" data-dot="${idx}"></span>`).join('')}</div>`:''}
    </div>
    <div class="row between"><span class="badge ${statusClass(i.status)}">${i.status}</span><span class="tiny muted">Código #${i.id.slice(-6).toUpperCase()}</span></div>
    <h2 style="margin-top:8px">${escapeHTML(i.titulo)}</h2>
    <p class="subtitle" style="margin-bottom:11px">${escapeHTML(i.descricao||'Sem descrição informada.')}</p>
    <div class="card detail-info">
      <div class="info-row">◈ Categoria<br><b>${escapeHTML(i.categoria)}</b></div>
      <div class="info-row">⌖ Local onde foi encontrado<br><b>${escapeHTML(i.local)}</b></div>
      <div class="info-row">▣ Data do encontro<br><b>${fmtDate(i.data)}</b></div>
    </div>
    <div class="notice success" style="margin-top:9px"><b>Onde o item está agora</b><br>${escapeHTML(i.destino)}</div>
    ${myClaim?`<div class="claim-status"><span>✓</span><div><b>Solicitação enviada</b><small>Status: ${escapeHTML(myClaim.status)}</small></div></div>`:''}
  </section>
  <div class="sticky"><button id="claim" class="btn" ${(i.status==='Devolvido'||myClaim)?'disabled':''}>${i.status==='Devolvido'?'Item já devolvido':myClaim?'Solicitação em análise':'Este item é meu'}</button></div>`;
  document.getElementById('back').onclick=()=>setRoute('home');
  document.getElementById('share').onclick=async()=>{
    const text=`${i.titulo} - encontrado em ${i.local}`;
    if(navigator.share){try{await navigator.share({title:'Achados & Perdidos',text})}catch(e){}}
    else{navigator.clipboard?.writeText(text);toast('Informações copiadas.')}
  };
  const claim=document.getElementById('claim');
  if(!claim.disabled)claim.onclick=()=>openClaimModal(i);
  const hero=document.getElementById('heroImage');if(hero)hero.onclick=()=>openLightbox(photos,state.heroIndex||0);
  document.querySelectorAll('[data-dot]').forEach(d=>d.onclick=()=>{
    state.heroIndex=+d.dataset.dot;document.getElementById('heroImage').src=photos[state.heroIndex];
    document.querySelectorAll('.dot').forEach(x=>x.classList.remove('active'));d.classList.add('active')
  })
}
function openClaimModal(item){
  const u=user();
  modalRoot.innerHTML=`<div class="modal-backdrop" id="claimBackdrop"><div class="sheet"><div class="handle"></div><div class="sheet-head"><div><h3>Confirmar que o item é seu</h3><div class="tiny muted">A equipe poderá usar estes dados para conferir a propriedade.</div></div><button class="icon-btn flat" id="closeClaim">×</button></div><div class="claim-preview"><div class="item-thumb">${thumb(item)}</div><div><b>${escapeHTML(item.titulo)}</b><small>${escapeHTML(item.local)} · ${fmtDate(item.data)}</small></div></div><div class="field"><label>Conte um detalhe que só o dono saberia</label><textarea id="claimProof" class="control" maxlength="200" placeholder="Ex.: possui um risco no lado esquerdo, chave reserva em casa..."></textarea></div><div class="field"><label>Contato para retorno</label><input id="claimContact" class="control" value="${escapeHTML(u.telefone||u.email)}"></div><div class="notice warning">O item ficará reservado enquanto a solicitação estiver em análise.</div><div class="grid2" style="margin-top:10px"><button class="btn secondary" id="cancelClaim">Cancelar</button><button class="btn" id="sendClaim">Enviar solicitação</button></div></div></div>`;
  document.getElementById('closeClaim').onclick=document.getElementById('cancelClaim').onclick=closeModal;
  document.getElementById('claimBackdrop').onclick=e=>{if(e.target.id==='claimBackdrop')closeModal()};
  document.getElementById('sendClaim').onclick=()=>{
    const proof=document.getElementById('claimProof').value.trim();
    if(proof.length<5)return toast('Informe um detalhe para ajudar na conferência.');
    const claims=read(STORE.claims,[]);claims.push({id:'c'+Date.now(),itemId:item.id,userId:u.id,proof,contact:document.getElementById('claimContact').value.trim(),status:'Em análise',createdAt:new Date().toISOString()});write(STORE.claims,claims);
    const items=read(STORE.items,[]),target=items.find(x=>x.id===item.id);if(target){target.status='Reservado';target.claimedBy=u.id;write(STORE.items,items)}
    closeModal();detail();toast('Solicitação enviada para conferência.')
  }
}
function openLightbox(photos,index=0){
  if(!photos?.length)return;
  let current=index;
  const draw=()=>{modalRoot.innerHTML=`<div class="lightbox" id="lightbox"><button class="lightbox-close" id="lightboxClose">×</button><img src="${photos[current]}" alt="Foto ampliada"><div class="lightbox-count">${current+1} / ${photos.length}</div>${photos.length>1?`<button class="lightbox-nav prev" id="lightPrev">‹</button><button class="lightbox-nav next" id="lightNext">›</button>`:''}</div>`;document.getElementById('lightboxClose').onclick=closeModal;document.getElementById('lightbox').onclick=e=>{if(e.target.id==='lightbox')closeModal()};if(photos.length>1){document.getElementById('lightPrev').onclick=()=>{current=(current-1+photos.length)%photos.length;draw()};document.getElementById('lightNext').onclick=()=>{current=(current+1)%photos.length;draw()}}};draw()
}

function records(){
  const u=user();
  const foundItems=read(STORE.items,[]).filter(i=>i.ownerId===u.id);
  const lostItems=read(STORE.lost,[]).filter(i=>i.userId===u.id);
  let body='';
  if(state.recordTab==='Todos'||state.recordTab==='Encontrei') body+=foundItems.map(foundCard).join('');
  if(state.recordTab==='Todos'||state.recordTab==='Perdi') body+=lostItems.map(lostCard).join('');
  app.innerHTML=`
  <section class="screen">
    ${statusbar()}
    <div class="home-head"><h2>Meus registros</h2><button class="icon-btn">☷</button></div>
    <div class="segment">${['Todos','Encontrei','Perdi'].map(t=>`<button class="${state.recordTab===t?'active':''}" data-tab="${t}">${t}</button>`).join('')}</div>
    <div>${body||`<div class="empty"><div class="big">▤</div>Nenhum registro por aqui.</div>`}</div>
  </section>`;
  document.querySelectorAll('[data-tab]').forEach(b=>b.onclick=()=>{state.recordTab=b.dataset.tab;records()});
  document.querySelectorAll('[data-detail]').forEach(b=>b.onclick=()=>setRoute('detail',{itemId:b.dataset.detail}));
  document.querySelectorAll('[data-rate]').forEach(b=>b.onclick=()=>{state.selectedItem=b.dataset.rate;setRoute('rating')});
  document.querySelectorAll('[data-delete-found]').forEach(b=>b.onclick=()=>deleteFound(b.dataset.deleteFound));
  document.querySelectorAll('[data-delete-lost]').forEach(b=>b.onclick=()=>deleteLost(b.dataset.deleteLost))
}
function foundCard(i){
  return `<div class="card record-card">
    <div class="row"><div class="item-thumb">${thumb(i)}</div><div style="flex:1;min-width:0"><div class="tiny muted">Você encontrou</div><div class="item-title">${escapeHTML(i.titulo)}</div><div class="item-meta">${escapeHTML(i.local)} · ${fmtDate(i.data)}</div></div><span class="badge ${statusClass(i.status)}">${i.status}</span></div>
    <div class="record-actions"><span>${i.destino==='Entreguei na Fatec'?'▣ Entregue à Fatec':'○ Está com você'}</span><span>
      ${i.status==='Devolvido'?`<span class="link" data-rate="${i.id}">Avaliar</span>`:`<span class="link" data-detail="${i.id}">Detalhes</span>`}
      &nbsp; <span class="link" data-delete-found="${i.id}">Excluir</span>
    </span></div>
  </div>`
}
function lostCard(i){
  const m=bestMatch(i);
  return `<div class="card record-card">
    <div class="row"><div class="item-thumb">${iconFor(i.categoria)}</div><div style="flex:1;min-width:0"><div class="tiny muted">Você perdeu</div><div class="item-title">${escapeHTML(i.titulo)}</div><div class="item-meta">${escapeHTML(i.local||'Local não informado')} · ${fmtDate(i.data)}</div></div><span class="badge open">${i.status}</span></div>
    ${m?`<button class="inline-match" data-detail="${m.item.id}"><span>✦</span><span><b>Possível correspondência</b><small>${escapeHTML(m.item.titulo)} · ${escapeHTML(m.item.local)}</small></span><span>›</span></button>`:''}
    <div class="record-actions"><span>${i.compartilharContato?'Contato compartilhado':'Contato privado'}</span><span class="link" data-delete-lost="${i.id}">Excluir</span></div>
  </div>`
}
function deleteFound(id){
  if(!confirm('Excluir este registro encontrado?'))return;
  write(STORE.items,read(STORE.items,[]).filter(i=>i.id!==id));records();toast('Registro excluído.')
}
function deleteLost(id){
  if(!confirm('Excluir esta solicitação de item perdido?'))return;
  write(STORE.lost,read(STORE.lost,[]).filter(i=>i.id!==id));records();toast('Solicitação excluída.')
}

function rating(){
  const i=read(STORE.items,[]).find(x=>x.id===state.selectedItem);
  if(!i)return setRoute('records');
  app.innerHTML=`
  <section class="screen no-nav">
    ${statusbar()}
    <div class="topbar"><button id="back" class="icon-btn">‹</button><h2>Avaliar devolução</h2><span></span></div>
    <div class="card"><div class="row"><div class="item-thumb">${thumb(i)}</div><div><b class="small">${escapeHTML(i.titulo)}</b><div class="tiny muted">${escapeHTML(i.local)} · ${fmtDate(i.data)}</div></div></div></div>
    <div class="card" style="margin-top:9px;text-align:center"><h3>Como foi o processo de devolução?</h3><div class="star-row">${[1,2,3,4,5].map(n=>`<button class="star ${n<=state.rating?'on':''}" data-star="${n}">★</button>`).join('')}</div><div class="small" style="color:#b36b00">${['','Muito ruim','Ruim','Bom','Muito bom','Excelente'][state.rating]}</div></div>
    <div class="field" style="margin-top:11px"><label>Comentário (opcional)</label><textarea id="comment" class="control" placeholder="Conte como foi o atendimento"></textarea></div>
    <button id="sendRating" class="btn">Enviar avaliação</button>
  </section>`;
  document.getElementById('back').onclick=()=>setRoute('records');
  document.querySelectorAll('[data-star]').forEach(b=>b.onclick=()=>{state.rating=+b.dataset.star;rating()});
  document.getElementById('sendRating').onclick=()=>{
    const arr=read(STORE.ratings,[]);arr.push({id:'r'+Date.now(),itemId:i.id,userId:user().id,nota:state.rating,comentario:document.getElementById('comment').value.trim(),createdAt:new Date().toISOString()});write(STORE.ratings,arr);setRoute('records');toast('Avaliação enviada. Obrigado!')
  }
}

function profile(){
  const u=user();
  const foundCount=read(STORE.items,[]).filter(i=>i.ownerId===u.id);
  const lostCount=read(STORE.lost,[]).filter(i=>i.userId===u.id);
  const settings=read(STORE.settings,{notifications:true});
  const used = new Blob(Object.values(localStorage)).size;
  const pct=Math.min(100,Math.round(used/5000000*100));
  app.innerHTML=`
  <section class="screen">
    ${statusbar()}
    <div class="home-head"><h2>Perfil</h2><button id="edit" class="icon-btn">✎</button></div>
    <div class="card profile-card">${avatarHTML(u,'profile-avatar')}<div><b class="small">${escapeHTML(u.nome)}</b><div class="tiny muted">${escapeHTML(u.email)}</div><div class="tiny link" style="margin-top:3px">${escapeHTML(u.curso||'Aluno')} • ${escapeHTML(u.campus||'Fatec')}</div></div></div>
    <div class="stats"><div class="stat"><b>${foundCount.length}</b><small>Encontrados</small></div><div class="stat"><b>${lostCount.length}</b><small>Perdidos</small></div><div class="stat"><b>${foundCount.filter(i=>i.status==='Devolvido').length}</b><small>Devolvidos</small></div></div>
    <div class="menu">
      <button id="personal">♙ &nbsp; Dados pessoais</button>
      <button id="changePass">♧ &nbsp; Alterar senha</button>
      <button id="notifications" class="row between"><span>♢ &nbsp; Notificações</span><span class="switch ${settings.notifications?'on':''}"></span></button>
      <button id="ratings">☆ &nbsp; Minhas avaliações</button>
      <button id="help">ⓘ &nbsp; Ajuda e termos de uso</button>
    </div>

    <div class="demo-tools">
      <h3>Ferramentas da apresentação</h3>
      <div class="tiny muted">Uso estimado do armazenamento local: ${pct}%</div>
      <div class="storage-bar"><span style="width:${pct}%"></span></div>
      <div class="grid2" style="margin-top:9px">
        <button class="btn secondary" id="exportData">Exportar backup</button>
        <label class="btn secondary" style="display:grid;place-items:center;cursor:pointer">Importar backup<input id="importData" type="file" accept="application/json" hidden></label>
      </div>
      <div class="grid2" style="margin-top:8px">
        <button class="btn secondary" id="simulateReturn">Simular devolução</button>
        <button class="btn secondary" id="installApp">Instalar no celular</button>
      </div>
      <button class="btn ghost" id="resetDemo">Restaurar dados de demonstração</button>
    </div>

    <button class="btn secondary" id="logout" style="margin-top:11px;color:var(--red);border-color:#ffd4d4">Sair da conta</button>
  </section>`;
  document.getElementById('edit').onclick=document.getElementById('personal').onclick=()=>setRoute('editProfile');
  document.getElementById('changePass').onclick=()=>setRoute('changePassword');
  document.getElementById('notifications').onclick=()=>{settings.notifications=!settings.notifications;write(STORE.settings,settings);profile();toast(settings.notifications?'Notificações ativadas.':'Notificações desativadas.')};
  document.getElementById('ratings').onclick=()=>toast(`${read(STORE.ratings,[]).filter(r=>r.userId===u.id).length} avaliação(ões) enviada(s).`);
  document.getElementById('help').onclick=()=>alert('Protótipo acadêmico\n\nOs dados ficam apenas neste navegador e são armazenados em localStorage.');
  document.getElementById('logout').onclick=()=>{localStorage.removeItem(STORE.session);setRoute('login');toast('Sessão encerrada.')};
  document.getElementById('exportData').onclick=exportData;
  document.getElementById('importData').onchange=e=>importBackup(e.target.files[0]);
  document.getElementById('simulateReturn').onclick=simulateReturn;
  document.getElementById('installApp').onclick=installApp;
  document.getElementById('resetDemo').onclick=resetDemo
}
function exportData(){
  const data={version:1,exportedAt:new Date().toISOString(),users:read(STORE.users,[]),items:read(STORE.items,[]),lost:read(STORE.lost,[]),ratings:read(STORE.ratings,[]),claims:read(STORE.claims,[]),drafts:read(STORE.drafts,{}),settings:read(STORE.settings,{})};
  const blob=new Blob([JSON.stringify(data,null,2)],{type:'application/json'});
  const a=document.createElement('a');a.href=URL.createObjectURL(blob);a.download='achados-perdidos-backup.json';a.click();URL.revokeObjectURL(a.href);toast('Dados exportados.')
}
function simulateReturn(){
  const u=user(),items=read(STORE.items,[]);
  const target=items.find(i=>i.ownerId===u.id&&i.status!=='Devolvido');
  if(!target)return toast('Não há item disponível para simular devolução.');
  target.status='Devolvido';write(STORE.items,items);profile();toast(`"${target.titulo}" marcado como devolvido.`)
}
function resetDemo(){
  if(!confirm('Isso apagará os dados locais e restaurará a demonstração. Continuar?'))return;
  Object.values(STORE).forEach(k=>localStorage.removeItem(k));seed();write(STORE.session,'u-demo');setRoute('home');toast('Demonstração restaurada.')
}

function editProfile(){
  const u=user(); state.avatarTemp=u.avatar||null;
  app.innerHTML=`
  <section class="screen white no-nav">
    ${statusbar()}
    <div class="topbar"><button id="back" class="icon-btn">‹</button><h2>Dados pessoais</h2><span></span></div>
    <div style="display:flex;justify-content:center;margin-bottom:13px"><label class="profile-avatar" style="cursor:pointer">${state.avatarTemp?`<img src="${state.avatarTemp}" alt="">`:initials(u.nome)}<input id="avatarInput" hidden type="file" accept="image/*"></label></div>
    <div class="tiny muted" style="text-align:center;margin-top:-7px;margin-bottom:12px">Clique na foto para alterar</div>
    <div class="field"><label>Nome completo</label><input id="pName" class="control" value="${escapeHTML(u.nome)}"></div>
    <div class="field"><label>E-mail</label><input id="pEmail" class="control" value="${escapeHTML(u.email)}"></div>
    <div class="field"><label>Telefone</label><input id="pPhone" class="control" value="${escapeHTML(u.telefone||'')}"></div>
    <div class="grid2"><div class="field"><label>Curso</label><input id="pCourse" class="control" value="${escapeHTML(u.curso||'')}"></div><div class="field"><label>Campus</label><input id="pCampus" class="control" value="${escapeHTML(u.campus||'')}"></div></div>
    <button id="saveProfile" class="btn">Salvar alterações</button>
  </section>`;
  document.getElementById('back').onclick=()=>setRoute('profile');
  document.getElementById('avatarInput').onchange=async e=>{
    const f=e.target.files[0];if(!f)return;
    state.avatarTemp=await compressImage(f,360,.65);editProfile()
  };
  document.getElementById('saveProfile').onclick=()=>{
    const users=read(STORE.users,[]),x=users.find(a=>a.id===u.id),email=document.getElementById('pEmail').value.trim().toLowerCase();
    if(users.some(a=>a.id!==u.id&&a.email.toLowerCase()===email))return toast('Esse e-mail já está em uso.');
    x.nome=document.getElementById('pName').value.trim()||x.nome;x.email=email||x.email;x.telefone=document.getElementById('pPhone').value.trim();x.curso=document.getElementById('pCourse').value.trim();x.campus=document.getElementById('pCampus').value.trim();x.avatar=state.avatarTemp;
    write(STORE.users,users);setRoute('profile');toast('Perfil atualizado.')
  }
}
function changePassword(){
  const u=user();
  app.innerHTML=`
  <section class="screen white no-nav">
    ${statusbar()}
    <div class="topbar"><button id="back" class="icon-btn">‹</button><h2>Alterar senha</h2><span></span></div>
    <div class="field"><label>Senha atual</label>${passwordField('oldPass')}</div>
    <div class="field"><label>Nova senha</label>${passwordField('newPass')}</div>
    <div class="field"><label>Confirmar nova senha</label>${passwordField('newConfirm')}</div>
    <button id="savePass" class="btn">Alterar senha</button>
  </section>`;
  bindEyes();
  document.getElementById('back').onclick=()=>setRoute('profile');
  document.getElementById('savePass').onclick=()=>{
    if(document.getElementById('oldPass').value!==u.senha)return toast('Senha atual incorreta.');
    const np=document.getElementById('newPass').value;
    if(np.length<4)return toast('A nova senha precisa ter pelo menos 4 caracteres.');
    if(np!==document.getElementById('newConfirm').value)return toast('As novas senhas não conferem.');
    const users=read(STORE.users,[]),x=users.find(a=>a.id===u.id);x.senha=np;write(STORE.users,users);setRoute('profile');toast('Senha alterada.')
  }
}


window.addEventListener('beforeinstallprompt', (e)=>{
  e.preventDefault();
  state.installPrompt = e;
});

async function installApp(){
  if(!state.installPrompt){
    toast('No Chrome, use o menu do navegador e escolha “Instalar app” ou “Adicionar à tela inicial”.');
    return;
  }
  state.installPrompt.prompt();
  try{ await state.installPrompt.userChoice; }catch(e){}
  state.installPrompt = null;
}

async function importBackup(file){
  if(!file) return;
  try{
    const txt = await file.text();
    const data = JSON.parse(txt);
    if(!Array.isArray(data.users) || !Array.isArray(data.items)) throw new Error('invalid');
    write(STORE.users,data.users);
    write(STORE.items,data.items);
    write(STORE.lost,Array.isArray(data.lost)?data.lost:[]);
    write(STORE.ratings,Array.isArray(data.ratings)?data.ratings:[]);
    write(STORE.claims,Array.isArray(data.claims)?data.claims:[]);
    write(STORE.drafts,data.drafts||{found:{},lost:{}});
    if(data.settings) write(STORE.settings,data.settings);
    const current = data.users[0];
    if(current) write(STORE.session,current.id);
    toast('Backup importado com sucesso.');
    setRoute('home');
  }catch(e){
    toast('Arquivo de backup inválido.');
  }
}

window.addEventListener('popstate',()=>{
  const h=parseHash();
  if(h){state.route=h.route;if(h.itemId)state.selectedItem=h.itemId;render()}
});
document.addEventListener('DOMContentLoaded',()=>{
  navigator.storage?.persist?.().catch(()=>{});
  const h=parseHash();
  const allowed=['login','register','forgot','home','found','lost','records','detail','rating','profile','editProfile','changePassword'];
  if(user()){
    state.route=h&&allowed.includes(h.route)&&!['login','register','forgot'].includes(h.route)?h.route:'home';
    if(h?.itemId)state.selectedItem=h.itemId;
  }else state.route='login';
  history.replaceState({},'',hashFor(state.route,(state.route==='detail'||state.route==='rating')?state.selectedItem:null));
  render();
});
