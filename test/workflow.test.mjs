import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { test } from 'node:test';
import worker from '../src/worker.mjs';
import { createLocalEnv } from '../scripts/local-env.mjs';
import { today } from '../src/http.mjs';

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
  assert.equal((await visitor('/api/items/' + claim.contact.lostId))[0],404);
  assert.equal((await owner('/api/mine?kind=lost'))[1].items[0].id,claim.contact.lostId);
  assert.equal((await owner('/api/items/' + claim.contact.lostId + '/matches'))[1].items[0].id,item);
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
  assert.equal(data.item.publication,'pending');
  assert.equal((await publicClient('/api/items/' + item))[0],404);
  assert.equal((await staff('/api/admin/items/' + item + '/action',{ action:'approve' }))[0],200);
  assert.equal((await staff('/api/admin/items/' + item + '/candidates'))[1].items[0].id,lost);
  const contact = (await owner('/api/items/' + item + '/contact',{ lostId:lost,message:'O estojo tem uma marca azul e um risco.' }))[1].contact;
  assert.equal((await finder('/api/contacts/' + contact.id,{ action:'approve' },{ method:'PATCH' }))[0],403);
  assert.equal((await staff('/api/contacts?scope=campus'))[1].contacts[0].id,contact.id);
  assert.equal((await staff('/api/admin/items/' + item + '/action',{ action:'reserve',lostId:lost }))[0],200);
  assert.equal((await staff('/api/contacts/' + contact.id,{ action:'approve' },{ method:'PATCH' }))[0],200);
  assert.equal((await owner('/api/contacts'))[1].contacts[0].sector.location,'Secretaria');
  assert.equal((await finder('/api/items/' + item + '/return',{ returnedOn:today() }))[0],403);
  assert.equal((await staff('/api/items/' + item + '/return',{ returnedOn:today(),notes:'Entregue na secretaria.' }))[0],201);
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
  assert.match(await css.text(),/\.hero-graphic/);
  assert.equal((await client('/api/health'))[0],200);
  assert.equal((await client('/api/media/suggestion',photo,{ binary:true }))[0],401);
  await client('/api/auth/register',account('Ana Barbosa','ana@example.test'));
  assert.equal((await client('/api/media/suggestion',photo,{ binary:true }))[1].category.id,'eletronicos');
  assert.equal((await client('/api/media',new Uint8Array(30),{ binary:true }))[0],415);
});

test('o domínio de produção redireciona a HTTP e protege as sessões no HTTPS', async t => {
  const production = 'https://achaki.jrsites.online';
  const { env,close } = createLocalEnv({ origin:production });
  t.after(close);
  const insecure = await worker.fetch(new Request('http://achaki.jrsites.online/meus-registros'),env);
  assert.equal(insecure.status,308);
  assert.equal(insecure.headers.get('Location'),production + '/meus-registros');
  const registered = await worker.fetch(new Request(production + '/api/auth/register',{
    method:'POST',headers:{ 'Content-Type':'application/json',Origin:production },
    body:JSON.stringify(account('Ana Barbosa','ana@example.test'))
  }),env);
  assert.equal(registered.status,201);
  assert.equal(registered.headers.get('Strict-Transport-Security'),'max-age=31536000');
  assert.match(registered.headers.get('Set-Cookie'),/^__Host-achaki_session=.*; Path=\/; HttpOnly; SameSite=Lax; Secure$/);
});
