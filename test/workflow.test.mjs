import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { test } from 'node:test';
import worker from '../src/worker.mjs';
import { createLocalEnv } from '../scripts/local-env.mjs';
import { digest, redirect, today } from '../src/http.mjs';
import { lossFormPath, safePath } from '../public/navigation.js';

const origin = 'http://127.0.0.1:8787';
const password = 'Exemplo#Achaki2026';
const photo = await readFile(new URL('../fixtures/fone.jpg', import.meta.url));
const expired = raw => raw.split(';')[0];

function app({ mail, ai } = {}) {
  const bootstrapToken = crypto.randomUUID() + crypto.randomUUID();
  const local = createLocalEnv({ origin, mail, ai, bootstrapToken });
  return { ...local, bootstrapToken, client() {
    let cookie = '';
    return async (path, body, { method, headers = {}, binary = false, raw = false } = {}) => {
      method ??= body === undefined ? 'GET' : 'POST';
      if (cookie) headers.Cookie = cookie;
      if (method !== 'GET') headers.Origin ??= origin;
      if (body !== undefined) headers['Content-Type'] ??= binary ? 'image/jpeg' : 'application/json';
      const request = new Request(origin + path, {
        method, headers, ...(body === undefined ? {} : { body:binary ? body : JSON.stringify(body) })
      });
      const response = await worker.fetch(request,local.env);
      const session = response.headers.getSetCookie().find(value => value.startsWith('achaki_session='));
      if (session) cookie = session.includes('Max-Age=0') ? '' : expired(session);
      const result = raw ? response : await response.json();
      return [response.status, result];
    };
  } };
}

const account = (name, email) => ({ name,email,phone:'(16) 99999-9999',password });
const object = (title = 'Fone sem fio', extra = {}) => ({
  title, description:'Objeto preto com detalhes azuis e uma marca lateral.', categoryId:'eletronicos',
  occurredOn:today(), location:'Laboratório de Informática 3', kind:'found', custody:'finder', ...extra
});

test('guarda direta: foto, busca, privacidade, identificação, devolução atômica e avaliações', async t => {
  const local = app();
  t.after(local.close);
  const finder = local.client();
  const owner = local.client();
  const visitor = local.client();
  assert.equal((await finder('/api/auth/register',account('Ana Barbosa','ana@example.test')))[0],201);
  assert.equal((await owner('/api/auth/register',account('Lucas Martins','lucas@example.test')))[0],201);
  const [uploadCode, upload] = await finder('/api/media',photo,{ binary:true });
  assert.equal(uploadCode,201);
  assert.equal((await visitor('/api/media/' + upload.id))[0],404);
  assert.equal((await owner('/api/items',object('Fone sem fio',{ photos:[upload.id] })))[0],409);
  const [foundCode, foundData] = await finder('/api/items',object('Fone sem fio',{ photos:[upload.id] }));
  assert.equal(foundCode,201, JSON.stringify(foundData));
  const item = foundData.item.id;
  assert.equal((await visitor('/api/items?q=laboratorio&location=informatica'))[1].items[0].id,item);
  const media = await visitor('/api/media/' + upload.id, undefined,{ raw:true });
  assert.equal(media[1].headers.get('Content-Type'),'image/jpeg');
  assert.equal((await media[1].arrayBuffer()).byteLength,photo.byteLength);
  const duplicate = (await finder('/api/media',photo,{ binary:true }))[1].id;
  assert.equal((await finder('/api/items',object('Fone sem fio',{ photos:[duplicate] })))[0],409);
  assert.equal((await visitor('/api/items/' + item + '/contact',{ message:'Uma marca exclusiva no estojo.' }))[0],401);
  assert.equal((await owner('/api/admin/overview'))[0],403);
  assert.equal((await finder('/api/profile',{ name:'Ana Barbosa',phone:'16999999999' },{ method:'PATCH',headers:{ Origin:'https://outro.example' } }))[0],403);

  const [claimCode, claim] = await owner('/api/items/' + item + '/contact',{ message:'Há uma fita azul no lado direito do estojo.' });
  assert.equal(claimCode,201,JSON.stringify(claim));
  assert.equal((await visitor('/api/contacts/summary'))[0],401);
  assert.deepEqual((await finder('/api/contacts/summary'))[1],{ review:1,pickup:0,campus:0,handoff:0 });
  assert.deepEqual((await finder('/api/contacts?fila=responder'))[1].contacts.map(row => row.id),[claim.contact.id]);
  assert.equal((await owner('/api/contacts?fila=responder'))[1].total,0);
  assert.equal((await visitor('/api/items/' + claim.contact.lostId))[0],404);
  assert.equal((await owner('/api/mine?kind=lost'))[1].items[0].id,claim.contact.lostId);
  assert.equal((await owner('/api/items/' + claim.contact.lostId + '/matches'))[1].items[0].id,item);
  const ownFound = (await finder('/api/mine?kind=found'))[1].items[0];
  const ownLoss = (await owner('/api/mine?kind=lost'))[1].items[0];
  assert.equal(ownFound.canChange,false);
  assert.equal(ownLoss.canChange,false);
  assert.equal((await finder('/api/mine/' + item + '/archive',{ action:'archive',updatedAt:ownFound.updatedAt }))[0],409);
  assert.equal((await owner('/api/mine/' + ownLoss.id,{ updatedAt:ownLoss.updatedAt },{ method:'PATCH' }))[0],409);
  assert.equal((await finder('/api/contacts?item=' + item))[1].contacts[0].id,claim.contact.id);
  assert.equal((await owner('/api/contacts?lost=' + ownLoss.id))[1].contacts[0].id,claim.contact.id);
  assert.deepEqual((await owner('/api/contacts?item=' + crypto.randomUUID()))[1].contacts,[]);
  assert.equal((await owner('/api/contacts'))[1].contacts[0].phone,null);
  assert.equal((await owner('/api/contacts/' + claim.contact.id,{ action:'approve' },{ method:'PATCH' }))[0],403);
  assert.equal((await finder('/api/contacts/' + claim.contact.id,{ action:'approve' },{ method:'PATCH' }))[0],200);
  assert.equal((await visitor('/api/items/' + item))[1].item.status,'reserved');
  assert.equal((await owner('/api/contacts'))[1].contacts[0].phone,'5516999999999');
  assert.equal((await owner('/api/items/' + item + '/return',{ returnedOn:today() }))[0],403);
  const deliveries = await Promise.all([1,2].map(() => finder('/api/items/' + item + '/return',{ returnedOn:today() })));
  assert.deepEqual(deliveries.map(result => result[0]).sort(),[200,201]);
  assert.equal(deliveries[0][1].returnId,deliveries[1][1].returnId);
  assert.equal((await owner('/api/mine?kind=lost'))[1].items[0].status,'recovered');
  assert.equal((await owner('/api/mine?kind=lost'))[1].items[0].recoveredItemId,item);
  assert.equal((await owner('/api/returns'))[1].items[0].rating,null);
  assert.equal((await owner('/api/items/' + item + '/rating',{ score:5,comment:'Recuperei no mesmo dia.' }))[0],201);
  assert.equal((await owner('/api/items/' + item + '/rating',{ score:4 }))[0],409);
  assert.equal((await finder('/api/items/' + item + '/rating',{ score:4 }))[0],201);
  assert.equal((await owner('/api/returns'))[1].items[0].rating,5);
  assert.equal((await visitor('/api/items/' + item))[1].item.request,undefined);
  assert.equal((await visitor('/api/items/' + item))[1].item.recipientName,undefined);
});

