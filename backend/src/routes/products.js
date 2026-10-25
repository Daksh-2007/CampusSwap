const express = require('express');
const path = require('path');
const crypto = require('crypto');
const { requireAuth, requireSeller } = require('../middleware/auth');
const { upload } = require('../middleware/upload');
const { getSupabaseClient } = require('../lib/supabase');

const router = express.Router();
const STORAGE_BUCKET = 'product-images';
const VALID_LISTING_TYPES = new Set(['buy', 'rent', 'both']);
const VALID_CONDITIONS = new Set(['new', 'like_new', 'good', 'fair']);
const VALID_STATUSES = new Set(['active', 'inactive']);
const UUID_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const EXT_BY_MIME = {
  'image/jpeg': '.jpg',
  'image/png': '.png',
  'image/webp': '.webp',
  'image/gif': '.gif'
};

function attachPublicUrls(images = []) {
  const storage = getSupabaseClient().storage.from(STORAGE_BUCKET);
  return images.map((image) => ({
    ...image,
    public_url: image.storage_path
      ? storage.getPublicUrl(image.storage_path).data?.publicUrl || null
      : null
  }));
}

function validPrice(value) {
  if (value === undefined || value === null || value === '') return false;
  const price = Number(value);
  return Number.isFinite(price) && price >= 0;
}

function validateProductData(body, isUpdate = false) {
  const errors = [];
  const fields = ['title', 'category', 'listing_type'];

  for (const field of fields) {
    if (!isUpdate || body[field] !== undefined) {
      if (typeof body[field] !== 'string' || !body[field].trim()) {
        errors.push(`${field} is required and must be a non-empty string`);
      }
    }
  }

  if (body.title !== undefined && typeof body.title === 'string' && body.title.trim().length > 200) {
    errors.push('title must not exceed 200 characters');
  }
  if (body.category !== undefined && typeof body.category === 'string' && body.category.trim().length > 100) {
    errors.push('category must not exceed 100 characters');
  }
  if (body.description !== undefined && body.description !== null && typeof body.description !== 'string') {
    errors.push('description must be a string');
  }
  if (typeof body.description === 'string' && body.description.length > 5000) {
    errors.push('description must not exceed 5000 characters');
  }
  if (body.pickup_address !== undefined && body.pickup_address !== null && typeof body.pickup_address !== 'string') {
    errors.push('pickup_address must be a string');
  }
  if (typeof body.pickup_address === 'string' && body.pickup_address.length > 500) {
    errors.push('pickup_address must not exceed 500 characters');
  }

  if (body.item_condition !== undefined && body.item_condition !== null && body.item_condition !== '') {
    if (typeof body.item_condition !== 'string' ||
        !VALID_CONDITIONS.has(body.item_condition.toLowerCase().trim())) {
      errors.push('item_condition must be one of: new, like_new, good, fair');
    }
  }

  const listingType = typeof body.listing_type === 'string'
    ? body.listing_type.toLowerCase().trim()
    : body.listing_type;

  if (listingType !== undefined && !VALID_LISTING_TYPES.has(listingType)) {
    errors.push("listing_type must be one of: 'buy', 'rent', or 'both'");
  }

  if (listingType === 'buy' || listingType === 'both') {
    if (!validPrice(body.sale_price)) {
      errors.push("sale_price must be a finite, non-negative number for 'buy' or 'both' listings");
    }
  }
  if (listingType === 'rent' || listingType === 'both') {
    if (!validPrice(body.rent_price_per_day)) {
      errors.push("rent_price_per_day must be a finite, non-negative number for 'rent' or 'both' listings");
    }
  }

  return errors;
}

function sendDbError(res, action, error) {
  // Keep implementation/database details out of API responses.
  console.error(`${action} failed:`, error?.code || 'database_error');
  return res.status(500).json({
    success: false,
    message: `${action} failed`
  });
}

