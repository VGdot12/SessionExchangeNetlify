import { siteRepository, deploymentContext } from '../lib/storage.mjs';
import { outlookConfiguration, runOutlookSync } from '../lib/outlook-sync.mjs';

export default async function scheduledOutlook(request, context = {}) {
  if (deploymentContext(context) !== 'production') return;
  try {
    const configuration = outlookConfiguration();
    if (!configuration.enabled) return;
    const result = await runOutlookSync(siteRepository(context), configuration);
    console.log('Outlook cloud sync:', JSON.stringify(result));
  } catch (error) {
    console.error('Outlook cloud sync failed:', error.message);
    throw new Error('Outlook sync failed. Check the private admin page and function logs.');
  }
}

export const config = { schedule: '*/5 * * * *' };