test('setor: moderação, perda vinculada, devolução administrativa, histórico e arquivamento', async t => {
  const local = app();
  t.after(local.close);
  const finder = local.client(), owner = local.client(), staff = local.client(), publicClient = local.client();
  await Promise.all([
    finder('/api/auth/register',account('Ana Barbosa','ana@example.test')),
    owner('/api/auth/register',account('Lucas Martins','lucas@example.test')),
    staff('/api/auth/register',account('Equipe do Campus','setor@example.test'))
  ]);
  const token = local.bootstrapToken;
  assert.equal((await publicClient('/api/bootstrap/admin',{ email:'setor@example.test' },{ headers:{ Authorization:'Bearer ' + token } }))[0],401);
  assert.equal((await staff('/api/bootstrap/admin',{},{ headers:{ Authorization:'Bearer ' + token } }))[0],200);
  assert.equal((await owner('/api/bootstrap/admin',{},{ headers:{ Authorization:'Bearer ' + token } }))[0],409);
  assert.equal((await staff('/api/admin/settings',{ phone:'16988888888',location:'Secretaria',hours:'Segunda a sexta',review:true },{ method:'PATCH' }))[0],200);
  const [lossCode, lossData] = await owner('/api/items',object('Fone perdido',{ kind:'lost' }));
  assert.equal(lossCode,201,JSON.stringify(lossData));
  const lost = lossData.item.id;
  const image = (await finder('/api/media',photo,{ binary:true }))[1].id;
  const [created, data] = await finder('/api/items',object('Fone encontrado',{ custody:'campus',photos:[image] }));
  assert.equal(created,201,JSON.stringify(data));
  const item = data.item.id;
  assert.equal(data.item.publication,'public');
  assert.equal((await publicClient('/api/items/' + item))[0],200);
  assert.equal((await staff('/api/admin/items/' + item + '/action',{ action:'approve' }))[0],200);
  assert.equal((await staff('/api/admin/items/' + item + '/candidates'))[1].items[0].id,lost);
  assert.equal((await staff('/api/admin/items/' + item + '/action',{ action:'reserve',lostId:lost }))[0],200);
  assert.equal((await owner('/api/mine?kind=lost'))[1].items[0].canChange,false);
  assert.equal((await owner('/api/mine/' + lost + '/archive',{ action:'archive',updatedAt:lossData.item.updatedAt }))[0],409);
  const recategorization = { ...lossData.item,categoryId:'acessorios' };
  assert.equal((await staff('/api/admin/items/' + lost,recategorization,{ method:'PATCH' }))[0],409);
  const contact = (await owner('/api/items/' + item + '/contact',{ lostId:lost,message:'O estojo tem uma marca azul e um risco.' }))[1].contact;
  assert.deepEqual((await staff('/api/contacts/summary'))[1],{ review:0,pickup:0,campus:1,handoff:0 });
  assert.equal((await finder('/api/contacts/summary'))[1].campus,0);
  assert.equal((await staff('/api/contacts?scope=campus&fila=responder'))[1].total,1);
  assert.equal((await finder('/api/contacts?scope=campus&fila=responder'))[1].total,0);
  assert.equal((await finder('/api/contacts/' + contact.id,{ action:'approve' },{ method:'PATCH' }))[0],403);
  assert.equal((await staff('/api/contacts?scope=campus'))[1].contacts[0].id,contact.id);
  assert.equal((await staff('/api/contacts/' + contact.id,{ action:'approve' },{ method:'PATCH' }))[0],200);
  assert.deepEqual((await owner('/api/contacts/summary'))[1],{ review:0,pickup:1,campus:0,handoff:0 });
  assert.deepEqual((await owner('/api/contacts?fila=retirar'))[1].contacts.map(row => row.id),[contact.id]);
  assert.equal((await staff('/api/contacts/summary'))[1].campus,0);
  assert.equal((await owner('/api/contacts'))[1].contacts[0].sector.location,'Secretaria');
  assert.equal((await finder('/api/items/' + item + '/return',{ returnedOn:today() }))[0],403);
  assert.equal((await staff('/api/items/' + item + '/return',{ returnedOn:today(),notes:'Entregue na secretaria.' }))[0],201);
  assert.equal((await owner('/api/contacts/summary'))[1].pickup,0);
  assert.equal((await owner('/api/contacts?fila=retirar'))[1].total,0);
  const history = (await staff('/api/admin/items?history=complete'))[1];
  assert.equal(history.total,2);
  assert.equal(history.items.find(row => row.id === item).recipientName,'Lucas Martins');
  assert.ok((await staff('/api/admin/items/' + item + '/details'))[1].timeline.some(row => row.details === 'returned'));
  const [exported,csv] = await staff('/api/admin/history.csv',undefined,{ raw:true });
  assert.equal(exported,200);
  assert.match(await csv.text(),/Entregue na secretaria/);
  assert.equal((await staff('/api/admin/items/' + item + '/action',{ action:'archive' }))[0],200);
  assert.equal((await publicClient('/api/media/' + image))[0],404);
  assert.equal((await staff('/api/admin/items/' + item + '/action',{ action:'restore' }))[0],200);
  assert.equal((await publicClient('/api/items/' + item))[0],200);
});