async function uploadProductImages(client, productId, files, startingSortOrder = 0) {
  const uploadedPaths = [];
  const insertedRows = [];

  try {
    for (let i = 0; i < files.length; i += 1) {
      const file = files[i];
      const extension = EXT_BY_MIME[file.mimetype];
      if (!extension) {
        throw new Error('Unsupported image type');
      }

      const storagePath = `${productId}/${Date.now()}_${crypto.randomBytes(8).toString('hex')}${extension}`;
      const { data: uploaded, error: uploadError } = await client.storage
        .from(STORAGE_BUCKET)
        .upload(storagePath, file.buffer, {
          contentType: file.mimetype,
          upsert: false
        });

      if (uploadError || !uploaded) {
        throw new Error('One or more images could not be uploaded');
      }
      uploadedPaths.push(uploaded.path);

      const { data: imageRow, error: insertError } = await client
        .from('product_images')
        .insert({
          product_id: productId,
          storage_path: uploaded.path,
          sort_order: startingSortOrder + i
        })
        .select('id, product_id, storage_path, sort_order, created_at')
        .single();

      if (insertError || !imageRow) {
        throw new Error('Image uploaded but its database record could not be saved');
      }
      insertedRows.push(imageRow);
    }

    return insertedRows;
  } catch (error) {
    // Best-effort cleanup for files and rows created by this request.
    if (insertedRows.length) {
      await client.from('product_images').delete().in('id', insertedRows.map((row) => row.id));
    }
    if (uploadedPaths.length) {
      await client.storage.from(STORAGE_BUCKET).remove(uploadedPaths);
    }
    throw error;
  }
}

// GET /api/products/seller/me — authenticated seller's own listings (including active & inactive).
router.get('/seller/me', requireAuth, requireSeller, async (req, res) => {
  try {
    const sellerId = req.user.id;
    const {
      status,
      category,
      listing_type: listingType,
      search,
      sort = 'created_at',
      order = 'desc',
      limit = '100',
      page = '1'
    } = req.query;

    if (listingType && !VALID_LISTING_TYPES.has(String(listingType).toLowerCase())) {
      return res.status(400).json({
        success: false,
        message: "listing_type must be 'buy', 'rent', or 'both'"
      });
    }

    if (status && !VALID_STATUSES.has(String(status).toLowerCase())) {
      return res.status(400).json({
        success: false,
        message: "status must be 'active' or 'inactive'"
      });
    }

    const validSortColumns = new Set(['created_at', 'sale_price', 'rent_price_per_day', 'title', 'updated_at']);
    const sortColumn = validSortColumns.has(String(sort)) ? String(sort) : 'created_at';
    const safeLimit = Math.min(Math.max(Number.parseInt(limit, 10) || 100, 1), 200);
    const safePage = Math.max(Number.parseInt(page, 10) || 1, 1);
    const from = (safePage - 1) * safeLimit;
    const to = from + safeLimit - 1;

    // Use caller's scoped Supabase client (enforces RLS where seller can see their own active & inactive listings)
    const client = req.supabase || getSupabaseClient();
    let query = client
      .from('products')
      .select(`
        id, seller_id, title, description, category, item_condition,
        listing_type, sale_price, rent_price_per_day, pickup_address,
        status, created_at, updated_at,
        product_images ( id, storage_path, sort_order, created_at )
      `)
      .eq('seller_id', sellerId);

    if (status) {
      query = query.eq('status', String(status).toLowerCase().trim());
    }

    if (typeof category === 'string' && category.trim()) {
      query = query.ilike('category', `%${category.trim()}%`);
    }

    if (listingType) {
      const type = String(listingType).toLowerCase();
      query = type === 'buy'
        ? query.in('listing_type', ['buy', 'both'])
        : type === 'rent'
          ? query.in('listing_type', ['rent', 'both'])
          : query.eq('listing_type', 'both');
    }

    if (typeof search === 'string' && search.trim()) {
      query = query.ilike('title', `%${search.trim()}%`);
    }

    const { data, error } = await query
      .order(sortColumn, { ascending: String(order).toLowerCase() === 'asc' })
      .range(from, to);

    if (error) return sendDbError(res, 'Retrieving seller listings', error);

    const products = (data || []).map((product) => ({
      ...product,
      product_images: attachPublicUrls(product.product_images || [])
    }));

    return res.status(200).json({
      success: true,
      count: products.length,
      page: safePage,
      limit: safeLimit,
      data: products
    });
  } catch (error) {
    console.error('Unexpected seller products list error:', error.message || 'unknown_error');
    return res.status(500).json({ success: false, message: 'Failed to retrieve seller listings' });
  }
});

