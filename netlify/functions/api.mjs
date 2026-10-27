import { createHandler } from '../lib/handler.mjs';
import { siteRepository, deploymentContext } from '../lib/storage.mjs';
import { outlookConfiguration, publicConfiguration, runOutlookSync } from '../lib/outlook-sync.mjs';

export default async function api(request, context) {
  try {
    const repository = siteRepository(context);
    return await createHandler(repository, {
      timezone: process.env.SWAP_TIMEZONE || 'Asia/Kolkata', adminToken: process.env.SWAP_ADMIN_TOKEN || '',
      outlook: publicConfiguration(),
      excelUpload: { enabled: process.env.SWAP_EXCEL_UPLOAD_ENABLED === '1', token: process.env.SWAP_FLOW_TOKEN || '',
        production: deploymentContext(context) === 'production' },
      powerAutomate: { enabled:process.env.SWAP_POWER_AUTOMATE_ENABLED === '1', token:process.env.SWAP_FLOW_TOKEN || '',
        production:deploymentContext(context) === 'production' },
      runOutlook: () => {
        if (deploymentContext(context) !== 'production') throw new Error('Outlook retrieval is only enabled on the production site.');
        return runOutlookSync(repository, outlookConfiguration());
      },
    })(request, context);
  } catch (error) {
    console.error('SessionExchange setup failure:', error.message);
    return Response.json({ error: 'Shared storage is unavailable. Redeploy this project from GitHub with its Netlify function enabled.' },
      { status: 503, headers: { 'Cache-Control': 'no-store' } });
  }
}

export const config = { path: '/api/*' };
