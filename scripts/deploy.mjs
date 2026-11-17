import { existsSync } from 'node:fs';
import { readFile,writeFile } from 'node:fs/promises';
import { spawnSync } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { dirname,join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('../',import.meta.url));
const source = JSON.parse(await readFile(new URL('../wrangler.jsonc',import.meta.url),'utf8'));
const destination = 'wrangler.production.json';
const flags = new Set(process.argv.slice(2));
for (const flag of flags) {
  if (!['--suggestions','--dry-run','--workers-build'].includes(flag)) throw new Error(`Opção desconhecida: ${flag}`);
}
const npxCli = join(dirname(process.execPath),'node_modules','npm','bin','npx-cli.js');
const bundled = existsSync(npxCli);
const windowsShim = process.platform === 'win32' && !bundled;
const command = bundled ? process.execPath : windowsShim ? 'npx.cmd' : 'npx';
const prefix = [...(bundled ? [npxCli] : []),'--yes','wrangler@4.162.0'];
const production = ['--config',destination];
const db = source.d1_databases[0];
const photo = source.r2_buckets[0];
const workersBuild = flags.has('--workers-build');
const uuid = /^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i;

function wrangler(args, { capture = false } = {}) {
  const result = spawnSync(command,[...prefix,...args],{
    cwd:root,encoding:'utf8',shell:windowsShim,stdio:capture ? ['ignore','pipe','pipe'] : 'inherit',
    env:{ ...process.env,NO_COLOR:'1',WRANGLER_SEND_METRICS:'false' }
  });
  if (result.error) throw result.error;
  if (result.status !== 0) {
    if (capture) process.stderr.write(result.stderr || result.stdout || '');
    const error = new Error(`Falhou: wrangler ${args.join(' ')}`);
    error.diagnostics = [result.stderr,result.stdout].filter(Boolean).join('\n');
    throw error;
  }
  return result.stdout;
}

function databaseList() {
  const stdout = wrangler(['d1','list','--json'],{ capture:true });
  const entries = JSON.parse(stdout);
  if (!Array.isArray(entries)) throw new Error('Resposta inesperada ao listar os bancos D1.');
  return entries;
}

async function verifyPublication(origin, release) {
  const health = new URL('/api/health',origin);
  let ready = false;
  for (let attempt = 0; attempt < 10; attempt++) {
    try {
      const response = await fetch(health,{ redirect:'error',signal:AbortSignal.timeout(5000) });
      if (response.ok) {
        const data = await response.json();
        ready = data.ok === true && data.release === release;
        if (ready) break;
      }
    } catch {}
    if (attempt < 9) await new Promise(resolve => setTimeout(resolve,5000));
  }
  if (!ready) throw new Error(`O Wrangler concluiu a publicação. O domínio ${origin} ainda não retornou a nova versão com o banco disponível.`);

  const response = await fetch(new URL('/api/auth/login',origin),{
    method:'POST', redirect:'error', signal:AbortSignal.timeout(20000),
    headers:{ 'Content-Type':'application/json', Origin:origin },
    body:JSON.stringify({ email:`verificacao-${randomUUID()}@example.invalid`, password:randomUUID() })
  });
  const data = await response.json().catch(() => ({}));
  if (response.status !== 401 || data.error !== 'E-mail ou senha incorretos.' || response.headers.has('Set-Cookie')) {
    throw new Error(`A nova versão respondeu em ${origin}, mas o teste de autenticação falhou com HTTP ${response.status}.`);
  }
  console.log(`Nova versão, banco e autenticação verificados em ${origin}`);
}

function provisionResources(check) {
  let database = databaseList().find(entry => entry.name === db.database_name);
  if (!database && !check) {
    wrangler(['d1','create',db.database_name]);
    database = databaseList().find(entry => entry.name === db.database_name);
  }
  if (!database || !uuid.test(database.uuid || '')) {
    throw new Error('O banco D1 ainda não existe. Execute o comando sem --dry-run para criá-lo.');
  }
  db.database_id = database.uuid;
  let hasBucket = false;
  try {
    const bucket = JSON.parse(wrangler(['r2','bucket','info',photo.bucket_name,'--json'],{ capture:true }));
    hasBucket = Boolean(bucket && typeof bucket === 'object');
  } catch (error) {
    if (!/10006|bucket not found|bucket does not exist|specified bucket does not exist/i.test(error.diagnostics || '')) throw error;
  }
  if (!hasBucket) {
    if (check) throw new Error('O bucket de fotos ainda não existe. Execute o comando sem --dry-run para criá-lo.');
    wrangler(['r2','bucket','create',photo.bucket_name]);
  }
}

async function deploy() {
  const check = flags.has('--dry-run');
  if (workersBuild) {
    const databaseId = process.env.CLOUDFLARE_D1_DATABASE_ID;
    if (!uuid.test(databaseId || '') || databaseId === db.database_id) {
      throw new Error('Defina CLOUDFLARE_D1_DATABASE_ID com o identificador do D1 existente.');
    }
    db.database_id = databaseId;
  } else {
    provisionResources(check);
  }
  if (flags.has('--suggestions')) {
    source.ai = { binding:'AI' };
    source.vars.IMAGE_SUGGESTIONS = 'true';
  }
  if (process.env.CLOUDFLARE_ACCOUNT_ID) {
    if (!/^[0-9a-f]{32}$/i.test(process.env.CLOUDFLARE_ACCOUNT_ID)) throw new Error('CLOUDFLARE_ACCOUNT_ID inválido.');
    source.account_id = process.env.CLOUDFLARE_ACCOUNT_ID;
  }
  const commit = process.env.WORKERS_CI_COMMIT_SHA || '';
  source.vars.APP_RELEASE = workersBuild && /^[0-9a-f]{40}$/i.test(commit) ? commit : randomUUID();
  await writeFile(join(root,destination),JSON.stringify(source,null,2) + '\n');
  wrangler(['deploy','--dry-run',...production]);
  if (check) return;
  if (!workersBuild) wrangler(['d1','migrations','apply',db.database_name,'--remote',...production]);
  wrangler(['deploy',...production]);
  await verifyPublication(source.vars.APP_ORIGIN,source.vars.APP_RELEASE);
}

try { await deploy(); }
catch (error) {
  console.error(error.message);
  process.exitCode = 1;
}
