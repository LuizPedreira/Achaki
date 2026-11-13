import { HttpError, db, first, json, now, readJSON, requireAdmin, secureResponse } from './http.mjs';
import * as auth from './auth.mjs';
import * as items from './items.mjs';
import * as media from './media.mjs';
import * as requests from './requests.mjs';
import * as admin from './admin.mjs';
export { PasswordDerivations } from './passwords.mjs';

const routes = [
  ['GET', /^\/meta$/, async ({ env, user }) => json({ ...await items.metadata(env), user: auth.userView(user),
    features: { sso: auth.ssoEnabled(env), reset: auth.emailEnabled(env), suggestions: media.suggestionsEnabled(env) } })],
  ['GET', /^\/items$/, async ({ env, url }) => json(await items.listItems(env, url.searchParams))],
  ['GET', /^\/items\/([^/]+)$/, ({ env, user }, id) => items.itemDetails(env,user,id)],
  ['POST', /^\/items$/, ({ env,user,body }) => items.createItem(env,user,body)],
  ['POST', /^\/items\/([^/]+)\/transfer$/, ({ env,user }, id) => items.transferToCampus(env,user,id)],
  ['GET', /^\/items\/([^/]+)\/matches$/, ({ env,user }, id) => items.listMatches(env,user,id)],
  ['POST', /^\/items\/([^/]+)\/contact$/, ({ env,user,body }, id) => requests.requestContact(env,user,id,body)],
  ['POST', /^\/items\/([^/]+)\/return$/, ({ env,user,body }, id) => requests.returnItem(env,user,id,body)],
  ['POST', /^\/items\/([^/]+)\/rating$/, ({ env,user,body }, id) => requests.rating(env,user,id,body)],
  ['GET', /^\/mine$/, async ({ env,user,url }) => json(await items.listItems(env,url.searchParams,{ mode: 'mine',user }))],
  ['GET', /^\/ratings$/, ({ env,user }) => requests.myRatings(env,user)],
  ['GET', /^\/returns$/, ({ env,user }) => requests.myReturns(env,user)],
  ['GET', /^\/contacts$/, ({ env,user,url }) => requests.inbox(env,user,url.searchParams)],
  ['PATCH', /^\/contacts\/([^/]+)$/, ({ env,user,body }, id) => requests.reviewContact(env,user,id,body)],
  ['GET', /^\/media\/([^/]+)$/, ({ env,user }, id) => media.readPhoto(env,user,id)],
  ['POST', /^\/media$/, ({ env,request,user }) => media.upload(env,request,user), 'binary'],
  ['POST', /^\/media\/suggestion$/, ({ env,request,user }) => media.suggestCategory(env,request,user), 'binary'],
  ['POST', /^\/auth\/register$/, ({ env,request,body }) => auth.register(env,request,body)],
  ['POST', /^\/auth\/login$/, ({ env,request,body }) => auth.login(env,request,body)],
  ['POST', /^\/auth\/logout$/, ({ env,request }) => auth.logout(env,request)],
  ['POST', /^\/auth\/forgot$/, ({ env,request,body }) => auth.forgot(env,request,body)],
  ['POST', /^\/auth\/reset$/, ({ env,request,body }) => auth.reset(env,request,body)],
  ['GET', /^\/auth\/microsoft$/, ({ env,request,url,user }) => auth.startMicrosoft(env,request,url,user)],
  ['GET', /^\/auth\/microsoft\/callback$/, ({ env,request,url,user }) => auth.finishMicrosoft(env,request,url,user)],
  ['PATCH', /^\/profile$/, ({ env,user,body }) => auth.profile(env,user,body)],
  ['POST', /^\/profile\/password$/, ({ env,request,user,body }) => auth.changePassword(env,request,user,body)],
  ['POST', /^\/bootstrap\/admin$/, ({ env,request,user }) => auth.bootstrapAdmin(env,request,user)],
  ['GET', /^\/admin\/overview$/, ({ env }) => admin.dashboard(env)],
  ['GET', /^\/admin\/items$/, async ({ env,url }) => json(await items.listItems(env,url.searchParams,{ mode: 'admin' }))],
  ['GET', /^\/admin\/items\/([^/]+)\/details$/, ({ env },id) => requests.adminDetails(env,id)],
  ['PATCH', /^\/admin\/items\/([^/]+)$/, ({ env,user,body },id) => items.editItem(env,user,id,body)],
  ['POST', /^\/admin\/items\/([^/]+)\/action$/, ({ env,user,body },id) => admin.manageItem(env,user,id,body)],
  ['GET', /^\/admin\/items\/([^/]+)\/candidates$/, ({ env },id) => admin.lostCandidates(env,id)],
  ['GET', /^\/admin\/users$/, ({ env,url }) => admin.users(env,url.searchParams)],
  ['PATCH', /^\/admin\/users\/([^/]+)$/, ({ env,user,body },id) => admin.editUser(env,user,id,body)],
  ['GET', /^\/admin\/settings$/, ({ env }) => admin.adminSettings(env)],
  ['PATCH', /^\/admin\/settings$/, ({ env,body }) => admin.updateSettings(env,body)],
  ['POST', /^\/admin\/(categories|locations)$/, ({ env,body },type) => admin.updateCatalog(env,type,null,body)],
  ['PATCH', /^\/admin\/(categories|locations)\/([a-z0-9-]+)$/, ({ env,body },type,id) => admin.updateCatalog(env,type,id,body)],
  ['GET', /^\/admin\/history\.csv$/, ({ env,url }) => admin.exportHistory(env,url.searchParams)]
];

