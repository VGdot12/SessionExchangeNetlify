import { getStore } from '@netlify/blobs';
import { Repository } from './repository.mjs';
import { emptyDocument, seedDocument } from './model.mjs';

export function deploymentContext(context = {}, env = process.env) {
  return context.deploy?.context || env.CONTEXT || 'dev';
}

export function siteRepository(context = {}, env = process.env) {
  const preview = String(context.deploy?.id || 'local').replace(/[^a-zA-Z0-9-]/g, '-').slice(0,60);
  const name = deploymentContext(context, env) === 'production' ? 'sessionexchange-production-v1' : `sessionexchange-preview-${preview}-v1`;
  return new Repository(getStore({ name, consistency: 'strong' }), () =>
    env.SWAP_SEED_DEMO === '0' || env.SWAP_OUTLOOK_ENABLED === '1' ? emptyDocument() : seedDocument());
}