// GET /api/products — public list of active products.
router.get('/', async (req, res) => {
  try {
    const {
      category,
      listing_type: listingType,
      search,
      sort = 'created_at',
      order = 'desc',
      limit = '50',
      page = '1'
    } = req.query;

    if (listingType && !VALID_LISTING_TYPES.has(String(listingType).toLowerCase())) {
      return res.status(400).json({
        success: false,
        message: "listing_type must be 'buy', 'rent', or 'both'"
      });
    }

    const validSortColumns = new Set(['created_at', 'sale_price', 'rent_price_per_day', 'title']);
    const sortColumn = validSortColumns.has(String(sort)) ? String(sort) : 'created_at';
    const safeLimit = Math.min(Math.max(Number.parseInt(limit, 10) || 50, 1), 100);
    const safePage = Math.max(Number.parseInt(page, 10) || 1, 1);
    const from = (safePage - 1) * safeLimit;
    const to = from + safeLimit - 1;

    const client = getSupabaseClient();
    let query = client
      .from('products')
      .select(`
        id, seller_id, title, description, category, item_condition,
        listing_type, sale_price, rent_price_per_day, pickup_address,
        status, created_at, updated_at,
        product_images ( id, storage_path, sort_order, created_at )
      `)
      .eq('status', 'active');

    if (typeof category === 'string' && category.trim()) {
      query = query.ilike('category', `%${category.trim()}%`);
    }
    if (listingType) {
      const type = String(listingType).toLowerCase();
      query = type === 'buy'
        ? query.in('listing_type', ['buy', 'both'])
        : type === 'rent'
          ? query.in('listing_type', ['rent', 'both'])
          : query.eq('listing_type', 'both');
    }
    if (typeof search === 'string' && search.trim()) {
      query = query.ilike('title', `%${search.trim()}%`);
    }

    const { data, error } = await query
      .order(sortColumn, { ascending: String(order).toLowerCase() === 'asc' })
      .range(from, to);

    if (error) return sendDbError(res, 'Retrieving products', error);

    const products = (data || []).map((product) => ({
      ...product,
      product_images: attachPublicUrls(product.product_images || [])
    }));

    return res.status(200).json({
      success: true,
      count: products.length,
      page: safePage,
      limit: safeLimit,
      data: products
    });
  } catch (error) {
    console.error('Unexpected product list error:', error.message || 'unknown_error');
    return res.status(500).json({ success: false, message: 'Failed to retrieve products' });
  }
});

// GET /api/products/:id — public details for active products.
router.get('/:id', async (req, res) => {
  const { id } = req.params;
  if (!UUID_REGEX.test(id)) {
    return res.status(400).json({ success: false, message: 'Invalid product ID format' });
  }

  try {
    const { data: product, error } = await getSupabaseClient()
      .from('products')
      .select(`
        id, seller_id, title, description, category, item_condition,
        listing_type, sale_price, rent_price_per_day, pickup_address,
        status, created_at, updated_at,
        product_images ( id, storage_path, sort_order, created_at )
      `)
      .eq('id', id)
      .eq('status', 'active')
      .maybeSingle();

    if (error) return sendDbError(res, 'Retrieving product details', error);
    if (!product) {
      return res.status(404).json({ success: false, message: 'Product not found or inactive' });
    }

    product.product_images = attachPublicUrls(product.product_images || []);
    return res.status(200).json({ success: true, data: product });
  } catch (error) {
    console.error('Unexpected product detail error:', error.message || 'unknown_error');
    return res.status(500).json({ success: false, message: 'Failed to retrieve product details' });
  }
});

