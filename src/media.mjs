import { HttpError, all, first, id, json, now, requestBytes, requireUser, run, throttle } from './http.mjs';

const bytesAt = (bytes, offset, value) => [...value].every((character, index) => bytes[offset + index] === character.charCodeAt(0));

function imageType(bytes) {
  const length = bytes.length;
  if (length < 24) return null;
  if (bytes[0] === 255 && bytes[1] === 216 && bytes[2] === 255 && bytes[length - 2] === 255 && bytes[length - 1] === 217) return 'image/jpeg';
  if (bytes[0] === 137 && bytesAt(bytes,1,'PNG\r\n') && bytes[6] === 26 && bytes[7] === 10 && bytesAt(bytes,length - 8,'IEND')) return 'image/png';
  if (bytesAt(bytes,0,'RIFF') && bytesAt(bytes,8,'WEBP') && bytesAt(bytes,12,'VP8')) return 'image/webp';
  return null;
}

async function readImage(request, max = 1_000_000) {
  const bytes = await requestBytes(request, max);
  const mime = imageType(bytes);
  if (!mime || request.headers.get('Content-Type') !== mime) throw new HttpError(415, 'Envie uma foto JPEG, PNG ou WebP válida.');
  return { bytes, mime };
}

export async function upload(env, request, user) {
  requireUser(user);
  await throttle(env, `photo:${user.id}`, 50, 3600);
  const { bytes, mime } = await readImage(request);
  const key = crypto.randomUUID();
  await run(env, 'INSERT INTO media(id,owner_id,mime,created_at,discard) VALUES (?,?,?,?,1)', key, user.id, mime, now());
  await env.PHOTOS.put(key, bytes, { httpMetadata: { contentType: mime } });
  await run(env, 'UPDATE media SET discard = 0 WHERE id = ?', key);
  return json({ id: key }, 201);
}

export async function readPhoto(env, user, key) {
  const media = await first(env, `SELECT m.*, i.kind, i.publication, i.archived_at, i.author_id, r.recipient_id
    FROM media m LEFT JOIN items i ON i.id = m.item_id LEFT JOIN returns r ON r.item_id = i.id
    WHERE m.id = ? AND m.discard = 0`, id(key));
  if (!media) throw new HttpError(404, 'Foto não encontrada.');
  const publicPhoto = media.kind === 'found' && media.publication === 'public' && !media.archived_at;
  if (!publicPhoto && user?.id !== media.owner_id && user?.id !== media.author_id && user?.id !== media.recipient_id && user?.role !== 'admin') {
    throw new HttpError(404, 'Foto não encontrada.');
  }
  const object = await env.PHOTOS.get(media.id);
  if (!object) throw new HttpError(404, 'Foto não encontrada.');
  return new Response(object.body, { headers: {
    'Content-Type': media.mime, 'Cache-Control': 'private, no-store', 'Content-Disposition': 'inline'
  } });
}

export async function cleanupPhotos(env) {
  const time = now() - 86400;
  const rows = await all(env, `UPDATE media SET discard = 1 WHERE item_id IS NULL AND created_at <= ?
    AND id IN (SELECT id FROM media WHERE item_id IS NULL AND created_at <= ? ORDER BY created_at LIMIT 1000)
    RETURNING id`, time, time);
  if (!rows.length) return;
  const ids = rows.map(row => row.id);
  try {
    await env.PHOTOS.delete(ids);
  } catch {
    for (const key of ids) await env.PHOTOS.delete(key);
  }
  await run(env, 'DELETE FROM media WHERE discard = 1 AND item_id IS NULL AND id IN (SELECT value FROM json_each(?))', JSON.stringify(ids));
}

const categoryLabels = [
  ['eletronicos', /phone|computer|laptop|headphone|monitor|television|screen|keyboard|mouse|remote control|digital clock|radio/i],
  ['roupas', /shirt|sweatshirt|jersey|jean|coat|suit|mitten|sock|shoe|sandal|cardigan|skirt|pajama/i],
  ['material-escolar', /book|notebook|pencil|pen |ruler|eraser|notepad|binder/i],
  ['acessorios', /wallet|purse|backpack|umbrella|sunglass|eyeglass|buckle|handbag|watch|mask|necklace/i]
];

export const suggestionsEnabled = env => env.IMAGE_SUGGESTIONS === 'true' && Boolean(env.AI);

export async function suggestCategory(env, request, user) {
  requireUser(user);
  if (!suggestionsEnabled(env)) throw new HttpError(503, 'A sugestão por foto ainda não está disponível.');
  await throttle(env, `suggest:${user.id}`, 8, 3600);
  const { bytes } = await readImage(request, 500_000);
  let result;
  try {
    result = await env.AI.run('@cf/microsoft/resnet-50', { image: Array.from(bytes) });
  } catch {
    throw new HttpError(503, 'A foto não pôde ser analisada agora. Escolha uma categoria manualmente.');
  }
  const labels = Array.isArray(result) ? result : Array.isArray(result?.result) ? result.result : [];
  for (const prediction of labels.slice(0, 5)) {
    if (prediction.score < 0.12 || !Number.isFinite(prediction.score) || typeof prediction.label !== 'string') continue;
    const match = categoryLabels.find(([, pattern]) => pattern.test(prediction.label));
    if (!match) continue;
    const category = await first(env, 'SELECT id,name FROM categories WHERE id = ? AND active = 1', match[0]);
    if (category) return json({ category });
  }
  return json({ category: null });
}
