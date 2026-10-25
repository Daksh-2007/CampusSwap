const express = require('express');
const router = express.Router();
const { getSupabaseClient } = require('../lib/supabase');

// Email regex pattern for validation
const EMAIL_REGEX = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

/**
 * POST /api/auth/register
 * 
 * Body:
 * - full_name (string, required)
 * - email (string, required, valid email format)
 * - password (string, required, min 8 chars)
 */
router.post('/register', async (req, res, next) => {
  try {
    const { full_name, email, password } = req.body || {};

    // 1. Validate inputs
    if (!full_name || typeof full_name !== 'string' || !full_name.trim()) {
      return res.status(400).json({
        success: false,
        message: 'Full name is required'
      });
    }

    if (!email || typeof email !== 'string' || !EMAIL_REGEX.test(email.trim())) {
      return res.status(400).json({
        success: false,
        message: 'Valid email address is required'
      });
    }

    if (!password || typeof password !== 'string' || password.length < 8) {
      return res.status(400).json({
        success: false,
        message: 'Password must be at least 8 characters long'
      });
    }

    // Explicitly reject any attempts to pass a custom role during registration
    // Roles are assigned automatically via database trigger (default 'buyer')
    if (req.body && req.body.role !== undefined) {
      return res.status(400).json({
        success: false,
        message: 'Selecting a user role is not permitted during registration'
      });
    }

    const supabase = getSupabaseClient();
    const cleanEmail = email.trim().toLowerCase();
    const cleanName = full_name.trim();

    const { data, error } = await supabase.auth.signUp({
      email: cleanEmail,
      password,
      options: {
        data: {
          full_name: cleanName
        }
      }
    });

    if (error) {
      // Do not expose internal database details
      return res.status(400).json({
        success: false,
        message: error.message || 'Registration failed'
      });
    }

    const user = data.user;
    const session = data.session;

    // Check if email confirmation is required (session will be null when confirmation is pending)
    if (!session) {
      return res.status(201).json({
        success: true,
        requiresEmailConfirmation: true,
        message: 'Registration successful! Please check your email to confirm your account before logging in.',
        user: {
          id: user?.id,
          email: user?.email,
          full_name: user?.user_metadata?.full_name || cleanName
        }
      });
    }

    // Session is immediately active (e.g. if email confirmation is disabled)
    return res.status(201).json({
      success: true,
      requiresEmailConfirmation: false,
      message: 'Registration successful!',
      session: {
        access_token: session.access_token,
        refresh_token: session.refresh_token,
        expires_at: session.expires_at,
        expires_in: session.expires_in
      },
      user: {
        id: user.id,
        email: user.email,
        full_name: user.user_metadata?.full_name || cleanName
      }
    });
  } catch (err) {
    next(err);
  }
});

/**
 * POST /api/auth/login
 * 
 * Body:
 * - email (string, required)
 * - password (string, required)
 */
router.post('/login', async (req, res, next) => {
  try {
    const { email, password } = req.body || {};

    if (!email || typeof email !== 'string' || !email.trim()) {
      return res.status(400).json({
        success: false,
        message: 'Email is required'
      });
    }

    if (!password || typeof password !== 'string') {
      return res.status(400).json({
        success: false,
        message: 'Password is required'
      });
    }

    const supabase = getSupabaseClient();
    const cleanEmail = email.trim().toLowerCase();

    const { data, error } = await supabase.auth.signInWithPassword({
      email: cleanEmail,
      password
    });

    if (error) {
      // Check for specific Supabase auth error codes
      if (error.code === 'email_not_confirmed' || error.message?.toLowerCase().includes('email not confirmed')) {
        return res.status(403).json({
          success: false,
          code: 'email_not_confirmed',
          message: 'Please confirm your email address before logging in. Check your inbox for the confirmation email.'
        });
      }

      if (error.code === 'invalid_credentials' || error.message?.toLowerCase().includes('invalid login credentials')) {
        return res.status(401).json({
          success: false,
          code: 'invalid_credentials',
          message: 'Invalid email or password'
        });
      }

      return res.status(400).json({
        success: false,
        message: error.message || 'Login failed'
      });
    }

    if (!data.session) {
      return res.status(401).json({
        success: false,
        message: 'Authentication failed. No active session created.'
      });
    }

    return res.status(200).json({
      success: true,
      message: 'Login successful',
      session: {
        access_token: data.session.access_token,
        refresh_token: data.session.refresh_token,
        expires_at: data.session.expires_at,
        expires_in: data.session.expires_in
      },
      user: {
        id: data.user.id,
        email: data.user.email,
        full_name: data.user.user_metadata?.full_name || null
      }
    });
  } catch (err) {
    next(err);
  }
});

module.exports = router;
