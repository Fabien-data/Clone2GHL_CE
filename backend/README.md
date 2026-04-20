# Clone2GHL Backend (Lean Foundation)

This backend provides the first production path for:
- Auth (register/login/me)
- Funnel sync API
- Usage metering API
- Stripe checkout + webhook skeleton

## Run

1. Copy `.env.example` to `.env`
2. Set `JWT_SECRET` and Stripe keys
3. Set `CLIENT_URL` to an HTTP(S) URL for Stripe success/cancel redirects (for example: `https://your-app-domain.com`)
4. Install deps:
   - `npm install`
5. Start server:
   - `npm run dev`

Server URL defaults to `http://localhost:8080`.

## API

- `GET /health`
- `POST /api/auth/register`
- `POST /api/auth/login`
- `GET /api/auth/me`
- `GET /api/funnels`
- `POST /api/funnels`
- `DELETE /api/funnels/:id`
- `GET /api/usage`
- `POST /api/usage/consume`
- `POST /api/billing/checkout`
- `POST /api/billing/webhook`

## Notes

- Data is stored in `backend/data/db.json` for fast startup.
- Move to PostgreSQL before full production scale.