test('edição e arquivo do autor preservam revisão, privacidade e histórico', async t => {
  const local = app();
  t.after(local.close);
  const finder = local.client(), staff = local.client(), visitor = local.client();
  const accounts = [
    finder('/api/auth/register',account('Ana Barbosa','ana@example.test')),
    staff('/api/auth/register',account('Equipe do Campus','setor@example.test'))
  ];
  assert.deepEqual((await Promise.all(accounts)).map(([status]) => status),[201,201]);
  assert.equal((await staff('/api/bootstrap/admin',{},{ headers:{ Authorization:'Bearer ' + local.bootstrapToken } }))[0],200);
  const upload = (await finder('/api/media',photo,{ binary:true }))[1].id;
  const [created, { item }] = await finder('/api/items',object('Carregador preto',{ photos:[upload],description:'' }));
  assert.equal(created,201);
  assert.equal((await visitor('/api/items/' + item.id))[0],200);
  assert.equal((await staff('/api/admin/settings',{ review:true,location:'Secretaria' },{ method:'PATCH' }))[0],200);
  const path = '/api/mine/' + item.id;
  const patch = { method:'PATCH' };
  const updatedItem = { ...item,title:'Carregador USB-C preto',description:'USB-C',location:'Saguão principal' };
  assert.equal((await visitor(path,updatedItem,patch))[0],401);
  assert.equal((await staff(path,updatedItem,patch))[0],404);
  assert.equal((await finder(path,item,patch))[1].publication,'public');
  const [updated, update] = await finder(path,updatedItem,patch);
  assert.equal(updated,200);
  assert.equal(update.publication,'public');
  assert.equal((await finder(path,{ ...updatedItem,title:'Versão antiga' },patch))[0],409);
  assert.equal((await visitor('/api/items/' + item.id))[0],200);
  assert.equal((await visitor('/api/media/' + upload,undefined,{raw:true}))[0],200);
  assert.equal((await staff('/api/admin/items/' + item.id + '/action',{ action:'approve' }))[0],200);
  const publicSearch = (await visitor('/api/items?q=carregador&location=saguao'))[1];
  assert.equal(publicSearch.items[0].title,'Carregador USB-C preto');

  const published = (await finder('/api/mine?kind=found'))[1].items[0];
  assert.equal(published.canChange,true);
  assert.equal((await finder(path + '/archive',{ action:'archive',updatedAt:published.updatedAt }))[0],200);
  assert.equal((await finder('/api/mine?kind=found'))[1].total,0);
  assert.equal((await visitor('/api/items/' + item.id))[0],404);
  assert.equal((await visitor('/api/media/' + upload))[0],404);
  assert.equal((await finder('/api/media/' + upload,undefined,{ raw:true }))[0],200);
  const archived = (await finder('/api/mine?kind=found&archived=1'))[1].items[0];
  assert.ok(archived.archivedAt);
  const restore = { action:'restore',updatedAt:archived.updatedAt };
  assert.equal((await finder(path + '/archive',restore))[1].publication,'public');
  assert.equal((await finder('/api/mine?kind=found&archived=1'))[1].total,0);
  assert.equal((await visitor('/api/items/' + item.id))[0],200);
  const timeline = (await staff('/api/admin/items/' + item.id + '/details'))[1].timeline;
  assert.ok(timeline.some(entry => entry.action === 'archived'));
  assert.ok(timeline.some(entry => entry.action === 'restored'));

  assert.equal((await staff('/api/admin/items/' + item.id + '/action',{ action:'archive' }))[0],200);
  const [adminList, administrativelyArchived] = await staff('/api/admin/items?archived=1');
  assert.equal(adminList,200);
  assert.equal((await finder('/api/mine?kind=found&archived=1'))[1].total,0);
  assert.equal((await finder(path + '/archive',{ action:'restore',updatedAt:administrativelyArchived.items[0].updatedAt }))[0],404);

  const [recorded, { item:loss }] = await finder('/api/items',object('Chaves da sala',{ kind:'lost',categoryId:'acessorios',location:'No banco entre os blocos B e C',description:undefined }));
  assert.equal(recorded,201);
  assert.equal(loss.description,'');
  assert.equal(loss.location,'No banco entre os blocos B e C');
  const privateLoss=(await staff('/api/admin/items?kind=lost'))[1].items.find(entry=>entry.id===loss.id);
  assert.ok(privateLoss.contactPhone);
  assert.equal((await finder('/api/mine/' + loss.id,{ ...loss,title:'Chaves com fita vermelha' },patch))[0],200);
  const corrected = (await finder('/api/mine?kind=lost'))[1].items[0];
  assert.equal(corrected.sharePhone,true);
  assert.equal(corrected.publication,'private');
  assert.equal(corrected.title,'Chaves com fita vermelha');
  assert.equal((await visitor('/api/items/' + loss.id))[0],404);
});

test('uma solicitação simultânea impede o arquivamento ou recebe conflito', async t => {
  const local = app();
  t.after(local.close);
  const finder = local.client(), owner = local.client();
  await Promise.all([
    finder('/api/auth/register',account('Ana Barbosa','ana@example.test')),
    owner('/api/auth/register',account('Lucas Martins','lucas@example.test'))
  ]);
  const photoId = (await finder('/api/media',photo,{ binary:true }))[1].id;
  const { item } = (await finder('/api/items',object('Carregador branco',{ photos:[photoId] })))[1];
  const [[archiveCode],[contactCode]] = await Promise.all([
    finder('/api/mine/' + item.id + '/archive',{ action:'archive',updatedAt:item.updatedAt }),
    owner('/api/items/' + item.id + '/contact',{ message:'O plugue do carregador está marcado com tinta vermelha.' })
  ]);
  const [active, contacts] = await Promise.all([finder('/api/mine'), owner('/api/contacts')]);
  if (archiveCode === 200) {
    assert.ok([404,409].includes(contactCode));
    assert.equal(active[1].total,0);
    assert.equal(contacts[1].total,0);
    assert.equal((await owner('/api/mine?kind=lost'))[1].total,0);
  } else {
    assert.deepEqual([archiveCode,contactCode],[409,201]);
    assert.equal(active[1].items[0].canChange,false);
    assert.equal(contacts[1].contacts[0].status,'pending');
  }
});

test('recuperação de senha: resposta neutra, token de uso único e sessão antiga revogada', async t => {
  const outbox = [];
  const local = app({ mail:{ send:mail => outbox.push(mail) } });
  t.after(local.close);
  const accountClient = local.client();
  const requester = local.client();
  const user = account('Ana Barbosa','ana@example.test');
  assert.equal((await accountClient('/api/auth/register',user))[0],201);
  await requester('/api/auth/forgot',{ email:'ausente@example.test' });
  assert.equal(outbox.length,0);
  await requester('/api/auth/forgot',{ email:user.email });
  assert.equal(outbox.length,1);
  const token = new URL(outbox[0].url).hash.slice(1);
  const freshPassword = 'Senha nova 2026!';
  assert.equal((await requester('/api/auth/reset',{ token,password:freshPassword }))[0],200);
  assert.equal((await requester('/api/auth/reset',{ token,password:freshPassword }))[0],400);
  assert.equal((await accountClient('/api/mine'))[0],401);
  assert.equal((await requester('/api/auth/login',{ email:user.email,password }))[0],401);
  assert.equal((await requester('/api/auth/login',{ email:user.email,password:freshPassword }))[0],200);
});

