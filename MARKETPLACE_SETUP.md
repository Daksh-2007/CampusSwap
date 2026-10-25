# CampusSwap Marketplace Backend — Setup & API Testing

## What was added/updated

- `backend/src/routes/products.js`: public product browse/detail routes; authenticated seller-only create/update/deactivate routes; validation, filters, pagination, and Supabase Storage image uploads.
- `backend/src/middleware/auth.js`: added `requireSeller`, which checks the user's `public.profiles.role` from the database.
- `backend/src/lib/supabase.js`: removed the secret/service-role key fallback. Normal API operations use only the publishable/anon key and the caller's access token.
- `backend/src/sql/policies.sql`: RLS policies for profile role lookup, products, product images, and product-image storage. Includes cleanup of older broad storage policies.
- Root `package.json`: added convenience scripts so commands can be run from the project root.

## 1. Environment variables

Create `backend/.env` using `backend/.env.example` as a template:

```dotenv
PORT=5000
FRONTEND_URL=http://localhost:5500
SUPABASE_URL=https://YOUR_PROJECT_ID.supabase.co
SUPABASE_PUBLISHABLE_KEY=YOUR_PUBLISHABLE_OR_ANON_KEY
```

Use a publishable/anon key only. Do not put a Supabase secret/service-role key in the frontend or use it for normal user requests. Never commit `.env`.

## 2. Run the app

From the project root:

Terminal 1 — backend:
```bash
npm run dev
```

Terminal 2 — frontend:
```bash
npm run frontend
```

Open `http://localhost:5500`. The registration page is `/register.html` and login is `/login.html`.

If dependencies have not been installed, run `npm install` inside `backend` first. The frontend server uses Node's built-in HTTP module.

## 3. Apply the SQL policies

1. Open Supabase Dashboard → SQL Editor.
2. Open `backend/src/sql/policies.sql` in your editor.
3. Paste and run the full script.
4. Confirm it completes without SQL errors.

The script replaces policies with the names it manages. If the project has additional custom policies, inspect them before removing or changing them. Public read access to the `product-images` bucket is intentional for this MVP.

## 4. Enable seller role for a test account

New registrations receive the default `buyer` role. Do not allow users to assign their own role from the frontend.

After verifying the test account, an administrator can promote that specific profile using the Supabase SQL Editor:

```sql
UPDATE public.profiles
SET role = 'seller', updated_at = now()
WHERE id = 'REPLACE_WITH_THE_VERIFIED_USER_UUID';
```

The UUID is the user ID shown after login. Replace the placeholder with the verified test account's UUID. Do not run an update that promotes all users. Refresh/re-login after the role change if needed.

## 5. API endpoints

- `GET /api/health` — health check.
- `GET /api/products` — public active listings; optional query parameters: `category`, `listing_type=buy|rent|both`, `search`, `sort=created_at|sale_price|rent_price_per_day|title`, `order=asc|desc`, `limit`, `page`.
- `GET /api/products/seller/me` — authenticated seller's listings (both active and inactive); accepts optional `status=active|inactive`, `category`, `listing_type`, `search`, `sort`, `order`, `limit`, `page`.
- `GET /api/products/:id` — public detail for an active product.
- `POST /api/products` — seller-only create; accepts JSON or multipart form data, with optional repeated `images` file fields (max 5 images, 5 MB each).
- `PATCH /api/products/:id` — seller-only update; accepts JSON or multipart form data with optional `images`. Supports toggling status (`active` or `inactive`).
- `DELETE /api/products/:id` — seller-only soft-deactivation (`status=inactive`).

`POST` and `PATCH` derive ownership from the verified token and reject a client-provided `seller_id`. Valid listing types are `buy`, `rent`, and `both`; valid item conditions are `new`, `like_new`, `good`, and `fair`. The listing must include a sale price for `buy`/`both`, and a daily rent price for `rent`/`both`.

## 6. Test with PowerShell

Log in through the CampusSwap login page. In browser Developer Tools → Application → Session Storage, copy the `campus_swap_token` value locally. Do not paste or share it in chat or commit it.

In PowerShell, replace the token placeholder with your local access token:

```powershell
$token = "PASTE_TOKEN_LOCALLY"
$headers = @{ Authorization = "Bearer $token" }
```

List active products:
```powershell
Invoke-RestMethod -Uri "http://localhost:5000/api/products" -Method Get
```

Create a test listing (the logged-in profile must have role `seller`):
```powershell
$body = @{
  title = "Calculus textbook"
  description = "Used textbook in good condition"
  category = "Books"
  item_condition = "good"
  listing_type = "both"
  sale_price = 300
  rent_price_per_day = 20
  pickup_address = "Main campus gate"
} | ConvertTo-Json

$result = Invoke-RestMethod `
  -Uri "http://localhost:5000/api/products" `
  -Method Post `
  -Headers $headers `
  -ContentType "application/json" `
  -Body $body

$result
$productId = $result.data.id
```

Retrieve the product:
```powershell
Invoke-RestMethod -Uri "http://localhost:5000/api/products/$productId" -Method Get
```

Update its title:
```powershell
$patch = @{ title = "Calculus textbook — revised" } | ConvertTo-Json
Invoke-RestMethod `
  -Uri "http://localhost:5000/api/products/$productId" `
  -Method Patch `
  -Headers $headers `
  -ContentType "application/json" `
  -Body $patch
```

Deactivate it:
```powershell
Invoke-RestMethod `
  -Uri "http://localhost:5000/api/products/$productId" `
  -Method Delete `
  -Headers $headers
```

To test image upload with `curl.exe` (replace the token and local file path):
```powershell
curl.exe -X POST "http://localhost:5000/api/products" `
  -H "Authorization: Bearer PASTE_TOKEN_LOCALLY" `
  -F "title=Desk lamp" `
  -F "description=Working desk lamp" `
  -F "category=Electronics" `
  -F "item_condition=good" `
  -F "listing_type=buy" `
  -F "sale_price=250" `
  -F "pickup_address=Main campus gate" `
  -F "images=@C:\path\to\lamp.jpg"
```

## Notes / limitations

- Automated integration tests are not included in the supplied project. JavaScript syntax checks were run on all `.js` files and passed; Supabase queries, RLS behavior, and Storage uploads still require testing against your actual Supabase project.
- Product images use a public bucket, so anyone with an image URL can view the image. Do not upload sensitive/private images.
- A product created without images is valid. If an image upload fails during creation, the product row is retained but marked inactive so it is not shown to buyers.
- `requireSeller` returns `403` until the profile's database role is explicitly `seller`.