// POST /api/products — sellers only. Supports multipart/form-data with `images`.
router.post('/', requireAuth, requireSeller, upload.array('images', 5), async (req, res) => {
  const sellerId = req.user.id;
  const body = req.body || {};

  if (body.seller_id !== undefined) {
    return res.status(400).json({
      success: false,
      message: 'Do not provide seller_id; ownership is assigned from the authenticated account'
    });
  }

  const listingType = typeof body.listing_type === 'string'
    ? body.listing_type.toLowerCase().trim()
    : body.listing_type;
  const normalized = {
    ...body,
    listing_type: listingType,
    item_condition: body.item_condition === undefined ? 'good' : body.item_condition
  };
  const errors = validateProductData(normalized);
  if (errors.length) {
    return res.status(400).json({ success: false, message: 'Product validation failed', errors });
  }

  const client = req.supabase;
  try {
    const payload = {
      seller_id: sellerId,
      title: body.title.trim(),
      description: typeof body.description === 'string' ? body.description.trim() : '',
      category: body.category.trim(),
      item_condition: String(normalized.item_condition).toLowerCase().trim(),
      listing_type: listingType,
      sale_price: listingType === 'buy' || listingType === 'both' ? Number(body.sale_price) : null,
      rent_price_per_day: listingType === 'rent' || listingType === 'both' ? Number(body.rent_price_per_day) : null,
      pickup_address: typeof body.pickup_address === 'string' && body.pickup_address.trim()
        ? body.pickup_address.trim()
        : null,
      status: 'active'
    };

    const { data: product, error } = await client.from('products').insert(payload).select().single();
    if (error || !product) return sendDbError(res, 'Creating product listing', error);

    let images = [];
    try {
      if (req.files?.length) {
        images = await uploadProductImages(client, product.id, req.files, 0);
      }
    } catch (imageError) {
      // Preserve the row for auditability but prevent buyers from seeing an incomplete listing.
      await client.from('products').update({
        status: 'inactive',
        updated_at: new Date().toISOString()
      }).eq('id', product.id).eq('seller_id', sellerId);

      console.error('Product image upload failed:', imageError.message || 'upload_error');
      return res.status(502).json({
        success: false,
        message: 'The listing was saved but deactivated because image upload failed. Edit the listing and retry the images.',
        product_id: product.id
      });
    }

    product.product_images = attachPublicUrls(images);
    return res.status(201).json({
      success: true,
      message: 'Product listing created successfully',
      data: product
    });
  } catch (error) {
    console.error('Unexpected product creation error:', error.message || 'unknown_error');
    return res.status(500).json({ success: false, message: 'Failed to create product listing' });
  }
});

// PATCH /api/products/:id — sellers may edit only their own listings.
router.patch('/:id', requireAuth, requireSeller, upload.array('images', 5), async (req, res) => {
  const { id } = req.params;
  const sellerId = req.user.id;
  if (!UUID_REGEX.test(id)) {
    return res.status(400).json({ success: false, message: 'Invalid product ID format' });
  }
  if (req.body?.seller_id !== undefined) {
    return res.status(400).json({ success: false, message: 'Changing seller_id is not permitted' });
  }

  const client = req.supabase;
  try {
    const { data: existing, error: fetchError } = await client
      .from('products')
      .select('id, seller_id, title, description, category, item_condition, listing_type, sale_price, rent_price_per_day, pickup_address, status')
      .eq('id', id)
      .maybeSingle();

    if (fetchError) return sendDbError(res, 'Verifying product ownership', fetchError);
    if (!existing) return res.status(404).json({ success: false, message: 'Product not found' });
    if (existing.seller_id !== sellerId) {
      return res.status(403).json({ success: false, message: 'You can only update your own listings' });
    }

    const body = req.body || {};
    const finalListingType = body.listing_type === undefined
      ? existing.listing_type
      : String(body.listing_type).toLowerCase().trim();

    const effective = {
      ...existing,
      ...body,
      listing_type: finalListingType,
      sale_price: body.sale_price === undefined ? existing.sale_price : body.sale_price,
      rent_price_per_day: body.rent_price_per_day === undefined ? existing.rent_price_per_day : body.rent_price_per_day
    };
    const errors = validateProductData(effective, false);
    if (errors.length) {
      return res.status(400).json({ success: false, message: 'Product validation failed', errors });
    }

    const payload = { updated_at: new Date().toISOString() };
    for (const field of ['title', 'description', 'category', 'pickup_address']) {
      if (body[field] !== undefined) {
        payload[field] = typeof body[field] === 'string' ? body[field].trim() : body[field];
      }
    }
    if (body.item_condition !== undefined) {
      payload.item_condition = String(body.item_condition).toLowerCase().trim();
    }
    if (body.status !== undefined) {
      const status = String(body.status).toLowerCase().trim();
      if (!VALID_STATUSES.has(status)) {
        return res.status(400).json({ success: false, message: 'status may only be active or inactive' });
      }
      payload.status = status;
    }

    payload.listing_type = finalListingType;
    payload.sale_price = (finalListingType === 'buy' || finalListingType === 'both')
      ? Number(effective.sale_price)
      : null;
    payload.rent_price_per_day = (finalListingType === 'rent' || finalListingType === 'both')
      ? Number(effective.rent_price_per_day)
      : null;

    const { data: updated, error: updateError } = await client
      .from('products')
      .update(payload)
      .eq('id', id)
      .eq('seller_id', sellerId)
      .select()
      .single();

    if (updateError || !updated) return sendDbError(res, 'Updating product listing', updateError);

    let newImages = [];
    try {
      if (req.files?.length) {
        const { count, error: countError } = await client
          .from('product_images')
          .select('id', { count: 'exact', head: true })
          .eq('product_id', id);
        if (countError) throw new Error('Could not verify existing image count');
        if ((count || 0) + req.files.length > 5) {
          return res.status(400).json({ success: false, message: 'A listing can have at most 5 images in total' });
        }
        newImages = await uploadProductImages(client, id, req.files, count || 0);
      }
    } catch (imageError) {
      console.error('Product image update failed:', imageError.message || 'upload_error');
      return res.status(502).json({
        success: false,
        message: 'Product fields were updated, but image upload failed. Retry the image upload.'
      });
    }

    const { data: allImages, error: imagesError } = await client
      .from('product_images')
      .select('id, product_id, storage_path, sort_order, created_at')
      .eq('product_id', id)
      .order('sort_order', { ascending: true });

    if (imagesError) return sendDbError(res, 'Retrieving product images', imagesError);
    updated.product_images = attachPublicUrls(allImages || []);
    return res.status(200).json({
      success: true,
      message: 'Product listing updated successfully',
      data: updated
    });
  } catch (error) {
    console.error('Unexpected product update error:', error.message || 'unknown_error');
    return res.status(500).json({ success: false, message: 'Failed to update product listing' });
  }
});

