# BookNook API

Express API designed to run locally and as a Vercel Node serverless function.

## Local development

1. Copy `.env.example` to `.env` and fill in the real values.
2. Run `npm install`.
3. Run `npm run dev`.
4. The API listens on `http://localhost:5000`.

## Vercel deployment

Deploy this folder as its own Vercel project. Set the environment variables from `.env.example` in the Vercel project settings. Do not set `PORT` on Vercel. Set `CORS_ORIGINS` to the exact frontend origin(s), comma-separated.

The backend verifies the HS256 API tokens issued by the frontend `/api/token` route using the same `JWT_SECRET`, `JWT_ISSUER`, and `JWT_AUDIENCE`. It does not use `JWKS_URL`.

Required routes: `GET /books`, `GET /books/:id`, `GET /books/mine`, `POST /books`, `PATCH /books/:id`, `DELETE /books/:id`, `GET /borrows`, `POST /borrows`, `DELETE /borrows/:id`, and `POST /upload`.
