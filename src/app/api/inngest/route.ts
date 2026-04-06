import { serve } from 'inngest/next';
import { inngest, functions } from '@/lib/reasonqa/inngest';

export const { GET, POST, PUT } = serve({
  client: inngest,
  functions,
});
