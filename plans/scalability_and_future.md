# Scalability and Future — Movientum

## Overview

Movientum starts lean. Single server, monolith backend, simple rules-based recommendations. Each scaling step triggered by real need — not premature optimization. This doc outlines when to scale, what to scale, and the full future feature roadmap.

---

## Scaling Principles

1. **Measure before scaling**: Add metrics first. Scale what's actually slow, not what might be slow.
2. **Cache first**: Most read performance problems solved with caching before scaling compute.
3. **Scale out, not just up**: Horizontal scaling (more instances) preferred over vertical (bigger server).
4. **Database is usually the bottleneck**: Protect DB with connection pooling, read replicas, caching.

---

## Current MVP Limits (Single Server)

Estimated single-server capacity:

| Metric | Estimate |
|--------|----------|
| Concurrent users | ~200–500 |
| Requests/second | ~100–200 RPS |
| DB connections | 50–100 via connection pool |
| Cache hit rate | ~80% (most movie data cached) |
| Storage | ~20GB for 100k movies + user data |

When concurrent users regularly exceed 300 or RPS exceeds 150 → begin scale-out.

---

## Scaling Layer 1: Caching Improvements

**Before adding servers, maximize cache effectiveness.**

### Current Caching
- Movie detail: 1hr TTL
- Trending: 30min TTL
- Search: 10min TTL
- User recommendations: 15min TTL

### Improvements

**Increase TTLs for stable data:**
- Genre list: cache forever (changes almost never)
- Popular movies (top 1000): cache 6 hours (very stable)
- Director profiles: cache 24 hours

**Pre-warm caches:**
- At server startup: pre-load top 500 movies into Redis
- On cron: rebuild trending cache before it expires
- On movie addition: immediately cache new movie

**Client-side caching:**
- Set `Cache-Control: public, max-age=3600` on movie detail API responses
- Browser caches response → no API call on revisit within 1 hour
- Reduces backend requests for non-personalized data

**Cache hit rate target**: 90%+ for movie browse, 95%+ for genre/trending.

---

## Scaling Layer 2: Backend Horizontal Scaling

When caching alone insufficient → add more FastAPI instances.

### Load Balancer Setup

```
Internet
  ↓
Load Balancer (Nginx or AWS ALB)
  ├── FastAPI Instance 1
  ├── FastAPI Instance 2
  ├── FastAPI Instance 3
  └── FastAPI Instance N (auto-scale)
```

**Load balancing algorithms:**
- Round robin: default, distribute evenly
- Least connections: send to least busy server
- IP hash: sticky sessions (needed if storing state per instance — but JWT is stateless so not needed)

FastAPI instances are **stateless** (all state in DB + Redis) → add/remove instances without coordination.

### Auto-Scaling Rules (Cloud)

Scale OUT when:
- CPU > 70% for 5 consecutive minutes
- Average response time > 1 second
- Request queue depth > 100

Scale IN when:
- CPU < 30% for 10 consecutive minutes

Use AWS Auto Scaling Groups or equivalent.

---

## Scaling Layer 3: Database Optimization

DB is typically last bottleneck (hard to scale, expensive to fix late).

### Connection Pooling

FastAPI does NOT maintain persistent DB connections per request (too many).
Use **PgBouncer** (connection pool middleware):
- Application connects to PgBouncer (fast)
- PgBouncer maintains small pool of real DB connections
- Multiplexes thousands of app connections over 50–100 DB connections
- DB sees manageable connection count

### Read Replicas

Read-heavy workload (most movie platforms are 90% reads):

```
Write (INSERT/UPDATE/DELETE) → Primary DB
Read (SELECT) → Read Replica 1 or 2
```

Application routes queries based on type. Read replicas lag primary by ~100ms (acceptable for recommendations, not for auth).

**What uses read replicas:**
- Movie browse, search, recommendations
- News feed
- Watch history display

**What stays on primary:**
- Auth operations (must be consistent)
- Rating submissions
- Watch history writes

### Partitioning (Future, Large Scale)

When movies table > 10 million rows or ratings table > 100 million rows:

**Horizontal Partitioning (Sharding)**:
- Partition ratings by user_id range (users 1–1M on shard 1, 1M–2M on shard 2)
- Partition watch_history by date range (2024 data on one partition, 2025 on another)

Most apps never need this. Only relevant at Netflix/Amazon scale.

---

## Scaling Layer 4: Redis Cluster