test('arquivos públicos, páginas por URL e classificação opcional', async t => {
  const local = app({ ai:{ run:async (model,input) => {
    assert.equal(model,'@cf/microsoft/resnet-50');
    assert.ok(input.image.length > 0);
    return [{ label:'notebook computer',score:0.9 }];
  } } });
  t.after(local.close);
  const client = local.client();
  const [opened,page] = await client('/painel/encontrados',undefined,{ raw:true });
  assert.equal(opened,200);
  assert.match(await page.text(),/styles\.css/);
  assert.match(page.headers.get('Content-Security-Policy'),/frame-ancestors 'none'/);
  assert.equal(page.headers.get('Referrer-Policy'),'same-origin');
  const [assets, css] = await client('/styles.css',undefined,{ raw:true });
  assert.equal(assets,200);
  assert.match(await css.text(),/\.mural-search/);
  const [catalogCode,catalogStyles] = await client('/mural.css',undefined,{ raw:true });
  assert.equal(catalogCode,200);
  assert.match(catalogStyles.headers.get('Content-Type'),/text\/css/);
  const [imageCode,headerPhoto] = await client('/images/chaves-do-mural.webp',undefined,{ raw:true });
  assert.equal(imageCode,200);
  assert.equal(headerPhoto.headers.get('Content-Type'),'image/webp');
  assert.equal(Buffer.from(await headerPhoto.arrayBuffer()).toString('ascii',8,12),'WEBP');
  const [scriptCode,script] = await client('/app.js',undefined,{ raw:true });
  assert.equal(scriptCode,200);
  for (const [,source] of (await script.text()).matchAll(/^import .*? from '\.\/(.+?)';/gm)) {
    const [code,module] = await client('/' + source,undefined,{ raw:true });
    assert.equal(code,200,source);
    assert.match(module.headers.get('Content-Type'),/javascript/,source);
  }
  assert.equal((await client('/api/health'))[0],200);
  assert.equal((await client('/api/media/suggestion',photo,{ binary:true }))[0],401);
  await client('/api/auth/register',account('Ana Barbosa','ana@example.test'));
  assert.equal((await client('/api/media/suggestion',photo,{ binary:true }))[1].category.id,'eletronicos');
  assert.equal((await client('/api/media',new Uint8Array(30),{ binary:true }))[0],415);
});

test('o domínio de produção redireciona a HTTP e protege as sessões no HTTPS', async t => {
  const production = 'https://achados.jrsites.online';
  const { env,close } = createLocalEnv({ origin:production });
  t.after(close);
  env.APP_RELEASE = 'test-release';
  const health = await worker.fetch(new Request(production + '/api/health'),env);
  assert.deepEqual(await health.json(),{ ok:true,release:'test-release' });
  const insecure = await worker.fetch(new Request('http://achados.jrsites.online/meus-registros'),env);
  assert.equal(insecure.status,308);
  assert.equal(insecure.headers.get('Location'),production + '/meus-registros');
  const legacy = await worker.fetch(new Request('https://achaki.jrsites.online/entrar?next=%2Fpainel'),env);
  assert.equal(legacy.status,308);
  assert.equal(legacy.headers.get('Location'),production + '/entrar?next=%2Fpainel');
  const registered = await worker.fetch(new Request(production + '/api/auth/register',{
    method:'POST',headers:{ 'Content-Type':'application/json',Origin:production },
    body:JSON.stringify(account('Ana Barbosa','ana@example.test'))
  }),env);
  assert.equal(registered.status,201);
  assert.equal(registered.headers.get('Strict-Transport-Security'),'max-age=31536000');
  assert.match(registered.headers.get('Set-Cookie'),/^__Host-achaki_session=.*; Path=\/; HttpOnly; SameSite=Lax; Secure$/);
});

test('a busca acompanha o usuário pelo login até o formulário de perda', () => {
  const params = new URLSearchParams({ q:'Estojo azul',category:'acessorios',location:'Biblioteca',status:'open',from:'2026-01-10' });
  const target = lossFormPath(params);
  const afterLogin = new URLSearchParams({ next:target });
  assert.equal(safePath(afterLogin.get('next')),target);
  const fields = new URL(target,origin);
  assert.equal(fields.pathname,'/novo/lost');
  assert.deepEqual(Object.fromEntries(fields.searchParams),{ objeto:'Estojo azul',categoria:'acessorios',local:'Biblioteca' });
  assert.equal(lossFormPath(new URLSearchParams()),'/novo/lost');
  assert.equal(safePath('/meus-registros?aba=perdi'),'/meus-registros?aba=perdi');
  assert.equal(safePath('//exemplo.invalid/'),'/');
  assert.equal(safePath('/novo/../entrar'),'/');
  const headers = new Headers();
  headers.append('Set-Cookie','state=; Max-Age=0');
  headers.append('Set-Cookie','session=example; HttpOnly');
  const response = redirect(target,headers);
  assert.equal(response.headers.get('Location'),target);
  assert.deepEqual(response.headers.getSetCookie(),headers.getSetCookie());
});

test('comparação privada ordena por características, filtra por guarda e acompanha reservas', async t => {
  const local = app();
  t.after(local.close);
  const owner = local.client(), finder = local.client(), visitor = local.client();
  await Promise.all([
    owner('/api/auth/register',account('Lucas Martins','lucas@example.test')),
    finder('/api/auth/register',account('Setor do Campus','setor@example.test'))
  ]);
  assert.equal((await finder('/api/bootstrap/admin',{},{ headers:{Authorization:'Bearer ' + local.bootstrapToken} }))[0],200);
  const lost = (await owner('/api/items',object('Meu fone azul',{ kind:'lost',location:'Biblioteca' })))[1].item;
  const other = (await owner('/api/items',object('Cabo branco',{ kind:'lost',location:'Cantina' })))[1].item;
  const yesterday = new Date(new Date(today() + 'T12:00:00Z').valueOf() - 86400000).toISOString().slice(0,10);
  async function found(title,location,custody,day = today()) {
    const image = (await finder('/api/media',photo,{ binary:true }))[1].id;
    const [code,result] = await finder('/api/items',object(title,{ photos:[image],description:'Objeto deixado sobre uma mesa.',location,custody,occurredOn:day }));
    assert.equal(code,201,JSON.stringify(result));
    return result.item;
  }
  const matching = await found('Fone azul-claro','Biblioteca','campus',yesterday);
  const cable = await found('Cabo branco','Cantina','finder');
  assert.deepEqual((await visitor('/api/items?custody=campus&status=open'))[1].items.map(i => i.id),[matching.id]);
  assert.deepEqual((await visitor('/api/items?custody=finder'))[1].items.map(i => i.id),[cable.id]);
  const matches = '/api/items/' + lost.id + '/matches';
  const options = '/api/items/' + matching.id + '/claim-options';
  assert.equal((await visitor(options))[0],401);
  assert.deepEqual((await finder(options))[1].losses,[]);
  assert.deepEqual((await owner(options))[1].losses.map(i => i.id).sort(),[lost.id,other.id].sort());
  assert.equal((await visitor(matches))[0],401);
  const candidates = (await owner(matches))[1].items;
  assert.deepEqual(candidates.map(i => i.id).sort(),[matching.id,cable.id].sort());
  assert.equal(candidates[0].authorId,undefined);
  const [sent,{contact}] = await owner('/api/items/' + matching.id + '/contact',{ lostId:lost.id,message:'O lado direito tem uma marca.' });
  assert.equal(sent,201);
  assert.equal(contact.lostId,lost.id);
  assert.equal((await owner('/api/items/' + matching.id + '/contact',{ lostId:other.id,message:'Outra marca na lateral.' }))[0],409);
  assert.equal((await owner('/api/mine?kind=lost'))[1].total,2);
  assert.equal((await finder('/api/contacts/' + contact.id,{action:'approve'},{method:'PATCH'}))[0],200);
  assert.equal((await owner(matches))[1].items.find(i=>i.id===matching.id).status,'reserved');
  assert.deepEqual((await owner('/api/items/' + other.id + '/matches'))[1].items.map(i => i.id),[cable.id]);
  assert.deepEqual((await visitor('/api/items?custody=campus&status=open'))[1].items,[]);
  assert.equal((await owner('/api/mine/' + lost.id + '/resolve',{updatedAt:lost.updatedAt}))[0],409);
});

