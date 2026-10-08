
## 🧪 Zona de testes

Este repositório é uma **cópia isolada** do [REPORTCLAUDE](https://github.com/performance-sketch/REPORTCLAUDE) para testes. As automações estão desligadas (sem secrets), então os dados ficam congelados na data da cópia (08/10/2026). Versão oficial: https://performance-sketch.github.io/REPORTCLAUDE/
# Marketing Dashboard — Meta Ads + Rezdy

Dashboard de performance em tempo real integrando **Meta Ads** (investimento, campanhas, funil)
com **Rezdy** (reservas, receita, produtos). Exibe ROAS real, CAC, ticket médio e funil de
aquisição unificado.

## Arquitetura rápida

```
Meta Ads API ──(worker 30min)──► fact_meta_ad_performance_daily ─┐
                                                                   ├─► Views SQL ──► FastAPI ──► Next.js
Rezdy Webhook ──(transform)────► fact_rezdy_bookings ─────────────┘
Rezdy API ────(reconciliação)──► fact_rezdy_bookings
```

## Pré-requisitos

- Python 3.12+
- Node.js 20+
- Docker + Docker Compose
- Conta ativa Meta Ads com token de acesso
- Conta Rezdy com API Key

## Rodar localmente

### 1. Clone e configure variáveis

```bash
git clone https://github.com/SEU-ORG/marketing-rezdy-meta-dashboard
cd marketing-rezdy-meta-dashboard
cp .env.example .env
# Edite .env com suas credenciais (veja docs/setup_api_keys.md)
```

### 2. Suba o banco e Redis

```bash
docker compose up postgres redis -d
```

### 3. Rode as migrations

```bash
pip install -r apps/api/requirements.txt
export DATABASE_SYNC_URL=postgresql://dashboard:password@localhost:5432/dashboard
alembic -c db/migrations/alembic.ini upgrade head
```

### 4. Inicie a API

```bash
cd apps/api
uvicorn app.main:app --reload --port 8000
# Docs: http://localhost:8000/docs
```

### 5. Inicie o worker

```bash
python workers/transform_worker.py
```

### 6. Inicie o dashboard

```bash
cd apps/dashboard
npm install
NEXT_PUBLIC_API_URL=http://localhost:8000 npm run dev
# http://localhost:3000
```

### 7. Primeiro sync de dados

```bash
# Meta Ads (últimos 30 dias)
python workers/meta_ads_worker.py --lookback-days 30

# Rezdy (últimos 7 dias)
python workers/rezdy_reconciliation_worker.py --lookback-days 7
```

## Docker Compose completo

```bash
# Sobe tudo (API, worker, dashboard, postgres, redis)
docker compose up --build

# Só rodar migrations
docker compose run --rm migrations
```

## Configurar Supabase (alternativa ao Postgres local)

1. Crie um projeto em [supabase.com](https://supabase.com)
2. Copie a connection string (pooler Transaction mode para API, Direct para Alembic)
3. No `.env`:
   ```
   DATABASE_URL=postgresql+asyncpg://postgres:[SENHA]@db.[REF].supabase.co:5432/postgres
   DATABASE_SYNC_URL=postgresql://postgres:[SENHA]@db.[REF].supabase.co:5432/postgres
   ```
4. Execute as migrations normalmente

## Estrutura do repositório

```
apps/
  api/          FastAPI backend (Python 3.12)
  dashboard/    Next.js 14 frontend
connectors/
  meta_ads/     Cliente Meta Ads API
  rezdy/        Cliente Rezdy + webhook parser
workers/        Workers de sync e transform
db/
  migrations/   Alembic
  views/        Views SQL de KPIs
docs/           Documentação técnica
.github/
  workflows/    CI, deploy, sync agendado
```

## Configurar credenciais

Veja [docs/setup_api_keys.md](docs/setup_api_keys.md).

## Testes

```bash
pytest apps/api/tests -v
```

## Deploy

Veja [docs/architecture.md](docs/architecture.md) e o workflow `.github/workflows/deploy.yml`.
Edite o workflow com seu provider preferido (Railway, Render, Fly.io, Vercel, etc.).

## GitHub Secrets necessários para CI/CD

| Secret | Descrição |
|---|---|
| `DATABASE_SYNC_URL` | URL do banco em produção |
| `META_ACCESS_TOKEN` | Token Meta Ads |
| `META_AD_ACCOUNT_IDS` | IDs das contas |
| `REZDY_API_KEY` | Chave Rezdy |
| `REZDY_WEBHOOK_SECRET` | Secret do webhook |
| `APP_SECRET_KEY` | Chave da aplicação (32+ chars) |
| `SYNC_TRIGGER_SECRET` | Secret do endpoint de sync |
| `API_URL` | URL da API em produção |
| `NEXT_PUBLIC_API_URL` | URL pública da API |