Single Redis → Redis Cluster when:
- Memory usage > 10GB
- Read/write throughput > 100k ops/sec

Redis Cluster:
- Multiple nodes
- Data sharded across nodes
- Replication for fault tolerance
- No single point of failure

Also consider **Redis Sentinel** (simpler — automatic failover without sharding).

---

## Microservices Migration Path

Monolith → microservices when team grows and services have conflicting scaling needs.

### Split Order (Business Value)

**Phase 1: Extract high-traffic / high-load services**

```
Monolith
  └── Extract: Recommendation Service
        → Owns: recommendation logic, ML models
        → Scales independently (GPU-heavy for ML inference)
        → API: internal gRPC calls
```

**Phase 2: Extract latency-sensitive services**

```
  └── Extract: Search Service
        → Add Elasticsearch for full-text search
        → Elasticsearch handles fuzzy, relevance, multilingual
        → PostgreSQL full-text no longer sufficient at scale
```

**Phase 3: Extract I/O-heavy services**

```
  └── Extract: News Service
        → Runs separate cron jobs
        → Has its own Redis instance
        → No impact on core movie browse if news API fails
```

**Phase 4: Remaining core**

```
  └── Core Monolith still handles: auth, movies, ratings, watch history
        → Split auth if compliance requires isolated identity service
        → Split movies if catalog management becomes its own team
```

### Service Communication

Internal service calls:
- **HTTP REST**: Simple, works everywhere, slight overhead
- **gRPC**: Faster, typed, good for high-frequency internal calls
- **Message Queue (Celery + RabbitMQ/Redis)**: For async, fire-and-forget events

Events to queue (not synchronous):
- "User rated movie" → recommendation service processes asynchronously
- "User registered" → send welcome email asynchronously
- "FedPCL round complete" → update serving model asynchronously

---

## CDN Integration

Static assets served via CDN from day 1 (or soon after):

```
Browser requests poster image
  ↓
CDN edge node (closest to user geographically)
  ├── Cache HIT → return image (< 10ms)
  └── Cache MISS → fetch from TMDB CDN, cache, return
```

CDN options: Cloudflare, AWS CloudFront, Fastly.

What goes through CDN:
- React build files (JS, CSS)
- Movie poster images (proxied from TMDB)
- Backdrop images
- Static assets (logo, icons)

Backend API responses NOT cached by CDN (personalized, dynamic) except:
- Public movie lists (trending, genre browsing) with short CDN TTL (5 min)

---

## Future ML Improvements

### Short Term (3–6 months)
- Collaborative filtering model (Phase 2 of recommendation system)
- Better genre affinity weighting
- Implicit feedback signals (page view time, trailer plays)

### Medium Term (6–12 months)
- FedPCL full integration (Phase 3)
- Multi-modal recommendations (use movie posters as visual features)
- Session-based recommendations (real-time: what you clicked in this session)

### Long Term (1+ year)
- Large Language Model integration: natural language queries ("find me a sad indie film from the 90s")
- Graph neural networks: model relationships between users, movies, actors, directors
- Cross-domain recommendations: if user shows interest in book, recommend its movie adaptation

---

## Real-Time Features (Future)

### WebSocket Integration

Events that benefit from real-time push (no polling):
- FedPCL training round status updates
- Live notification: "A new movie just released that matches your taste"
- Friend activity: "Your friend just rated Oppenheimer 9/10" (social feature future)
- Live ratings update on Movie Detail page

**Implementation**: FastAPI WebSocket support → persistent connection between browser and server → push updates without client polling.

### Live Trending

Update trending list in real-time as ratings/views come in:
- Event stream: each rating/watch event increments Redis counter
- Trending list = top movies by event count in rolling 24h window
- WebSocket pushes trending updates to connected Home page users every 30s

---

## Observability at Scale

### Distributed Tracing (Multiple Services)

When microservices added → need to trace request across services:
- Each request gets unique `trace_id`
- Every service logs with that trace_id
- Can reconstruct full request path: "request 123 took 5ms in auth, 80ms in recommendation, 3ms in movies"
- Tools: Jaeger, Zipkin, AWS X-Ray

### Metrics Pipeline

```
FastAPI (emits metrics)
  → Prometheus (scrapes and stores metrics)
  → Grafana (dashboards and alerts)
```

Key dashboards:
- Requests per second by endpoint
- P50, P95, P99 response times
- Cache hit rate (Redis)
- DB query time distribution
- ML model inference time
- FedPCL training round progress

