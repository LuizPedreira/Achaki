const route = /^\/(?:item\/[a-f0-9-]{36}|novo(?:\/(?:found|lost))?|meus-registros|perfil|configurar-admin|painel(?:\/(?:encontrados|perdidos|solicitacoes|historico|usuarios|configuracoes))?)?$/i;

export function safePath(value, fallback = '/') {
  if (typeof value !== 'string' || value.length > 2500 || !value.startsWith('/') || /[\\#\u0000-\u001f]/.test(value)) return fallback;
  const [path] = value.split('?');
  if (!route.test(path)) return fallback;
  return value;
}

export function lossFormPath(params) {
  const fields = new URLSearchParams();
  for (const [key,field,limit] of [['q','objeto',90],['category','categoria',90],['location','local',120]]) {
    const value = params.get(key)?.trim().slice(0,limit);
    if (value) fields.set(field,value);
  }
  return fields.size ? '/novo/lost?' + fields : '/novo/lost';
}
