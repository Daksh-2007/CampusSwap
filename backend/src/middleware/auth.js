const { getSupabaseClient, createScopedSupabaseClient } = require('../lib/supabase');

/**
 * Authentication middleware for verifying JWT access token using Supabase Auth.
 * 
 * - Extracts token from `Authorization: Bearer <token>`
 * - Validates token with `supabase.auth.getUser(token)`
 * - Sets `req.user`
 * - Sets `req.supabase` with a request-scoped client containing the token header
 */
async function requireAuth(req, res, next) {
  try {
    const authHeader = req.headers.authorization;

    if (!authHeader || !authHeader.startsWith('Bearer ')) {
      return res.status(401).json({
        success: false,
        message: 'Authorization token required. Format: Bearer <access_token>',
      });
    }

    const token = authHeader.slice(7).trim();

    if (!token) {
      return res.status(401).json({
        success: false,
        message: 'Invalid or missing Bearer token',
      });
    }

    const supabase = getSupabaseClient();
    const { data, error } = await supabase.auth.getUser(token);

    if (error || !data || !data.user) {
      return res.status(401).json({
        success: false,
        message: 'Unauthorized: Invalid or expired token',
      });
    }

    // Attach verified user and scoped client to request
    req.user = data.user;
    req.supabase = createScopedSupabaseClient(token);

    next();
  } catch (err) {
    // Avoid leaking internal details/tokens in logs and response
    console.error('Authentication error:', err.message || 'Unknown auth error');
    return res.status(401).json({
      success: false,
      message: 'Unauthorized: Authentication failed',
    });
  }
}

/**
 * Require the authenticated user's database profile to have role = 'seller'.
 * The role is read from public.profiles, never from client-supplied data or
 * user-editable auth metadata.
 */
async function requireSeller(req, res, next) {
  try {
    if (!req.user || !req.supabase) {
      return res.status(401).json({
        success: false,
        message: 'Authentication required'
      });
    }

    const { data: profile, error } = await req.supabase
      .from('profiles')
      .select('role')
      .eq('id', req.user.id)
      .maybeSingle();

    if (error) {
      // A missing own-profile SELECT policy is a configuration problem.
      console.error('Seller role lookup failed:', error.code || 'database_error');
      return res.status(500).json({
        success: false,
        message: 'Unable to verify account role. Check the profiles RLS policies.'
      });
    }

    if (!profile || profile.role !== 'seller') {
      return res.status(403).json({
        success: false,
        message: 'Seller account required. Ask an administrator to enable seller access.'
      });
    }

    return next();
  } catch (err) {
    console.error('Seller role verification failed:', err.message || 'unknown_error');
    return res.status(500).json({
      success: false,
      message: 'Unable to verify account role'
    });
  }
}

module.exports = {
  requireAuth,
  requireSeller
};