test('recuperação por conta própria preserva a privacidade e o histórico de entregas', async t => {
  const local = app();
  t.after(local.close);
  const owner = local.client(), other = local.client(), visitor = local.client();
  await Promise.all([
    owner('/api/auth/register',account('Lucas Martins','lucas@example.test')),
    other('/api/auth/register',account('Ana Barbosa','ana@example.test'))
  ]);
  const { item } = (await owner('/api/items',object('Estojo azul',{ kind:'lost' })))[1];
  const own = '/api/mine/' + item.id;
  const detail = '/api/items/' + item.id;
  const payload = { updatedAt:item.updatedAt };
  assert.equal((await visitor(own + '/resolve',payload))[0],401);
  assert.equal((await other(own + '/resolve',payload))[0],404);
  assert.equal((await owner(own + '/resolve',{ updatedAt:'antiga' }))[0],409);
  assert.equal((await owner(detail))[1].item.canResolve,true);
  assert.deepEqual((await Promise.all([owner(own + '/resolve',payload),owner(own + '/resolve',payload)])).map(([code])=>code),[200,200]);
  const resolved = (await owner(detail))[1].item;
  assert.equal(resolved.status,'recovered');
  assert.equal(resolved.canResolve,false);
  assert.equal(resolved.recoveredItemId,null);
  assert.equal((await owner(detail + '/matches'))[0],404);
  assert.equal((await other(detail))[0],404);
  assert.equal((await visitor('/api/items?q=estojo'))[1].total,0);
  assert.deepEqual((await owner('/api/returns'))[1].items,[]);
  assert.equal(local.sqlite.prepare("SELECT count(*) AS n FROM audit WHERE item_id = ? AND action = 'status' AND details = 'recovered'").get(item.id).n,1);
});

test('um pedido ativo impede encerrar a perda, e um novo pedido preserva o registro encerrado', async t => {
  const local = app();
  t.after(local.close);
  const owner = local.client(), finder = local.client();
  await Promise.all([
    owner('/api/auth/register',account('Lucas Martins','lucas@example.test')),
    finder('/api/auth/register',account('Ana Barbosa','ana@example.test'))
  ]);
  const image = (await finder('/api/media',photo,{binary:true}))[1].id;
  const {item:found} = (await finder('/api/items',object('Fone da biblioteca',{photos:[image]})))[1];
  const request = '/api/items/' + found.id + '/contact';
  const message = { message:'A haste do meu fone tem uma inscrição.' };
  const {contact:first} = (await owner(request,message))[1];
  const loss = (await owner('/api/items/' + first.lostId))[1].item;
  const resolve = '/api/mine/' + loss.id + '/resolve';
  assert.equal((await owner(resolve,{updatedAt:loss.updatedAt}))[0],409);
  assert.equal((await owner('/api/contacts/' + first.id,{action:'cancel'},{method:'PATCH'}))[0],200);
  const [[closeCode],[sendCode,linked]] = await Promise.all([
    owner(resolve,{updatedAt:loss.updatedAt}),owner(request,{...message,lostId:loss.id})
  ]);
  assert.deepEqual([closeCode,sendCode].sort(), closeCode === 200 ? [200,409] : [201,409]);
  if (sendCode === 201) {
    assert.equal((await owner('/api/contacts/' + linked.contact.id,{action:'cancel'},{method:'PATCH'}))[0],200);
    assert.equal((await owner(resolve,{updatedAt:loss.updatedAt}))[0],200);
  }
  const [created,again] = await owner(request,message);
  assert.equal(created,201,JSON.stringify(again));
  assert.notEqual(again.contact.lostId,loss.id);
  assert.equal((await owner('/api/items/' + loss.id))[1].item.status,'recovered');
  assert.equal((await owner('/api/contacts?lost=' + loss.id))[1].contacts.every(row => row.status === 'cancelled'),true);
});

async function pickupFixture(t,custody = 'finder') {
  const local = app();
  t.after(local.close);
  const owner = local.client(), finder = local.client(), staff = local.client(), visitor = local.client();
  await Promise.all([[owner,'Lucas Martins','lucas'],[finder,'Ana Barbosa','ana'],[staff,'Equipe do Setor','setor']].map(
    ([call,name,email]) => call('/api/auth/register',account(name,email + '@example.test'))));
  assert.equal((await staff('/api/bootstrap/admin',{},{headers:{Authorization:'Bearer ' + local.bootstrapToken}}))[0],200);
  const photoId = (await finder('/api/media',photo,{binary:true}))[1].id;
  const {item} = (await finder('/api/items',object('Fone azul, com estojo',{photos:[photoId],custody})))[1];
  const {contact} = (await owner('/api/items/' + item.id + '/contact',{message:'Tem uma letra L na haste direita.'}))[1];
  const change = '/api/contacts/' + contact.id;
  const current = async call => (await call('/api/contacts?fila=entregar'))[1].contacts[0];
  return {owner,finder,staff,visitor,item,contact,change,current,plan:change + '/pickup',calendar:change + '/calendar.ics',
    delivery:'/api/items/' + item.id + '/return',receipt:'/api/items/' + item.id + '/receipt'};
}

function futureMeeting(days = 2) {
  const day = new Date(Date.parse(today() + 'T12:00:00Z') + days * 86400000).toISOString().slice(0,10);
  return {when:day + 'T14:30',place:'Biblioteca, balcão de atendimento'};
}

