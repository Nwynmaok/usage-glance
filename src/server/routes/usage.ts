import type { FastifyInstance } from 'fastify';
import { getUsageSnapshots } from '../collectors/cache.js';

export async function usageRoutes(app: FastifyInstance): Promise<void> {
  app.get('/api/usage', async () => {
    return getUsageSnapshots();
  });
}
