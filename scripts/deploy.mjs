import { existsSync } from 'node:fs';
import { readFile,writeFile } from 'node:fs/promises';
import { spawnSync } from 'node:child_process';
import { dirname,join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('../',import.meta.url));
const source = JSON.parse(await readFile(new URL('../wrangler.jsonc',import.meta.url),'utf8'));
const destination = 'wrangler.production.json';
const flags = new Set(process.argv.slice(2));
for (const flag of flags) {
  if (!['--suggestions','--dry-run'].includes(flag)) throw new Error(`Opção desconhecida: ${flag}`);
}
const npxCli = join(dirname(process.execPath),'node_modules','npm','bin','npx-cli.js');
const bundled = existsSync(npxCli);
const windowsShim = process.platform === 'win32' && !bundled;
const command = bundled ? process.execPath : windowsShim ? 'npx.cmd' : 'npx';
const prefix = [...(bundled ? [npxCli] : []),'--yes','wrangler@4.162.0'];
const production = ['--config',destination];
const db = source.d1_databases[0];
const photo = source.r2_buckets[0];

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

async function deploy() {
  let database = databaseList().find(entry => entry.name === db.database_name);
  const check = flags.has('--dry-run');
  if (!database && !check) {
    wrangler(['d1','create',db.database_name]);
    database = databaseList().find(entry => entry.name === db.database_name);
  }
  if (!database || !/^[0-9a-f-]{36}$/i.test(database.uuid || '')) {
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
  if (flags.has('--suggestions')) {
    source.ai = { binding:'AI' };
    source.vars.IMAGE_SUGGESTIONS = 'true';
  }
  if (process.env.CLOUDFLARE_ACCOUNT_ID) {
    if (!/^[0-9a-f]{32}$/i.test(process.env.CLOUDFLARE_ACCOUNT_ID)) throw new Error('CLOUDFLARE_ACCOUNT_ID inválido.');
    source.account_id = process.env.CLOUDFLARE_ACCOUNT_ID;
  }
  await writeFile(join(root,destination),JSON.stringify(source,null,2) + '\n');
  wrangler(['deploy','--dry-run',...production]);
  if (check) return;
  wrangler(['d1','migrations','apply',db.database_name,'--remote',...production]);
  wrangler(['deploy',...production]);
  const health = new URL('/api/health',source.vars.APP_ORIGIN);
  for (let attempt = 0; attempt < 5; attempt++) {
    try {
      const response = await fetch(health,{ signal:AbortSignal.timeout(4000) });
      if (response.ok && (await response.json()).ok === true) {
        console.log(`Banco e domínio verificados em ${source.vars.APP_ORIGIN}`);
        return;
      }
    } catch {}
    if (attempt < 4) await new Promise(resolve => setTimeout(resolve,5000));
  }
  throw new Error(`O Wrangler concluiu a publicação, mas o endpoint ${health.href} ainda não respondeu com o banco disponível.`);
}

try { await deploy(); }
catch (error) {
  console.error(error.message);
  process.exitCode = 1;
}
