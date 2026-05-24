# API Gateway — Movientum

## Overview

An API Gateway is a single entry point that all clients talk to. It sits in front of all backend services and handles cross-cutting concerns: routing, authentication, rate limiting, logging, and SSL termination. The gateway abstracts service topology from clients — clients don't know or care if there's one backend or ten.

---

## API Gateway vs FastAPI Router: Key Difference

Beginners often confuse these two. They operate at completely different levels.

| Aspect | FastAPI Router | API Gateway |
|--------|---------------|-------------|
| **Location** | Inside application code | External infrastructure layer |
| **Language** | Python | Nginx config / Kong DSL / YAML |
| **Knows about** | Business logic, services, DB | HTTP traffic only |
| **Responsibilities** | Route requests to correct handler function | Route requests to correct microservice |
| **Handles** | Request parsing, response generation | SSL, rate limiting, auth check, load balancing |
| **Example** | `@router.get("/movies")` → `movie_service.get()` | `/api/*` → `http://backend-service:8000` |
| **Per-service or shared** | One per service | One for entire platform |

FastAPI Router = inside your app. API Gateway = in front of your app (or apps).

At MVP: Nginx acts as lightweight API Gateway (handles routing + SSL, no advanced features).
At scale: Dedicated gateway like Kong adds rate limiting, auth, observability per-route.

---

## Role of API Gateway in Movientum

```
Internet
  │
  ▼
┌─────────────────────────────────────────────────────┐
│                    API GATEWAY                       │
│                  (Nginx → Kong)                      │
│                                                      │
│  1. SSL Termination (HTTPS → HTTP internally)        │
│  2. Rate Limiting (per IP, per user)                 │
│  3. Auth Validation (JWT check before routing)       │
│  4. Request Routing (which backend handles this?)    │
│  5. Load Balancing (which instance handles this?)    │
│  6. Request Logging (every request logged here)      │
│  7. Response Headers (CORS, security headers)        │
│                                                      │
└───────────────────────┬─────────────────────────────┘
                        │
          ┌─────────────┼───────────────┐
          ▼             ▼               ▼
    FastAPI Core   FedPCL Service  News Service
    (movies, auth,  (future split)  (future split)
    ratings, recs)
```

---

## Phase 1: Nginx as API Gateway (MVP)

Nginx handles gateway responsibilities without a dedicated gateway product.

### What Nginx Does

