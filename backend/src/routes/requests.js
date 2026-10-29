const express = require('express');
const router = express.Router();
const { requireAuth } = require('../middleware/auth');
const { getAdminClient, createScopedSupabaseClient } = require('../lib/supabase');

/**
 * Helper to obtain the appropriate Supabase client.
 * Falls back to scoped client if SUPABASE_SECRET_KEY is not configured.
 */
function getClient(req) {
  const admin = getAdminClient();
  if (admin) return admin;
  return createScopedSupabaseClient(req.token);
}

/**
 * POST /api/requests
 * Creates buy order(s) and/or rental request(s).
 * Body payload:
 * {
 *   items: [
 *     {
 *       productId: string (uuid),
 *       mode: 'buy' | 'rent',
 *       quantity?: number (default 1),
 *       rentalStartDate?: string (YYYY-MM-DD),
 *       rentalEndDate?: string (YYYY-MM-DD),
 *       rentalDays?: number,
 *       estimatedCost?: number
 *     }
 *   ]
 * }
 */
router.post('/', requireAuth, async (req, res) => {
  try {
    const buyerId = req.user.id;
    const { items } = req.body;

    if (!items || !Array.isArray(items) || items.length === 0) {
      return res.status(400).json({
        success: false,
        message: 'At least one item is required to submit a request.'
      });
    }

    const client = getClient(req);

    // Fetch products referenced to validate existence and active status
    const productIds = items.map(item => item.productId).filter(Boolean);
    if (productIds.length !== items.length) {
      return res.status(400).json({
        success: false,
        message: 'All items must include a valid productId.'
      });
    }

    const { data: products, error: prodErr } = await client
      .from('products')
      .select('id, title, status, seller_id, sale_price, rent_price_per_day, pickup_address')
      .in('id', productIds);

    if (prodErr || !products) {
      return res.status(500).json({
        success: false,
        message: 'Failed to verify items in request.',
        error: prodErr?.message
      });
    }

    const productMap = new Map(products.map(p => [p.id, p]));

    // Validate each item
    const buyItems = [];
    const rentalItems = [];

    for (const item of items) {
      const product = productMap.get(item.productId);
      if (!product) {
        return res.status(404).json({
          success: false,
          message: `Product ${item.productId} was not found.`
        });
      }

      if (product.status !== 'active') {
        return res.status(400).json({
          success: false,
          message: `Product "${product.title}" is no longer active.`
        });
      }

      if (product.seller_id === buyerId) {
        return res.status(400).json({
          success: false,
          message: `You cannot request your own listing: "${product.title}".`
        });
      }

      if (item.mode === 'buy') {
        if (!product.sale_price || Number(product.sale_price) <= 0) {
          return res.status(400).json({
            success: false,
            message: `Product "${product.title}" is not available for purchase.`
          });
        }
        const qty = Math.max(1, parseInt(item.quantity, 10) || 1);
        const unitPrice = Number(product.sale_price);
        buyItems.push({
          productId: product.id,
          sellerId: product.seller_id,
          title: product.title,
          quantity: qty,
          unitPrice: unitPrice,
          totalPrice: unitPrice * qty
        });
      } else if (item.mode === 'rent') {
        if (!product.rent_price_per_day || Number(product.rent_price_per_day) <= 0) {
          return res.status(400).json({
            success: false,
            message: `Product "${product.title}" is not available for rent.`
          });
        }

        if (!item.rentalStartDate || !item.rentalEndDate) {
          return res.status(400).json({
            success: false,
            message: `Rental request for "${product.title}" requires start and return dates.`
          });
        }

        const start = new Date(item.rentalStartDate);
        const end = new Date(item.rentalEndDate);

        if (isNaN(start.getTime()) || isNaN(end.getTime()) || end < start) {
          return res.status(400).json({
            success: false,
            message: `Invalid rental duration dates for "${product.title}".`
          });
        }

        const diffTime = Math.abs(end - start);
        const diffDays = Math.max(1, Math.ceil(diffTime / (1000 * 60 * 60 * 24)));
        const dailyRate = Number(product.rent_price_per_day);
        const totalAmount = dailyRate * diffDays;

        rentalItems.push({
          product_id: product.id,
          renter_id: buyerId,
          seller_id: product.seller_id,
          start_date: item.rentalStartDate,
          end_date: item.rentalEndDate,
          daily_rate: dailyRate,
          total_amount: totalAmount,
          status: 'pending',
          pickup_address: null // Hidden until accepted
        });
      } else {
        return res.status(400).json({
          success: false,
          message: `Invalid transaction mode "${item.mode}". Must be "buy" or "rent".`
        });
      }
    }

    const createdRequests = {
      orders: [],
      rentals: []
    };

    // 1. Process Buy items (grouped into an order or orders)
    if (buyItems.length > 0) {
      const totalAmount = buyItems.reduce((acc, curr) => acc + curr.totalPrice, 0);
      const { data: order, error: orderErr } = await client
        .from('orders')
        .insert({
          buyer_id: buyerId,
          total_amount: totalAmount,
          status: 'pending',
          payment_status: 'simulated'
        })
        .select()
        .single();

      if (orderErr) {
        return res.status(500).json({
          success: false,
          message: 'Failed to create buy order.',
          error: orderErr.message
        });
      }

      const orderItemRows = buyItems.map(item => ({
        order_id: order.id,
        product_id: item.productId,
        seller_id: item.sellerId,
        product_title: item.title,
        quantity: item.quantity,
        unit_price: item.unitPrice
      }));

      const { data: itemsCreated, error: itemsErr } = await client
        .from('order_items')
        .insert(orderItemRows)
        .select();

      if (itemsErr) {
        return res.status(500).json({
          success: false,
          message: 'Failed to record order items.',
          error: itemsErr.message
        });
      }

      createdRequests.orders.push({
        ...order,
        items: itemsCreated
      });
    }

    // 2. Process Rental items
    if (rentalItems.length > 0) {
      const { data: rentalsCreated, error: rentalErr } = await client
        .from('rental_requests')
        .insert(rentalItems)
        .select();

      if (rentalErr) {
        return res.status(500).json({
          success: false,
          message: 'Failed to create rental request(s).',
          error: rentalErr.message
        });
      }

      createdRequests.rentals = rentalsCreated;
    }

    return res.status(201).json({
      success: true,
      message: 'Requests created successfully.',
      data: createdRequests
    });
  } catch (err) {
    console.error('Error submitting requests:', err);
    return res.status(500).json({
      success: false,
      message: 'Internal server error while processing request.',
      error: err.message
    });
  }
});

