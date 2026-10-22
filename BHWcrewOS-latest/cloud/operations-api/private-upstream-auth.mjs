// Cloud Run IAM is an outer transport credential; never replace application authorization.
export function createPrivateUpstreamHeaders(environment, { authFactory } = {}) {
  const clients = new Map();
  return async origin => {
    if (environment.SYNTHETIC_UPSTREAM_IAM_ENABLED !== 'true') return {};
    const fail = () => { throw Object.assign(new Error('Private synthetic upstream trust is unavailable.'), {status:503}); };
    let target; try { target = new URL(origin); } catch { fail(); }
    if (environment.SYNTHETIC_ONLY !== 'true' || target.protocol !== 'https:' || target.username || target.password
      || target.search || target.hash || target.pathname !== '/' || target.origin !== origin) fail();
    const audience=environment.SYNTHETIC_UPSTREAM_IAM_AUDIENCE || origin;
    let audienceUrl;try{audienceUrl=new URL(audience);}catch{fail();}
    if(audienceUrl.protocol!=='https:'||audienceUrl.origin!==audience||audienceUrl.username||audienceUrl.password||audienceUrl.search||audienceUrl.hash)fail();
    try {
      let client = clients.get(audience);
      if (!client) {
        const auth = authFactory ? await authFactory() : new (await import('google-auth-library')).GoogleAuth();
        client = await auth.getIdTokenClient(audience); clients.set(audience, client);
      }
      const headers = await client.getRequestHeaders();
      const token = headers.get?.('authorization') || headers.Authorization || headers.authorization;
      if (!/^Bearer [A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/.test(token || '')) fail();
      return {'X-Serverless-Authorization':token};
    } catch { fail(); }
  };
}