// DELETE /api/products/:id — deactivates listing (default) or permanently removes it (?permanent=true).
router.delete('/:id', requireAuth, requireSeller, async (req, res) => {
  const { id } = req.params;
  const sellerId = req.user.id;
  const isPermanent = req.query.permanent === 'true' || req.query.permanent === '1';

  if (!UUID_REGEX.test(id)) {
    return res.status(400).json({ success: false, message: 'Invalid product ID format' });
  }

  try {
    const client = req.supabase;
    const { data: existing, error: fetchError } = await client
      .from('products')
      .select('id, seller_id, title')
      .eq('id', id)
      .maybeSingle();

    if (fetchError) return sendDbError(res, 'Verifying product ownership', fetchError);
    if (!existing) return res.status(404).json({ success: false, message: 'Product not found' });
    if (existing.seller_id !== sellerId) {
      return res.status(403).json({ success: false, message: 'You can only modify or remove your own listings' });
    }

    if (isPermanent) {
      // 1. Retrieve images so we can clean up Supabase storage files if any
      const { data: images } = await client
        .from('product_images')
        .select('storage_path')
        .eq('product_id', id);

      // 2. Delete product record (cascading deletes product_images in DB under foreign key)
      const { error: deleteError } = await client
        .from('products')
        .delete()
        .eq('id', id)
        .eq('seller_id', sellerId);

      if (deleteError) return sendDbError(res, 'Removing product listing', deleteError);

      // 3. Best-effort storage cleanup
      if (images && images.length > 0) {
        const storagePaths = images.map(img => img.storage_path).filter(Boolean);
        if (storagePaths.length > 0) {
          await client.storage.from(STORAGE_BUCKET).remove(storagePaths).catch(err => {
            console.error('Storage image cleanup error:', err.message || err);
          });
        }
      }

      return res.status(200).json({
        success: true,
        message: 'Product listing permanently removed successfully',
        data: { id, title: existing.title, removed: true }
      });
    }

    // Default: Soft deactivation
    const { data: product, error } = await client
      .from('products')
      .update({ status: 'inactive', updated_at: new Date().toISOString() })
      .eq('id', id)
      .eq('seller_id', sellerId)
      .select('id, title, status, updated_at')
      .single();

    if (error || !product) return sendDbError(res, 'Deactivating product listing', error);
    return res.status(200).json({
      success: true,
      message: 'Product listing deactivated successfully',
      data: product
    });
  } catch (error) {
    console.error('Unexpected product deletion error:', error.message || 'unknown_error');
    return res.status(500).json({ success: false, message: 'Failed to process product deletion' });
  }
});

module.exports = router;