/**
 * GET /api/requests/buyer
 * Buyer views all their submitted requests (orders and rentals).
 * Sensitive seller pickup details are strictly omitted/null unless status is 'accepted'.
 */
router.get('/buyer', requireAuth, async (req, res) => {
  try {
    const buyerId = req.user.id;
    const client = getClient(req);

    // Fetch buyer rental requests
    const { data: rentals, error: rentalErr } = await client
      .from('rental_requests')
      .select(`
        id,
        status,
        start_date,
        end_date,
        daily_rate,
        total_amount,
        pickup_address,
        created_at,
        seller_id,
        product_id,
        products (
          id,
          title,
          pickup_address,
          status,
          product_images (
            storage_path,
            sort_order
          )
        )
      `)
      .eq('renter_id', buyerId)
      .order('created_at', { ascending: false });

    if (rentalErr) {
      return res.status(500).json({
        success: false,
        message: 'Failed to fetch rental requests.',
        error: rentalErr.message
      });
    }

    // Fetch buyer orders with items
    const { data: orders, error: orderErr } = await client
      .from('orders')
      .select(`
        id,
        status,
        total_amount,
        payment_status,
        created_at,
        order_items (
          id,
          product_id,
          seller_id,
          product_title,
          quantity,
          unit_price,
          products (
            id,
            title,
            pickup_address,
            status,
            product_images (
              storage_path,
              sort_order
            )
          )
        )
      `)
      .eq('buyer_id', buyerId)
      .order('created_at', { ascending: false });

    if (orderErr) {
      return res.status(500).json({
        success: false,
        message: 'Failed to fetch purchase requests.',
        error: orderErr.message
      });
    }

    // Sanitize pickup_address: ONLY reveal if request status is 'accepted'
    const sanitizedRentals = (rentals || []).map(r => {
      // Map database status 'approved' to client-facing 'accepted'
      const clientStatus = r.status === 'approved' ? 'accepted' : r.status;
      const isAccepted = clientStatus === 'accepted';
      const address = isAccepted ? (r.pickup_address || r.products?.pickup_address || null) : null;
      const sortedImages = (r.products?.product_images || []).sort((a, b) => (a.sort_order || 0) - (b.sort_order || 0));
      return {
        id: r.id,
        type: 'rent',
        productId: r.product_id,
        title: r.products?.title || 'Unknown Product',
        image: sortedImages[0]?.storage_path || null,
        status: clientStatus,
        startDate: r.start_date,
        endDate: r.end_date,
        totalAmount: Number(r.total_amount),
        dailyRate: Number(r.daily_rate),
        pickupAddress: address,
        createdAt: r.created_at
      };
    });

    const sanitizedOrders = (orders || []).flatMap(order => {
      // Map database status 'confirmed' -> 'accepted', 'cancelled' -> 'rejected'
      let clientStatus = order.status;
      if (order.status === 'confirmed') clientStatus = 'accepted';
      else if (order.status === 'cancelled') clientStatus = 'rejected';

      const isAccepted = clientStatus === 'accepted';
      return (order.order_items || []).map(item => {
        const address = isAccepted ? (item.products?.pickup_address || null) : null;
        const sortedImages = (item.products?.product_images || []).sort((a, b) => (a.sort_order || 0) - (b.sort_order || 0));
        return {
          id: order.id,
          orderItemId: item.id,
          type: 'buy',
          productId: item.product_id,
          title: item.product_title || item.products?.title || 'Unknown Product',
          image: sortedImages[0]?.storage_path || null,
          status: clientStatus,
          quantity: item.quantity,
          unitPrice: Number(item.unit_price),
          totalAmount: Number(item.quantity) * Number(item.unit_price),
          pickupAddress: address,
          createdAt: order.created_at
        };
      });
    });

    return res.status(200).json({
      success: true,
      data: {
        rentals: sanitizedRentals,
        orders: sanitizedOrders,
        all: [...sanitizedRentals, ...sanitizedOrders].sort(
          (a, b) => new Date(b.createdAt) - new Date(a.createdAt)
        )
      }
    });
  } catch (err) {
    console.error('Error fetching buyer requests:', err);
    return res.status(500).json({
      success: false,
      message: 'Internal server error while fetching buyer requests.',
      error: err.message
    });
  }
});