test('as duas partes combinam uma retirada, exportam o calendário e preservam o horário aceito ao renegociar', async t => {
  const {owner,finder,staff,visitor,change,plan,calendar,current} = await pickupFixture(t);
  const next = futureMeeting();
  const offer = {action:'propose',revision:0,custody:'finder',...next};
  const op = (action,revision) => ({action,revision,custody:'finder'});
  const getCalendar = call => call(calendar,undefined,{raw:true});
  assert.equal((await visitor(plan,offer))[0],401);
  assert.equal((await staff(plan,offer))[0],404);
  assert.equal((await owner(plan,offer))[0],409);
  assert.equal((await finder(change,{action:'approve'},{method:'PATCH'}))[0],200);
  assert.equal((await finder('/api/contacts/summary'))[1].handoff,1);
  offer.revision = (await current(finder)).pickup.revision;
  assert.equal((await owner('/api/contacts?fila=entregar'))[1].total,0);
  assert.equal((await owner(plan,{...offer,when:'2026-02-30T14:30'}))[0],400);
  assert.equal((await owner(plan,{...offer,when:'2020-01-01T14:30'}))[0],400);
  const [offered,{pickup:first}] = await owner(plan,offer);
  assert.equal(offered,200);
  assert.deepEqual(first.proposal,{...next,by:'requester'});
  assert.deepEqual((await owner(plan,offer))[1].pickup,first);
  assert.equal((await getCalendar(owner))[0],404);
  assert.equal((await owner(plan,op('confirm',first.revision)))[0],403);
  const approve = op('confirm',first.revision);
  const [[firstCode,{pickup:agreed}],[retryCode,retry]] = await Promise.all([finder(plan,approve),finder(plan,approve)]);
  assert.deepEqual([firstCode,retryCode],[200,200]);
  assert.deepEqual(retry.pickup,agreed);
  assert.deepEqual(agreed.agreed,next);
  assert.equal(agreed.proposal,null);
  assert.deepEqual((await owner('/api/contacts?fila=retirar'))[1].contacts[0].pickup,agreed);
  const [code,attachment] = await getCalendar(owner);
  assert.equal(code,200);
  assert.match(attachment.headers.get('Content-Type'),/text\/calendar/);
  assert.match(attachment.headers.get('Cache-Control'),/no-store/);
  const ics = await attachment.text();
  assert.ok(ics.includes('DTSTART:' + next.when.slice(0,10).replaceAll('-','') + 'T173000Z'));
  assert.ok(ics.includes('LOCATION:Biblioteca\\, balcão'));
  assert.equal((await getCalendar(staff))[0],404);
  const alternate = futureMeeting(4);
  const proposed = (await finder(plan,{...op('propose',agreed.revision),...alternate}))[1].pickup;
  assert.deepEqual(proposed.agreed,next);
  assert.equal(proposed.proposal.by,'custodian');
  assert.equal((await owner(plan,op('confirm',agreed.revision)))[0],409);
  const kept = (await owner(plan,op('dismiss',proposed.revision)))[1].pickup;
  assert.deepEqual(kept.agreed,next);
  assert.equal(kept.proposal,null);
  const cleared = (await owner(plan,op('unschedule',kept.revision)))[1].pickup;
  assert.equal(cleared.agreed,null);
  assert.equal((await getCalendar(owner))[0],404);
  assert.equal((await finder('/api/contacts?fila=entregar'))[1].total,1);
});

test('sugestões simultâneas, transferência ao setor e cancelamento respeitam a reserva vigente', async t => {
  const {owner,finder,staff,item,change,plan,calendar,current} = await pickupFixture(t);
  await finder(change,{action:'approve'},{method:'PATCH'});
  const offer = {action:'propose',custody:'finder',revision:(await current(finder)).pickup.revision,...futureMeeting()};
  const simultaneous = await Promise.all([owner(plan,offer),finder(plan,{...offer,place:'Secretaria'})]);
  assert.deepEqual(simultaneous.map(([status])=>status).sort(),[200,409]);
  const {pickup:before} = simultaneous.find(([code])=>code===200)[1];
  assert.equal((await finder('/api/items/' + item.id + '/transfer',{}))[0],200);
  assert.equal((await finder(plan,offer))[0],404);
  assert.equal((await owner(plan,{...offer,revision:before.revision}))[0],409);
  const after = (await current(staff)).pickup;
  assert.equal(after.proposal,null);
  const proposal = (await staff(plan,{...offer,custody:'campus',revision:after.revision}))[1].pickup;
  assert.equal((await owner(plan,{action:'confirm',custody:'campus',revision:proposal.revision}))[0],200);
  assert.equal((await staff(calendar,undefined,{raw:true}))[0],200);
  assert.equal((await owner(change,{action:'cancel'},{method:'PATCH'}))[0],200);
  assert.equal((await staff(calendar,undefined,{raw:true}))[0],404);
  assert.equal((await staff(plan,{...offer,custody:'campus'}))[0],409);
  assert.equal((await staff('/api/contacts/summary'))[1].handoff,0);
});

test('reabrir e aprovar o mesmo pedido exige um novo combinado e invalida o formulário antigo de entrega', async t => {
  const {owner,finder,staff,item,contact,change,plan,calendar,delivery,current} = await pickupFixture(t);
  const approve = () => finder(change,{action:'approve'},{method:'PATCH'});
  await approve();
  const first = await current(finder);
  const offer = {action:'propose',custody:'finder',revision:first.pickup.revision,...futureMeeting()};
  const {pickup:proposal} = (await finder(plan,offer))[1];
  const {pickup:agreed} = (await owner(plan,{action:'confirm',custody:'finder',revision:proposal.revision}))[1];
  assert.ok(agreed.agreed);
  assert.equal((await staff('/api/admin/items/' + item.id + '/action',{action:'reopen'}))[0],200);
  assert.equal((await approve())[0],200);
  const second = await current(finder);
  assert.equal(second.pickup.agreed,null);
  assert.equal(second.pickup.proposal,null);
  assert.equal((await owner(calendar,undefined,{raw:true}))[0],404);
  assert.equal((await owner(plan,{...offer,revision:agreed.revision}))[0],409);
  const before = {updatedAt:first.itemUpdatedAt,contactId:contact.id,returnedOn:today()};
  assert.equal((await finder(delivery,before))[0],409);
  assert.equal((await owner('/api/returns'))[1].total,0);
  const fresh = {...before,updatedAt:second.itemUpdatedAt};
  assert.equal((await finder(delivery,fresh))[0],201);
  assert.equal((await finder(delivery,fresh))[0],200);
});