### Log Aggregation

```
All services → Structured JSON logs
  → Fluentd / Filebeat (collector)
  → Elasticsearch (storage + indexing)
  → Kibana (search and dashboards)
```

Or use managed: Datadog, New Relic, Grafana Cloud.

---

## Disaster Recovery Plan

### Backup Strategy
- PostgreSQL: daily full backup, WAL streaming for point-in-time recovery
- Redis: RDB snapshots every hour (Redis data is cache = reconstructable, so less critical)
- User data: 30-day backup retention minimum

### Recovery Time Objectives
- Database failure: < 1 hour recovery (restore from backup + replay WAL)
- Cache failure: < 5 minutes (Redis restart, cache warms on demand)
- Backend crash: < 1 minute (process manager auto-restart, or load balancer routes to healthy instance)
- Full datacenter failure: < 4 hours (multi-region deployment, future goal)

### Chaos Engineering (Future)
Deliberately kill services in staging to validate recovery:
- Kill a FastAPI instance → verify load balancer routes around it
- Kill Redis → verify backend falls back to DB gracefully
- Slow DB queries → verify timeouts and fallbacks work
- TMDB API down → verify graceful degradation to cached data

---

## Cost Optimization

### Resource Efficiency
- Use **async FastAPI** endpoints → more requests per instance → fewer instances needed
- Connection pooling → fewer DB connections → smaller DB plan
- Aggressive caching → less DB load → cheaper DB
- CDN → offloads bandwidth from backend → cheaper server

### Cloud Cost Tiers

| Stage | Monthly Estimate | Setup |
|-------|----------------|-------|
| MVP | $30–80/mo | 1 VPS (Hetzner/DigitalOcean) |
| Growing | $150–400/mo | 2–3 backend instances + managed DB |
| Scale | $500–2000/mo | Auto-scaling + managed Redis + CDN |
| Large | $2000+/mo | Multi-region, dedicated ML infra |

Start small, scale as revenue grows.

---

## Stateless Backend Instances (Horizontal Scaling Deep Dive)

### Why FastAPI is Stateless (Critical Property)

Stateless = no request depends on information stored inside the server process.

Every request is self-contained:
- Auth state → in JWT token (comes with the request)
- User data → in PostgreSQL (shared across all instances)
- Cache state → in Redis (shared across all instances)
- ML model → loaded in-memory per instance (same model, all instances)

This means any backend instance can handle any request from any user. No routing stickiness needed.

### Multiple Backend Servers Architecture

```
Internet
  │ HTTPS
  ▼
┌─────────────────────────────────────────┐
│           LOAD BALANCER                  │
│      (Nginx / AWS ALB / Kong)           │
│                                         │
│  Algorithm: least_conn                  │
│  Health checks: GET /api/health every 5s│
│  Removes unhealthy instances from pool  │
└────────────┬──────────────┬────────────┘
             │              │
             ▼              ▼
┌─────────────────┐   ┌─────────────────┐
│  FastAPI        │   │  FastAPI        │
│  Instance 1     │   │  Instance 2     │
│  (4 workers)    │   │  (4 workers)    │
│  CPU: 4 vCPU    │   │  CPU: 4 vCPU    │
│  RAM: 4 GB      │   │  RAM: 4 GB      │
└────────┬────────┘   └────────┬────────┘
         │                     │
         └──────────┬──────────┘
                    │ (shared resources)
         ┌──────────┴──────────┐
         ▼                     ▼
┌─────────────────┐   ┌─────────────────┐
│   PostgreSQL    │   │     Redis       │
│  (Primary +     │   │  (Shared cache) │
│   Replicas)     │   │                 │
└─────────────────┘   └─────────────────┘
```

### What Each Instance Holds in Memory

Each FastAPI instance loads at startup:
- FedPCL model: E_global + E_clusters (~450 MB)
- Python application code
- SQLAlchemy connection pool (handles to DB, not data)
- Redis connection pool (handles to cache, not data)

All instances load IDENTICAL models. When new model deployed → all instances reload simultaneously (hot swap, see mlops.md).

### Auto-Scaling Logic (Cloud Setup)

