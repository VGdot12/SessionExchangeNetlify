import { getStore } from '@netlify/blobs';
import { Repository } from '../lib/repository.mjs';
import { createHandler } from '../lib/handler.mjs';
import { emptyDocument, seedDocument } from '../lib/model.mjs';

export default async function api(request, context) {
  try {
    // Production and previews must not share student data. Production redeploys
    // retain the same site-wide store; preview branches use a separate namespace.
    const deploymentContext = context.deploy?.context || process.env.CONTEXT || 'dev';
    const preview = String(context.deploy?.id || 'local').replace(/[^a-zA-Z0-9-]/g, '-').slice(0, 60);
    const name = deploymentContext === 'production' ? 'sessionexchange-production-v1' : `sessionexchange-preview-${preview}-v1`;
    const store = getStore({ name, consistency: 'strong' });
    const repository = new Repository(store, () => process.env.SWAP_SEED_DEMO === '0' ? emptyDocument() : seedDocument());
    return await createHandler(repository, {
      timezone: process.env.SWAP_TIMEZONE || 'Asia/Kolkata', adminToken: process.env.SWAP_ADMIN_TOKEN || '',
    })(request, context);
  } catch (error) {
    console.error('SessionExchange setup failure:', error.message);
    return Response.json({ error: 'Shared storage is unavailable. Redeploy this project from GitHub with its Netlify function enabled.' },
      { status: 503, headers: { 'Cache-Control': 'no-store' } });
  }
}

export const config = { path: '/api/*' };