test('o comprovante privado identifica a entrega e continua disponível depois do arquivamento', async t => {
  const {owner,finder,staff,visitor,item,contact,change,delivery,receipt} = await pickupFixture(t,'campus');
  assert.equal((await visitor(receipt))[0],401);
  assert.equal((await owner(receipt))[0],404);
  await staff(change,{action:'approve'},{method:'PATCH'});
  assert.equal((await staff('/api/contacts/summary'))[1].handoff,1);
  const data = {returnedOn:today(),contactId:contact.id,notes:'Anotação interna do setor.'};
  const [created,delivered] = await staff(delivery,data);
  assert.equal(created,201);
  assert.equal((await staff(delivery,data))[1].returnId,delivered.returnId);
  assert.equal((await staff(delivery,{...data,contactId:crypto.randomUUID()}))[0],409);
  const [code,{receipt:record}] = await owner(receipt);
  assert.equal(code,200);
  assert.equal(record.id,delivered.returnId);
  assert.equal(record.recipientName,'Lucas Martins');
  assert.equal(record.recordedBy,'Equipe do Setor');
  assert.equal(record.custody,'campus');
  assert.equal(record.notes,undefined);
  assert.equal((await finder(receipt))[0],404);
  assert.equal((await finder('/api/mine?kind=found'))[1].items[0].recipientName,null);
  assert.equal((await visitor('/api/items/' + item.id))[1].item.canViewReceipt,false);
  assert.equal((await owner('/api/contacts'))[1].contacts[0].canViewReceipt,true);
  const recipient = (await owner('/api/returns?page=1'))[1];
  assert.equal(recipient.total,1);
  assert.equal(recipient.items[0].role,'recipient');
  assert.equal(recipient.items[0].canRate,true);
  assert.equal((await staff('/api/returns?page=1'))[1].items[0].role,'actor');
  const original = (await finder('/api/returns?page=1'))[1].items[0];
  assert.equal(original.role,'finder');
  assert.equal(original.canViewReceipt,false);
  assert.equal(original.canRate,true);
  assert.equal((await staff('/api/admin/items/' + item.id + '/action',{action:'archive'}))[0],200);
  assert.equal((await owner(receipt))[1].receipt.id,delivered.returnId);
  assert.equal((await staff(receipt))[0],200);
  assert.equal((await owner('/api/returns?page=2'))[1].items.length,0);
  const path = '/comprovante/' + item.id;
  assert.equal(safePath(path),path);
  assert.equal((await visitor(path,undefined,{raw:true}))[0],200);
});

test('WhatsApp do responsável reserva uma vez, mesmo com dois interessados, e permite devolver', async t => {
  const local = app();
  t.after(local.close);
  const finder = local.client(), visitor = local.client(), people = [local.client(),local.client()];
  await finder('/api/auth/register',{...account('Ana Barbosa','ana@example.test'),phone:'16988881111'});
  for (const [i,client] of people.entries()) await client('/api/auth/register',account('Pessoa Silva','p'+i+'@example.test'));
  const upload = (await finder('/api/media',photo,{binary:true}))[1];
  const item = (await finder('/api/items',object('Fone azul',{photos:[upload.id]})))[1].item;
  const path = '/api/items/'+item.id;
  assert.equal((await visitor(path+'/whatsapp',{}))[0],401);
  assert.equal((await finder(path+'/whatsapp',{}))[0],409);
  const results = await Promise.all(people.map(client=>client(path+'/whatsapp',{})));
  assert.deepEqual(results.map(([code])=>code).sort(),[200,409],JSON.stringify(results));
  const index = results.findIndex(([code])=>code===200);
  const winner = people[index], loser = people[1-index], contact = results[index][1];
  const url = new URL(contact.url);
  assert.equal(url.origin,'https://wa.me');
  assert.equal(url.pathname,'/5516988881111');
  assert.match(url.searchParams.get('text'),/Fone azul/);
  assert.deepEqual((await winner(path+'/whatsapp',{}))[1],contact);
  assert.equal((await winner(path))[1].item.reservedForMe,true);
  assert.equal((await loser(path))[1].item.reservedForMe,false);
  assert.equal((await winner('/api/mine?kind=lost'))[1].total,1);
  assert.equal((await loser('/api/mine?kind=lost'))[1].total,0);
  const inbox = (await finder('/api/contacts'))[1];
  assert.equal(inbox.total,1);
  assert.equal(inbox.contacts[0].whatsappReservation,true);
  const prompt = '/api/contacts/pending-reservation';
  assert.equal((await visitor(prompt))[0],401);
  assert.deepEqual((await finder(prompt))[1].reservation,{id:contact.contactId,title:'Fone azul',requesterName:'Pessoa Silva'});
  for (const client of [winner,loser]) assert.equal((await client(prompt))[1].reservation,null);
  assert.equal(inbox.contacts[0].phone,'5516999999999');
  assert.equal((await winner('/api/contacts/'+contact.contactId,{action:'cancel'},{method:'PATCH'}))[0],200);
  assert.equal((await winner(path))[1].item.status,'open');
  const reopened=(await winner(path+'/whatsapp',{}))[1];
  assert.equal(reopened.lostId,contact.lostId);
  assert.notEqual(reopened.contactId,contact.contactId);
  const respond = (id,action) => finder('/api/contacts/'+id,{action,reservationPrompt:true},{method:'PATCH'});
  assert.equal((await respond(contact.contactId,'reject'))[0],409);
  assert.equal((await respond(reopened.contactId,'reject'))[0],200);
  assert.equal((await finder(prompt))[1].reservation,null);
  assert.equal((await winner(path))[1].item.status,'open');
  const third = (await winner(path+'/whatsapp',{}))[1];
  assert.equal((await respond(third.contactId,'approve'))[0],200);
  assert.equal((await finder(prompt))[1].reservation,null);
  assert.equal((await respond(third.contactId,'reject'))[0],409);
  assert.equal((await winner(path))[1].item.status,'reserved');
  assert.equal((await finder(path+'/return',{returnedOn:today()}))[0],201);
  assert.equal((await winner('/api/mine?kind=lost'))[1].items[0].status,'recovered');
  assert.equal((await winner(path+'/whatsapp',{}))[0],409);
});

test('WhatsApp do setor exige número configurado e respeita a reserva administrativa', async t => {
  const local = app();
  t.after(local.close);
  const finder=local.client(), owner=local.client(), staff=local.client();
  await finder('/api/auth/register',account('Ana Barbosa','ana@example.test'));
  await owner('/api/auth/register',account('Lucas Martins','lucas@example.test'));
  await staff('/api/auth/register',account('Equipe Campus','setor@example.test'));
  await staff('/api/bootstrap/admin',{},{headers:{Authorization:'Bearer '+local.bootstrapToken}});
  const upload=(await finder('/api/media',photo,{binary:true}))[1];
  const found=(await finder('/api/items',object('Fone da biblioteca',{photos:[upload.id],custody:'campus'})))[1].item;
  const path='/api/items/'+found.id;
  assert.equal((await owner(path+'/whatsapp',{}))[0],409);
  assert.equal((await owner('/api/mine?kind=lost'))[1].total,0);
  assert.equal((await owner(path))[1].item.status,'open');
  await staff('/api/admin/settings',{phone:'16988883333',location:'Secretaria',hours:'Segunda a sexta'},{method:'PATCH'});
  const lost=(await owner('/api/items',object('Fone perdido',{kind:'lost'})))[1].item;
  assert.equal((await staff('/api/admin/items/'+found.id+'/action',{action:'reserve',lostId:lost.id}))[0],200);
  assert.equal((await staff(path+'/whatsapp',{}))[0],409);
  assert.equal((await owner(path))[1].item.reservedForMe,true);
  const [status,contact]=await owner(path+'/whatsapp',{lostId:lost.id});
  assert.equal(status,200,JSON.stringify(contact));
  assert.equal(contact.lostId,lost.id);
  const prompt = '/api/contacts/pending-reservation';
  assert.equal((await finder(prompt))[1].reservation,null);
  assert.equal((await owner(prompt))[1].reservation,null);
  assert.deepEqual((await staff(prompt))[1].reservation,{id:contact.contactId,title:'Fone da biblioteca',requesterName:'Lucas Martins'});
  assert.equal(new URL(contact.url).pathname,'/5516988883333');
  assert.equal((await staff(path+'/return',{returnedOn:today()}))[0],201);
});

