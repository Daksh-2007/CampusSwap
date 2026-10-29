const { createClient } = require('@supabase/supabase-js');

const supabaseUrl = (process.env.SUPABASE_URL || '').trim();
// Use only a publishable/anon key for normal user operations. Never use a service-role/secret key here.
const supabasePublishableKey = (
  process.env.SUPABASE_PUBLISHABLE_KEY ||
  process.env.SUPABASE_ANON_KEY ||
  ''
).trim();

/**
 * Validates that the necessary Supabase configuration is present.
 */
function validateSupabaseConfig() {
  if (!supabaseUrl) {
    throw new Error('Missing SUPABASE_URL environment variable');
  }
  if (!supabasePublishableKey) {
    throw new Error('Missing SUPABASE_PUBLISHABLE_KEY (or SUPABASE_ANON_KEY) environment variable');
  }
}

/**
 * Base Supabase client initialized with publishable/anon key.
 * Used for verifying auth tokens without administrative privileges.
 */
let supabase = null;
let adminSupabase = null;

function getSupabaseClient() {
  if (!supabase) {
    validateSupabaseConfig();
    supabase = createClient(supabaseUrl, supabasePublishableKey, {
      auth: {
        persistSession: false,
        autoRefreshToken: false,
      },
    });
  }
  return supabase;
}

/**
 * Returns a Supabase admin client initialized with the SUPABASE_SECRET_KEY (service role).
 * Used strictly on the backend after performing application-level auth and authorization checks.
 */
function getAdminClient() {
  const secretKey = (process.env.SUPABASE_SECRET_KEY || '').trim();
  if (!secretKey) {
    return null;
  }
  if (!adminSupabase) {
    validateSupabaseConfig();
    adminSupabase = createClient(supabaseUrl, secretKey, {
      auth: {
        persistSession: false,
        autoRefreshToken: false,
      },
    });
  }
  return adminSupabase;
}

/**
 * Creates a request-scoped Supabase client that operates under the authenticated user's context.
 * Injects the user's access token into the Authorization header so Row Level Security (RLS) applies.
 *
 * @param {string} accessToken - User's JWT bearer token
 * @returns {import('@supabase/supabase-js').SupabaseClient}
 */
function createScopedSupabaseClient(accessToken) {
  validateSupabaseConfig();
  return createClient(supabaseUrl, supabasePublishableKey, {
    auth: {
      persistSession: false,
      autoRefreshToken: false,
    },
    global: {
      headers: {
        Authorization: `Bearer ${accessToken}`,
      },
    },
  });
}

module.exports = {
  getSupabaseClient,
  getAdminClient,
  createScopedSupabaseClient,
  validateSupabaseConfig,
};
