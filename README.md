### Prerequisites

- node v20
- PostgreSQL instance (only required when persisting slider submissions)

### Local development

```bash
npm install
DATABASE_URL=postgresql://user:pass@localhost:5432/frankeinstein npm run replacement-server
npm run dev
```

The replacement server exposes:

- `npm run replacement-server:prod` boots the compiled Node server from `dist/server` (used inside Docker).
- `POST /replacement-model` to update the model overrides (existing behaviour).
- `POST /replacement-model/slider-values` to persist a slider submission. Payload:

```jsonc
{
  "sessionId": "abc-123",
  "questionId": "housingMicro",
  "questionText": "Affordable Housing",
  "value": 7.5
}
```

The optional `questionText`, `prompt`, or `question` fields are stored verbatim when set, and you can provide an optional `recordedAt` or `submittedAt` timestamp.

### Docker Compose stack

Build and run the UI, replacement server, and a PostgreSQL database:

```bash
docker compose up --build
```

Services:

- `ui` (Vite preview on http://localhost:5173)
- `replacement-server` (HTTP + WebSocket on http://localhost:43110)
- `db` (PostgreSQL with persistent volume `db-data`)

Environment variables:

- `DATABASE_URL` configures the Postgres connection string for the replacement server (defaults to the connection inside `docker-compose.yml`).
- `SLIDER_STORAGE_RETRY_ATTEMPTS` and `SLIDER_STORAGE_RETRY_DELAY_MS` control database retry behaviour during startup.
