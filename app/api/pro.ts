// @ts-nocheck
import admin from '../server/admin.js';
import falRealtimeToken from '../server/fal-realtime-token.js';
import proLicense from '../server/pro-license.js';
import reconcileSessions from '../server/reconcile-sessions.js';

const ROUTES = {
  admin,
  'fal-realtime-token': falRealtimeToken,
  'pro-license': proLicense,
  'reconcile-sessions': reconcileSessions,
};

export default async function handler(req, res) {
  const route = String(req.query?.route || '').trim();
  const routeHandler = ROUTES[route];
  if (!routeHandler) return res.status(404).json({ error: 'Unknown PRO API route' });
  return routeHandler(req, res);
}
