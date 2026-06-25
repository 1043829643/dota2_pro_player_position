import { createClient, SupabaseClient } from '@supabase/supabase-js';
import * as schema from './shared/schema';

let clientInstance: SupabaseClient | null = null;

function getEnvVar(name: string): string {
  const val = process.env[name];
  if (!val) {
    throw new Error(`${name} is not set`);
  }
  return val;
}

export function getClient(): SupabaseClient {
  if (clientInstance) return clientInstance;

  const supabaseUrl = getEnvVar('COZE_SUPABASE_URL');
  const supabaseKey = getEnvVar('COZE_SUPABASE_SERVICE_ROLE_KEY');

  clientInstance = createClient(supabaseUrl, supabaseKey);
  return clientInstance;
}

export type Database = typeof schema;
