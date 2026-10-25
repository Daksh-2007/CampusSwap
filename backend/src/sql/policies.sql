-- CampusSwap marketplace RLS and Storage policies.
-- Run in Supabase SQL Editor after the tables and `profiles` role column exist.
-- Safe to re-run: this file replaces only policies with these names.

-- Profiles: users may read their own profile, allowing the API to verify their DB role.
ALTER TABLE public.profiles ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Users can read own profile for role verification" ON public.profiles;
CREATE POLICY "Users can read own profile for role verification"
ON public.profiles
FOR SELECT
TO authenticated
USING (auth.uid() = id);

-- Products
ALTER TABLE public.products ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Public can view active products" ON public.products;
DROP POLICY IF EXISTS "Authenticated sellers can insert products" ON public.products;
DROP POLICY IF EXISTS "Sellers can update own products" ON public.products;
DROP POLICY IF EXISTS "Sellers can delete own products" ON public.products;

-- Visitors/buyers can browse active listings; sellers can also see their own inactive listings.
CREATE POLICY "Public can view active products"
ON public.products
FOR SELECT
USING (status = 'active' OR auth.uid() = seller_id);

-- Only profiles explicitly promoted to seller can create listings.
CREATE POLICY "Authenticated sellers can insert products"
ON public.products
FOR INSERT
TO authenticated
WITH CHECK (
  auth.uid() = seller_id
  AND EXISTS (
    SELECT 1 FROM public.profiles profile
    WHERE profile.id = auth.uid()
      AND profile.role = 'seller'
  )
);

CREATE POLICY "Sellers can update own products"
ON public.products
FOR UPDATE
TO authenticated
USING (
  auth.uid() = seller_id
  AND EXISTS (
    SELECT 1 FROM public.profiles profile
    WHERE profile.id = auth.uid()
      AND profile.role = 'seller'
  )
)
WITH CHECK (
  auth.uid() = seller_id
  AND EXISTS (
    SELECT 1 FROM public.profiles profile
    WHERE profile.id = auth.uid()
      AND profile.role = 'seller'
  )
);

CREATE POLICY "Sellers can delete own products"
ON public.products
FOR DELETE
TO authenticated
USING (
  auth.uid() = seller_id
  AND EXISTS (
    SELECT 1 FROM public.profiles profile
    WHERE profile.id = auth.uid()
      AND profile.role = 'seller'
  )
);

-- Product image metadata
ALTER TABLE public.product_images ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Public can view product images for accessible products" ON public.product_images;
DROP POLICY IF EXISTS "Sellers can insert product images for own products" ON public.product_images;
DROP POLICY IF EXISTS "Sellers can update product images for own products" ON public.product_images;
DROP POLICY IF EXISTS "Sellers can delete images for own products" ON public.product_images;

CREATE POLICY "Public can view product images for accessible products"
ON public.product_images
FOR SELECT
USING (
  EXISTS (
    SELECT 1 FROM public.products p
    WHERE p.id = product_images.product_id
      AND (p.status = 'active' OR p.seller_id = auth.uid())
  )
);

CREATE POLICY "Sellers can insert product images for own products"
ON public.product_images
FOR INSERT
TO authenticated
WITH CHECK (
  EXISTS (
    SELECT 1 FROM public.products p
    JOIN public.profiles profile ON profile.id = p.seller_id
    WHERE p.id = product_images.product_id
      AND p.seller_id = auth.uid()
      AND profile.role = 'seller'
  )
);

CREATE POLICY "Sellers can update product images for own products"
ON public.product_images
FOR UPDATE
TO authenticated
USING (
  EXISTS (
    SELECT 1 FROM public.products p
    WHERE p.id = product_images.product_id
      AND p.seller_id = auth.uid()
  )
)
WITH CHECK (
  EXISTS (
    SELECT 1 FROM public.products p
    WHERE p.id = product_images.product_id
      AND p.seller_id = auth.uid()
  )
);

CREATE POLICY "Sellers can delete images for own products"
ON public.product_images
FOR DELETE
TO authenticated
USING (
  EXISTS (
    SELECT 1 FROM public.products p
    WHERE p.id = product_images.product_id
      AND p.seller_id = auth.uid()
  )
);

-- Supabase Storage bucket: image object paths are `<product_uuid>/<filename>`.
-- Uploads/deletes are permitted only when the first path segment identifies a
-- product owned by the authenticated seller. Public read is intentional because
-- product listing images are public in this MVP.
INSERT INTO storage.buckets (id, name, public)
VALUES ('product-images', 'product-images', true)
ON CONFLICT (id) DO UPDATE SET public = true;

-- Remove names used by the earlier draft, including its overly broad upload policy.
DROP POLICY IF EXISTS "Public Access" ON storage.objects;
DROP POLICY IF EXISTS "Authenticated users can upload product images" ON storage.objects;
DROP POLICY IF EXISTS "Users can delete own product images" ON storage.objects;

DROP POLICY IF EXISTS "CampusSwap public product image read" ON storage.objects;
DROP POLICY IF EXISTS "CampusSwap seller upload own product images" ON storage.objects;
DROP POLICY IF EXISTS "CampusSwap seller delete own product images" ON storage.objects;

CREATE POLICY "CampusSwap public product image read"
ON storage.objects
FOR SELECT
USING (bucket_id = 'product-images');

CREATE POLICY "CampusSwap seller upload own product images"
ON storage.objects
FOR INSERT
TO authenticated
WITH CHECK (
  bucket_id = 'product-images'
  AND split_part(name, '/', 1) ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
  AND EXISTS (
    SELECT 1 FROM public.products p
    JOIN public.profiles profile ON profile.id = p.seller_id
    WHERE p.id::text = split_part(name, '/', 1)
      AND p.seller_id = auth.uid()
      AND profile.role = 'seller'
  )
);

CREATE POLICY "CampusSwap seller delete own product images"
ON storage.objects
FOR DELETE
TO authenticated
USING (
  bucket_id = 'product-images'
  AND split_part(name, '/', 1) ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
  AND EXISTS (
    SELECT 1 FROM public.products p
    WHERE p.id::text = split_part(name, '/', 1)
      AND p.seller_id = auth.uid()
  )
);

-- Do NOT grant seller role to all users. For local MVP testing, an administrator
-- may promote a specific user's profile manually after verifying their identity:
-- UPDATE public.profiles SET role = 'seller' WHERE id = '<verified-auth-user-uuid>';