/**
 * GET /api/requests/seller
 * Seller views incoming requests (both rentals and buy orders) for their listings.
 */
router.get('/seller', requireAuth, async (req, res) => {
  try {
    const sellerId = req.user.id;
    const client = getClient(req);

    // 1. Fetch incoming rental requests
    const { data: rentals, error: rentalErr } = await client
      .from('rental_requests')
      .select(`
        id,
        status,
        start_date,
        end_date,
        daily_rate,
        total_amount,
        pickup_address,
        created_at,
        renter_id,
        product_id,
        products (
          id,
          title,
          pickup_address,
          product_images (
            storage_path,
            sort_order
          )
        )
      `)
      .eq('seller_id', sellerId)
      .order('created_at', { ascending: false });

    if (rentalErr) {
      return res.status(500).json({
        success: false,
        message: 'Failed to fetch incoming rentals.',
        error: rentalErr.message
      });
    }

    // 2. Fetch incoming order items
    const { data: orderItems, error: orderErr } = await client
      .from('order_items')
      .select(`
        id,
        order_id,
        product_id,
        seller_id,
        product_title,
        quantity,
        unit_price,
        created_at,
        orders (
          id,
          buyer_id,
          status,
          created_at
        ),
        products (
          id,
          title,
          pickup_address,
          product_images (
            storage_path,
            sort_order
          )
        )
      `)
      .eq('seller_id', sellerId)
      .order('created_at', { ascending: false });

    if (orderErr) {
      return res.status(500).json({
        success: false,
        message: 'Failed to fetch incoming orders.',
        error: orderErr.message
      });
    }

    // Collect renter/buyer IDs to retrieve their emails or names if available
    const userIds = [
      ...new Set([
        ...(rentals || []).map(r => r.renter_id),
        ...(orderItems || []).map(item => item.orders?.buyer_id).filter(Boolean)
      ])
    ];

    let userMap = new Map();
    if (userIds.length > 0) {
      const { data: profiles } = await client
        .from('profiles')
        .select('id, full_name, email')
        .in('id', userIds);

      if (profiles) {
        userMap = new Map(profiles.map(p => [p.id, p]));
      }
    }

    const formattedRentals = (rentals || []).map(r => {
      const renterProfile = userMap.get(r.renter_id);
      const sortedImages = (r.products?.product_images || []).sort((a, b) => (a.sort_order || 0) - (b.sort_order || 0));
      const clientStatus = r.status === 'approved' ? 'accepted' : r.status;
      return {
        id: r.id,
        type: 'rent',
        status: clientStatus,
        productId: r.product_id,
        productTitle: r.products?.title || 'Unknown Product',
        productImage: sortedImages[0]?.storage_path || null,
        requesterId: r.renter_id,
        requesterName: renterProfile?.full_name || renterProfile?.email || 'Buyer',
        startDate: r.start_date,
        endDate: r.end_date,
        dailyRate: Number(r.daily_rate),
        totalAmount: Number(r.total_amount),
        pickupAddress: r.products?.pickup_address || r.pickup_address,
        createdAt: r.created_at
      };
    });

    const formattedOrders = (orderItems || []).map(item => {
      const buyerId = item.orders?.buyer_id;
      const buyerProfile = userMap.get(buyerId);
      const sortedImages = (item.products?.product_images || []).sort((a, b) => (a.sort_order || 0) - (b.sort_order || 0));
      let clientStatus = item.orders?.status || 'pending';
      if (clientStatus === 'confirmed') clientStatus = 'accepted';
      else if (clientStatus === 'cancelled') clientStatus = 'rejected';

      return {
        id: item.orders?.id,
        orderItemId: item.id,
        type: 'buy',
        status: clientStatus,
        productId: item.product_id,
        productTitle: item.product_title || item.products?.title || 'Unknown Product',
        productImage: sortedImages[0]?.storage_path || null,
        requesterId: buyerId,
        requesterName: buyerProfile?.full_name || buyerProfile?.email || 'Buyer',
        quantity: item.quantity,
        unitPrice: Number(item.unit_price),
        totalAmount: Number(item.quantity) * Number(item.unit_price),
        pickupAddress: item.products?.pickup_address,
        createdAt: item.orders?.created_at || item.created_at
      };
    });

    return res.status(200).json({
      success: true,
      data: {
        rentals: formattedRentals,
        orders: formattedOrders,
        all: [...formattedRentals, ...formattedOrders].sort(
          (a, b) => new Date(b.createdAt) - new Date(a.createdAt)
        )
      }
    });
  } catch (err) {
    console.error('Error fetching seller requests:', err);
    return res.status(500).json({
      success: false,
      message: 'Internal server error while fetching incoming requests.',
      error: err.message
    });
  }
});

