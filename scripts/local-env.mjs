import { DatabaseSync } from 'node:sqlite';
import { mkdirSync, readFileSync, openAsBlob } from 'node:fs';
import * as fs from 'node:fs/promises';
import { dirname, extname, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { PasswordDerivations } from '../src/passwords.mjs';
import { hashPassword } from '../src/auth.mjs';
import { today } from '../src/http.mjs';
import { prepareItem,itemValues } from '../src/items.mjs';

const root = fileURLToPath(new URL('../',import.meta.url));
const publicDir = resolve(root,'public');
const migration = readFileSync(new URL('../migrations/0001_achaki.sql',import.meta.url),'utf8');
const mimeTypes = {
  '.html':'text/html; charset=utf-8', '.css':'text/css; charset=utf-8',
  '.js':'text/javascript; charset=utf-8', '.json':'application/json',
  '.webmanifest':'application/manifest+json', '.png':'image/png',
  '.jpg':'image/jpeg', '.woff2':'font/woff2', '.txt':'text/plain; charset=utf-8'
};

function query(sqlite, queryText, parameters = []) {
  const execute = () => sqlite.prepare(queryText);
  return {
    bind: (...values) => query(sqlite,queryText,values),
    first: async () => execute().get(...parameters) || null,
    all: async () => ({ results:execute().all(...parameters) }),
    run: async () => {
      const result = execute().run(...parameters);
      return { success:true, meta:{ changes:Number(result.changes) } };
    },
    batchResult() {
      const statement = execute();
      if (statement.columns().length > 0) return { success:true, results:statement.all(...parameters),meta:{ changes:0 } };
      return { success:true, results:[],meta:{ changes:Number(statement.run(...parameters).changes) } };
    }
  };
}

function assets(publicPath) {
  const canonical = resolve(publicPath);
  return {
    async fetch(request) {
      const url = new URL(request.url);
      const path = resolve(canonical, '.' + decodeURIComponent(url.pathname));
      if (!path.startsWith(canonical + sep)) return new Response('Arquivo não encontrado',{ status:404 });
      try {
        const file = await openAsBlob(path,{ type:mimeTypes[extname(path)] || 'application/octet-stream' });
        return new Response(request.method === 'HEAD' ? null : file,{ headers:{ 'Content-Type':file.type,'Content-Length':file.size } });
      } catch {
        return new Response('Arquivo não encontrado',{ status:404 });
      }
    }
  };
}

export function createLocalEnv({ folder = '', origin = 'http://127.0.0.1:8787', mail, bootstrapToken, ai } = {}) {
  const dbPath = folder ? resolve(folder,'achaki.sqlite') : ':memory:';
  if (folder) mkdirSync(dirname(dbPath),{ recursive:true });
  const sqlite = new DatabaseSync(dbPath,{ enableForeignKeyConstraints:true });
  if (!sqlite.prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'settings'").get()) sqlite.exec(`BEGIN;\n${migration}\nCOMMIT;`);
  const memory = new Map();
  const photosPath = folder && resolve(folder,'photos');
  const cryptoWorker = new PasswordDerivations();
  const checkedPhoto = id => {
    if (!/^[a-f0-9-]{36}$/i.test(id)) throw new Error('Invalid object key');
    return photosPath && resolve(photosPath,id);
  };
  const env = {
    APP_ORIGIN:origin, MAIL_DEV:mail, ADMIN_BOOTSTRAP_TOKEN:bootstrapToken,
    AI:ai, IMAGE_SUGGESTIONS:ai ? 'true' : 'false',
    ASSETS:assets(publicDir),
    PASSWORDS:{ idFromName:name => name, get:() => cryptoWorker },
    DB:{
      prepare: text => query(sqlite,text),
      async batch(statements) {
        sqlite.exec('BEGIN IMMEDIATE');
        try {
          const output = statements.map(statement => statement.batchResult());
          sqlite.exec('COMMIT');
          return output;
        } catch (error) {
          sqlite.exec('ROLLBACK');
          throw error;
        }
      }
    },
    PHOTOS:{
      async put(key,data) {
        const path = checkedPhoto(key);
        if (!photosPath) { memory.set(key,data); return; }
        await fs.mkdir(photosPath,{ recursive:true });
        await fs.writeFile(path,data);
      },
      async get(key) {
        const path = checkedPhoto(key);
        if (!photosPath) return memory.has(key) ? { body:memory.get(key) } : null;
        try { return { body:(await openAsBlob(path)).stream() }; }
        catch (error) { if (error.code === 'ENOENT' || error.code === 'ERR_INVALID_ARG_VALUE') return null; throw error; }
      },
      async delete(keys) {
        for (const key of [keys].flat()) {
          const path = checkedPhoto(key);
          if (photosPath) await fs.rm(path,{ force:true });
          else memory.delete(key);
        }
      }
    }
  };
  return { env,sqlite,close:() => sqlite.close() };
}

export const demoUsers = [
  { name:'Ana Barbosa',email:'ana@demo.achaki.test',role:'user' },
  { name:'Lucas Martins',email:'lucas@demo.achaki.test',role:'user' },
  { name:'Setor Achados e Perdidos',email:'setor@demo.achaki.test',role:'admin' }
];
export const demoPassword = 'AchakiDemo2026!';

export async function seedDemo(env) {
  for (const entry of demoUsers) {
    const user = await env.DB.prepare('SELECT id FROM users WHERE email = ?').bind(entry.email).first();
    if (!user) {
      await env.DB.prepare('INSERT INTO users(id,name,email,phone,role,password_hash) VALUES (?,?,?,?,?,?)').bind(
        crypto.randomUUID(),entry.name,entry.email,'5516000000000',entry.role,await hashPassword(env,demoPassword)).run();
    }
  }
  if ((await env.DB.prepare('SELECT count(*) AS total FROM items').first()).total) return;
  const [ana,lucas,staff] = await Promise.all(demoUsers.map(user =>
    env.DB.prepare('SELECT id FROM users WHERE email = ?').bind(user.email).first()));
  for (const example of [
    ['Fone de ouvido Bluetooth','Fone preto com estojo. Encontrado sobre a bancada perto da entrada do laboratório.','eletronicos','Laboratório de Informática 3','finder','fone.jpg',ana.id],
    ['Carteira marrom','Carteira pequena de couro marrom. Localizada próximo às mesas da cantina ao fim da aula.','acessorios','Cantina','campus','carteira.jpg',staff.id],
    ['Chave de carro','Chave com controle preto encontrada próxima à entrada do estacionamento.','acessorios','Estacionamento','finder','chave-carro.jpg',lucas.id]
  ]) {
    const [title,description,categoryId,location,custody,photo,authorId] = example;
    const values = itemValues(await prepareItem(env,{ title,description,categoryId,location,custody,occurredOn:today() },'found'));
    const itemId = crypto.randomUUID();
    const photoId = crypto.randomUUID();
    await env.PHOTOS.put(photoId,await fs.readFile(resolve(root,'fixtures',photo)));
    await env.DB.batch([
      env.DB.prepare(`INSERT INTO items(id,kind,author_id,title,description,category_id,location,occurred_on,
        custody,share_phone,search_text,fingerprint,publication,updated_by) VALUES (?,'found',?,?,?,?,?,?,?,?,?,?,'public',?)`).bind(itemId,authorId,...values,authorId),
      env.DB.prepare('INSERT INTO media(id,owner_id,item_id,position,mime,created_at) VALUES (?,?,?,1,?,?)')
        .bind(photoId,authorId,itemId,'image/jpeg',Math.floor(Date.now()/1000))
    ]);
  }
}
