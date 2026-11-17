import { createServer } from 'node:http';
import { Readable } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import { resolve } from 'node:path';
import { loadEnvFile } from 'node:process';
import { fileURLToPath } from 'node:url';
import worker from '../src/worker.mjs';
import { createLocalEnv,demoPassword,demoUsers,seedDemo } from './local-env.mjs';

const root = fileURLToPath(new URL('../',import.meta.url));
try { loadEnvFile(resolve(root,'.dev.vars')); } catch (error) { if (error.code !== 'ENOENT') throw error; }
const demo = process.argv.includes('--demo');
const portFlag = process.argv.indexOf('--port');
const port = Number(portFlag >= 0 ? process.argv[portFlag + 1] : 8787);
if (!Number.isInteger(port) || port < 1024 || port > 65535) throw new Error('Informe uma porta entre 1024 e 65535.');
const origin = `http://127.0.0.1:${port}`;
const folder = resolve(root,'.local',demo ? 'demo' : 'development');
const local = createLocalEnv({
  folder, origin, bootstrapToken:process.env.ADMIN_BOOTSTRAP_TOKEN,
  mail:{ send:async ({ to,url }) => console.log(`\nE-mail local para ${to}\n${url}\n`) }
});
if (demo) await seedDemo(local.env);
const server = createServer(async (req,res) => {
  try {
    const fullUrl = new URL(req.url || '/',origin);
    if (fullUrl.origin !== origin || req.headers.host !== `127.0.0.1:${port}`) return res.writeHead(403).end();
    const methodsWithBody = !['GET','HEAD'].includes(req.method);
    const request = new Request(fullUrl,{
      method:req.method,headers:req.headers,
      ...(methodsWithBody ? { body:Readable.toWeb(req),duplex:'half' } : {})
    });
    const result = await worker.fetch(request,local.env);
    for (const [name,value] of result.headers) if (name !== 'set-cookie') res.setHeader(name,value);
    const cookies = result.headers.getSetCookie();
    if (cookies.length) res.setHeader('Set-Cookie',cookies);
    res.writeHead(result.status);
    if (result.body && req.method !== 'HEAD') await pipeline(Readable.fromWeb(result.body),res);
    else res.end();
  } catch (error) {
    if (!res.headersSent) res.writeHead(500);
    res.end();
    if (error.code !== 'ERR_STREAM_PREMATURE_CLOSE') console.error(error.message);
  }
});
server.listen(port,'127.0.0.1',() => {
  console.log(`Achaki em ${origin}`);
  if (demo) {
    console.log(`Demonstração local. Senha das contas de exemplo: ${demoPassword}`);
    for (const user of demoUsers) console.log(`- ${user.email} [${user.role}]`);
  }
});
process.on('SIGINT',() => server.close(() => local.close()));
process.on('SIGTERM',() => server.close(() => local.close()));