/**
 * PATCH /api/requests/:type/:id
 * Seller accepts or rejects an incoming request.
 * :type must be 'rent' or 'buy' (or 'order').
 * Body: { action: 'accept' | 'reject' }
 */
router.patch('/:type/:id', requireAuth, async (req, res) => {
  try {
    const sellerId = req.user.id;
    const { type, id } = req.params;
    const { action } = req.body;

    if (!['accept', 'reject'].includes(action)) {
      return res.status(400).json({
        success: false,
        message: 'Invalid action. Must be "accept" or "reject".'
      });
    }

    const client = getClient(req);

    if (type === 'rent') {
      const dbStatus = action === 'accept' ? 'approved' : 'rejected';

      // Find the rental request and verify ownership
      const { data: rental, error: fetchErr } = await client
        .from('rental_requests')
        .select('id, seller_id, status, product_id, products(pickup_address)')
        .eq('id', id)
        .single();

      if (fetchErr || !rental) {
        return res.status(404).json({
          success: false,
          message: 'Rental request not found.'
        });
      }

      if (rental.seller_id !== sellerId) {
        return res.status(403).json({
          success: false,
          message: 'You are not authorized to update this rental request.'
        });
      }

      const updatePayload = {
        status: dbStatus,
        updated_at: new Date().toISOString()
      };

      if (action === 'accept' && rental.products?.pickup_address) {
        updatePayload.pickup_address = rental.products.pickup_address;
      }

      const { data: updated, error: updateErr } = await client
        .from('rental_requests')
        .update(updatePayload)
        .eq('id', id)
        .select()
        .single();

      if (updateErr) {
        return res.status(500).json({
          success: false,
          message: 'Failed to update rental request status.',
          error: updateErr.message
        });
      }

      return res.status(200).json({
        success: true,
        message: `Rental request ${action === 'accept' ? 'accepted' : 'rejected'} successfully.`,
        data: {
          ...updated,
          status: action === 'accept' ? 'accepted' : 'rejected'
        }
      });
    } else if (type === 'buy' || type === 'order') {
      const dbStatus = action === 'accept' ? 'confirmed' : 'cancelled';

      // Verify seller has an item in this order
      const { data: orderItem, error: fetchErr } = await client
        .from('order_items')
        .select('id, order_id, seller_id')
        .eq('order_id', id)
        .eq('seller_id', sellerId)
        .maybeSingle();

      if (fetchErr || !orderItem) {
        return res.status(403).json({
          success: false,
          message: 'You are not authorized to update this order or it does not exist.'
        });
      }

      const { data: updated, error: updateErr } = await client
        .from('orders')
        .update({
          status: dbStatus,
          updated_at: new Date().toISOString()
        })
        .eq('id', id)
        .select()
        .single();

      if (updateErr) {
        return res.status(500).json({
          success: false,
          message: 'Failed to update order status.',
          error: updateErr.message
        });
      }

      return res.status(200).json({
        success: true,
        message: `Order ${action === 'accept' ? 'accepted' : 'rejected'} successfully.`,
        data: {
          ...updated,
          status: action === 'accept' ? 'accepted' : 'rejected'
        }
      });
    } else {
      return res.status(400).json({
        success: false,
        message: 'Invalid request type. Must be "rent" or "buy".'
      });
    }
  } catch (err) {
    console.error('Error updating request status:', err);
    return res.status(500).json({
      success: false,
      message: 'Internal server error while updating request status.',
      error: err.message
    });
  }
});

module.exports = router;