test('Meu item foi encontrado permite selecionar outra categoria e um achado antigo até a avaliação',async t=>{
  const local=app();
  t.after(local.close);
  const finder=local.client(),owner=local.client(),guest=local.client();
  await finder('/api/auth/register',account('Ana Barbosa','ana@example.test'));
  await owner('/api/auth/register',account('Lucas Martins','lucas@example.test'));
  const image=(await finder('/api/media',photo,{binary:true}))[1].id;
  const found=(await finder('/api/items',object('Estojo preto',{photos:[image],occurredOn:'2024-01-20'})))[1].item;
  const lost=(await owner('/api/items',object('Meu estojo',{kind:'lost',categoryId:'acessorios'})))[1].item;
  const matches='/api/items/'+lost.id+'/matches';
  assert.equal((await guest(matches))[0],401);
  assert.ok((await owner(matches))[1].items.some(x=>x.id===found.id));
  const path='/api/items/'+found.id;
  const [code,contact]=await owner(path+'/whatsapp',{lostId:lost.id});
  assert.equal(code,200,JSON.stringify(contact));
  assert.equal(contact.lostId,lost.id);
  assert.equal((await finder(path+'/return',{returnedOn:today()}))[0],201);
  assert.equal((await owner(path+'/rating',{score:5,comment:'Recebi o estojo.'}))[0],201);
  const record=(await owner('/api/mine?kind=lost'))[1].items[0];
  assert.equal(record.status,'recovered');
  assert.equal(record.recoveredItemId,found.id);
  assert.equal(record.recipientRating,5);
});

test('painel exclusivo e senha de oito caracteres', async t => {
  const local = app();
  t.after(local.close);
  const member = local.client(), admin = local.client(), guest = local.client();
  const email = 'lrpj@gmail.com';
  local.env.CAMPUS_ADMIN_EMAIL = email;
  const old = await member('/api/auth/register',account('Usuário anterior','outro@example.test'));
  local.sqlite.prepare("UPDATE users SET role='admin' WHERE id=?").run(old[1].user.id);
  const setup = await readFile(new URL('../scripts/configure-campus-admin.sql',import.meta.url),'utf8');
  local.sqlite.exec(setup);
  assert.equal((await member('/api/admin/overview'))[0],401);
  assert.equal((await member('/api/auth/login',{email:'outro@example.test',password}))[1].user.role,'user');
  assert.equal((await member('/api/admin/overview'))[0],403);
  assert.equal((await guest('/api/admin/overview'))[0],401);
  assert.throws(()=>local.sqlite.prepare("UPDATE users SET role='admin' WHERE id=?").run(old[1].user.id));
  const token = crypto.randomUUID().replaceAll('-','')+'12345678901';
  local.sqlite.prepare("INSERT INTO password_resets(token_hash,user_id,expires_at) SELECT ?,id,unixepoch()+600 FROM users WHERE email=?").run(await digest(token),email);
  assert.equal((await admin('/api/auth/reset',{token,password:'1234567'}))[0],400);
  assert.equal((await admin('/api/auth/reset',{token,password:'12345678'}))[0],200);
  assert.equal((await admin('/api/auth/reset',{token,password:'12345678'}))[0],400);
  assert.equal((await admin('/api/auth/login',{email,password:'12345678'}))[1].user.role,'admin');
  assert.equal((await admin('/api/admin/overview'))[0],200);

  const futureAdmin = local.client();
  const jessica = 'jessica@gmail.com';
  const oldJessica = await futureAdmin('/api/auth/register',account('Jéssica',jessica));
  const staffSetup = await readFile(new URL('../scripts/configure-campus-staff.sql',import.meta.url),'utf8');
  local.sqlite.exec(staffSetup);
  const target = oldJessica[1].user.id;
  const activation = '/api/admin/users/'+target+'/activation';
  assert.equal((await futureAdmin('/api/admin/overview'))[0],401);
  assert.equal((await futureAdmin('/api/auth/login',{email:jessica,password}))[0],401);
  assert.equal((await admin('/api/admin/overview'))[0],200);
  assert.equal((await member(activation,{}))[0],403);
  const [invited,invite] = await admin(activation,{});
  assert.equal(invited,200);
  const activeInvite = (await admin(activation,{}))[1];
  assert.equal((await futureAdmin('/api/auth/reset',{token:invite.token,password:'Campus98'}))[0],400);
  assert.equal((await futureAdmin('/api/auth/reset',{token:activeInvite.token,password:'Campus98'}))[0],200);
  local.sqlite.exec(staffSetup);
  assert.equal((await futureAdmin('/api/auth/login',{email:jessica,password:'Campus98'}))[1].user.role,'admin');
  assert.equal((await futureAdmin('/api/admin/overview'))[0],200);
  assert.equal((await futureAdmin(activation,{}))[0],403);
  assert.equal((await admin(activation,{}))[0],409);
  assert.equal((await member('/api/admin/overview'))[0],403);
  assert.throws(()=>local.sqlite.prepare("UPDATE users SET role='admin' WHERE id=?").run(old[1].user.id));

});

test('conta comum aceita oito caracteres no cadastro e no login', async t => {
  const local = app();
  t.after(local.close);
  const visitor = local.client();
  const registration = account('Visitante do Campus', 'visitante@example.test');
  const credential = 'campus28';
  const [invalid, error] = await visitor('/api/auth/register', {
    ...registration, password: credential.slice(0, 7)
  });
  assert.equal(invalid, 400);
  assert.match(error.error, /8/);
  const [created, result] = await visitor('/api/auth/register', {
    ...registration, password: credential
  });
  assert.equal(created, 201);
  assert.equal(result.user.role, 'user');
  const fresh = local.client();
  const [loggedIn, session] = await fresh('/api/auth/login', {
    email: registration.email, password: credential
  });
  assert.equal(loggedIn, 200);
  assert.equal(session.user.id, result.user.id);
  assert.equal((await fresh('/api/admin/overview'))[0], 403);
});