const htmlRoute = /^\/(?:item\/[a-f0-9-]{36}|novo(?:\/(?:found|lost))?|meus-registros|entrar|cadastro|recuperar-senha|redefinir-senha|configurar-admin|perfil|ajuda|painel(?:\/(?:encontrados|perdidos|solicitacoes|historico|usuarios|configuracoes))?)?\/?$/i;
const assetRoute = /^\/(?:app\.js|icons\.js|styles\.css|favicon\.png|manifest\.webmanifest|sw\.js|icons\/icon-(?:192|512)\.png|fonts\/inter\.woff2|vendor\/qr-creator\.js)$/;

async function handle(request, env) {
  const url = new URL(request.url);
  const path = url.pathname;
  if (!path.startsWith('/api/')) {
    if (!['GET','HEAD'].includes(request.method)) throw new HttpError(405,'Método não permitido.');
    if (htmlRoute.test(path)) {
      const origin = new URL('/index.html', request.url);
      const response = await env.ASSETS.fetch(new Request(origin, request));
      const html = new Response(response.body, { status:response.status,statusText:response.statusText,headers:response.headers });
      html.headers.set('Cache-Control', 'no-cache');
      return html;
    }
    if (assetRoute.test(path)) return env.ASSETS.fetch(request);
    throw new HttpError(404, 'Página não encontrada.');
  }
  if (path === '/api/health' && request.method === 'GET') {
    const record = await first(env, 'SELECT id FROM settings WHERE id = 1');
    return json({ ok: Boolean(record) }, record ? 200 : 503);
  }
  const routePath = path.slice(4);
  const match = routes.find(([method, pattern]) => request.method === method && pattern.test(routePath));
  if (!match) throw new HttpError(404, 'Recurso não encontrado.');
  const mutates = !['GET','HEAD'].includes(request.method);
  const origin = request.headers.get('Origin');
  if (mutates && ((origin && origin !== url.origin) || request.headers.get('Sec-Fetch-Site') === 'cross-site' ||
      (!origin && request.headers.has('Cookie')))) throw new HttpError(403, 'Origem da solicitação inválida.');
  const user = await auth.sessionUser(env,request);
  if (routePath.startsWith('/admin/')) requireAdmin(user);
  const body = mutates && match[3] !== 'binary' ? await readJSON(request) : null;
  return match[2]({ env, request, url, user, body }, ...routePath.match(match[1]).slice(1));
}

export default {
  async fetch(request, env) {
    try {
      return secureResponse(await handle(request,env));
    } catch (error) {
      if (error instanceof HttpError) return secureResponse(json({ error: error.message },error.status));
      console.error('Achaki request failed', error.name, error.stack?.split('\n').slice(1,4).join('\n'));
      return secureResponse(json({ error: 'O sistema não pôde concluir a operação. Tente novamente em instantes.' },500));
    }
  },
  async scheduled(_controller, env) {
    const time = now();
    await env.DB.batch(['sessions','password_resets','oauth_states','limits'].map(table =>
      db(env, `DELETE FROM ${table} WHERE expires_at <= ?`,time)));
    await media.cleanupPhotos(env);
  }
};