**SSL Termination:**
- Accepts HTTPS on port 443 (certificate from Let's Encrypt)
- Decrypts to HTTP internally (backend talks plain HTTP — simpler, faster)
- Forces redirect: `http://` → `https://`

**Request Routing:**
```
Location rules:

/api/v1/*        → proxy_pass http://backend:8000
/*               → serve React SPA (index.html)
/admin/*         → proxy_pass http://backend:8000 (with IP whitelist)
/health          → return 200 OK directly (no backend hit)
```

**Basic Rate Limiting (Nginx `limit_req`):**
```
Login endpoint: max 5 requests/minute per IP
Register endpoint: max 10 requests/hour per IP
Global: max 200 requests/minute per IP (DDoS basic protection)
```

**Security Headers (added by Nginx to every response):**
```
Strict-Transport-Security: max-age=31536000  (HSTS)
X-Content-Type-Options: nosniff
X-Frame-Options: DENY
Content-Security-Policy: [restricted sources]
Referrer-Policy: strict-origin-when-cross-origin
```

**CORS Handling:**
```
Allowed origins: https://movientum.com, http://localhost:3000
Allowed methods: GET, POST, PUT, DELETE, OPTIONS
Allowed headers: Content-Type, Authorization
Exposed headers: X-Request-ID
```

**Load Balancing (when multiple backend instances):**
```
upstream backend_pool {
  least_conn;                         # Route to least busy server
  server backend1:8000 weight=1;
  server backend2:8000 weight=1;
  server backend3:8000 weight=1;
  keepalive 32;                       # Keep connections warm
}

location /api/ {
  proxy_pass http://backend_pool;
}
```

---

## Phase 2: Kong Gateway (Scale)

When platform grows, replace Nginx with **Kong Gateway** (open source). Kong sits in front of Nginx or replaces it.

### What Kong Adds Over Nginx

**Route-Level Rate Limiting:**
```
Route: POST /api/v1/auth/login
  → rate limit: 5 req/min per IP  (strict)

Route: GET /api/v1/movies
  → rate limit: 1000 req/min per user  (generous)

Route: POST /api/v1/fedpcl/update
  → rate limit: 1 req/round per user  (very strict)
```

**Authentication Plugin (JWT validation at gateway):**
```
Kong validates JWT token BEFORE request reaches FastAPI.
FastAPI backend no longer needs auth middleware (Kong handles it).
Invalid token → Kong returns 401 immediately (no backend hit).
Valid token → Kong passes user_id to backend via header: X-User-ID: abc123
```

Benefits:
- Backend code simpler (no auth middleware)
- Failed auth never hits backend → saves compute
- Centralized auth logic for all services

**API Key Management:**
```
For third-party integrations (future):
  External apps register → get API key
  Kong validates key on every request
  FastAPI backend unaware of API keys
```

**Observability (per-route metrics):**
```
Kong emits:
  Request count per route
  Latency per route (P50, P95, P99)
  Error rate per route
  Rate limit hits per route
→ Sent to Prometheus → Grafana dashboard
```

**Circuit Breaker:**
```
If backend returns 5xx errors > 50% for 30 seconds:
  Kong opens circuit breaker for that service
  Returns 503 immediately for next 30 seconds
  Tries one request every 30s (half-open state)
  If that succeeds: close breaker, resume normal routing
Prevents cascade failures when one service is struggling.
```

**Request Transformation:**
```
Add headers before forwarding:
  X-Request-ID: uuid4()        (for distributed tracing)
  X-Gateway-Version: "kong/2.8"
  X-User-ID: {from JWT}
  X-User-Role: {from JWT}

Strip headers before forwarding:
  Authorization: Bearer ...    (no need for backend to parse it again)
```

---

## Routing Table (Full Movientum)

| Path Pattern | Method | Auth Required | Rate Limit | Routes To |
|-------------|--------|---------------|-----------|-----------|
| `/api/v1/auth/login` | POST | No | 5/min/IP | backend:8000 |
| `/api/v1/auth/register` | POST | No | 10/hr/IP | backend:8000 |
| `/api/v1/auth/refresh` | POST | Refresh token | 30/hr/user | backend:8000 |
| `/api/v1/movies` | GET | No | 200/min | backend:8000 |
| `/api/v1/movies/{id}` | GET | No | 200/min | backend:8000 |
| `/api/v1/search` | GET | No | 100/min | backend:8000 |
| `/api/v1/ratings` | POST | Yes | 50/min/user | backend:8000 |
| `/api/v1/watch` | POST | Yes | 50/min/user | backend:8000 |
| `/api/v1/recommendations` | GET | Yes | 20/min/user | backend:8000 |
| `/api/v1/news` | GET | No | 100/min | backend:8000 |
| `/api/v1/fedpcl/model/latest` | GET | Yes | 1/day/user | backend:8000 |
| `/api/v1/fedpcl/update` | POST | Yes | 1/round/user | backend:8000 |
| `/api/v1/admin/*` | * | Yes + admin role | 50/min | backend:8000 |
| `/api/health` | GET | No | Unlimited | backend:8000 |

---

## Authentication Layer in Gateway

### Current (FastAPI Middleware)
```
Request → FastAPI Auth Middleware → validate JWT → attach user → handler
```

### Future (Kong JWT Plugin)
```
Request → Kong JWT Plugin → validate JWT → pass X-User-ID header → FastAPI handler
FastAPI: reads X-User-ID from trusted header (no JWT parsing needed)
```

**Why move to gateway auth:**
- One place to update auth logic (not in each service)
- Failed auths never waste backend cycles
- Consistent auth behavior across all current and future services
- Gateway auth logs all auth events (centralized audit trail)

---

## Future Microservices Routing

When Movientum splits into microservices, gateway routes to appropriate service:

```
Gateway routing rules (future):

/api/v1/auth/*          → auth-service:8001
/api/v1/movies/*        → movie-service:8002
/api/v1/search/*        → search-service:8003
/api/v1/recommendations → recommendation-service:8004
/api/v1/fedpcl/*        → fedpcl-service:8005
/api/v1/news/*          → news-service:8006
```

Each service isolated. Gateway is only component clients know about. Services can be deployed, scaled, or updated independently. Frontend code never changes — same API paths always.