```
Target: P95 response time < 500ms
        CPU utilization < 70%

Scale OUT trigger (add instance):
  ANY of:
  - CPU > 70% sustained 5 min
  - P95 latency > 800ms sustained 3 min
  - Request queue depth > 50 requests

Scale IN trigger (remove instance):
  ALL of:
  - CPU < 30% sustained 10 min
  - P95 latency < 200ms sustained 10 min
  - Minimum instances: 2 (never scale below 2 for HA)

Scaling limits:
  Min instances: 2
  Max instances: 10
  Scale-out cooldown: 2 minutes (don't add too fast)
  Scale-in cooldown: 10 minutes (don't remove too fast)
```

---

## Load Balancer — Detailed Design

### Request Distribution Logic

**Algorithm: Least Connections** (preferred over Round Robin for Movientum)

Why least connections over round robin:
- FedPCL model download requests are large (25+ MB)
- A backend handling a model download is busy longer
- Least connections routes new requests away from the busy instance
- Round robin would blindly send next request to the downloading instance

```
Load Balancer state:
  Instance 1: 45 active connections
  Instance 2: 12 active connections  ← new request goes here
  Instance 3: 38 active connections
```

**Health Checking:**
```
Every 5 seconds:
  GET http://instance_N:8000/api/health
  Expected: 200 OK
  Timeout: 2 seconds

Failure handling:
  2 consecutive failures → instance removed from pool
  Next successful check → instance re-added to pool
  Logs: every removal/addition event logged and alerted
```

**Connection Draining (Zero-Downtime Deployment):**
```
When instance is being updated/restarted:
  1. Mark instance as draining (no new connections sent to it)
  2. Wait for existing connections to complete (max 30s drain timeout)
  3. Terminate instance
  4. Start new instance with updated code
  5. Health check passes → add to pool
```

### Sticky vs Stateless Sessions

**Movientum uses stateless sessions** — no sticky sessions needed.

Sticky sessions = always route same user to same backend instance. Required when server stores session data in memory.

Movientum avoids this:
- JWT contains all auth state (no server-side session)
- User data in PostgreSQL (accessible from any instance)
- Cache in Redis (accessible from any instance)
- ML model same on all instances

Benefit: instance can crash and user's next request goes to any other instance seamlessly.

Only exception: FedPCL training round participation tracking (future) may need Redis-based coordination to prevent same user joining round from two different instances simultaneously.

---

## API Gateway — Extended Detail

*(Full details in api_gateway.md — this section covers integration with scaling)*

### API Gateway as Scaling Control Point

At scale, API Gateway (Kong) becomes the intelligence layer:

```
Kong Plugin Stack (per route):
  1. Rate Limiting Plugin
     → Store rate limit counters in Redis (shared across all Kong instances)
     → Rule: user X consumed 847/1000 requests this hour
  
  2. JWT Auth Plugin
     → Validate JWT before request hits backend
     → Failed auth = 401 from Kong (no backend load)
  
  3. Load Balancer (Kong Upstream)
     → Weighted round robin to backend instances
     → Health checks per instance
  
  4. Circuit Breaker Plugin
     → If backend error rate > 50% → open circuit → return 503
     → Prevents cascade failure
  
  5. Request Transformer Plugin
     → Inject X-Request-ID, X-User-ID headers
     → Strip Authorization header (backend trusts X-User-ID from gateway)
  
  6. Response Transformer Plugin
     → Add CORS headers
     → Add security headers
  
  7. Prometheus Plugin
     → Emit metrics per route per upstream
```

### Gateway Itself Must Scale

At high traffic, single Gateway instance becomes bottleneck. Scale it too:

```
DNS Load Balancing
  │
  ├── Kong Gateway Instance 1
  ├── Kong Gateway Instance 2
  └── Kong Gateway Instance 3
       │
       └── All share same Redis (for rate limit counters + config)
           All read same PostgreSQL (Kong config store)
```

Kong nodes are also stateless — configuration in DB, counters in Redis.

---

## Scaling Roadmap Summary

| Stage | Users | Scaling Action | Monthly Cost |
|-------|-------|---------------|-------------|
| MVP | < 1k | Single server, monolith, Nginx | $30–80 |
| Growth | 1k–10k | Add Redis, optimize caching | $80–150 |
| Scale 1 | 10k–50k | 2–3 backend instances, load balancer | $150–400 |
| Scale 2 | 50k–200k | Read replicas, PgBouncer, Redis Sentinel | $400–1000 |
| Scale 3 | 200k–1M | Kong gateway, microservices extraction, auto-scaling | $1000–3000 |
| Large | 1M+ | Multi-region, Kubernetes, dedicated ML cluster | $3000+ |
