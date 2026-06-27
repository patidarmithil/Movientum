# Grafana Observability Plan — Movientum v2.1
> Stack: FastAPI (Azure App Service) + React/Vite (Vercel) + Supabase (PostgreSQL) + Upstash (Redis) + Celery + XGBRanker + NetworkX Graph
>
> **Architecture: OpenTelemetry → Azure Application Insights → Azure Monitor → Grafana**
>
> PoC confirmed: `movientum_rwr_seconds`, `movientum_graph_node_count`, `movientum_graph_edge_count`, `movientum_retrain_rows_trained`, `movientum_retrain_best_iteration` all appear in `customMetrics` table.

---

## Implementation Status

| Phase | Scope | Status |
|---|---|---|
| **Phase 1** | Telemetry Pipeline (OTel → AppInsights → Azure Monitor) | ✅ Completed |
| **Phase 2** | Grafana Datasource Setup (Azure Managed Grafana + Grafana Cloud) | ✅ Completed |
| **Phase 3** | Dashboard Implementation (Dashboards A–G) | ⏳ Pending |
| **Phase 4** | Alerts & Production Hardening | ⏳ Pending |

| Component | Status |
| -------------------------------- | ----------- |
| OpenTelemetry instrumentation | ✅ Completed |
| Application Insights | ✅ Completed |
| Azure Monitor | ✅ Completed |
| Azure Managed Grafana datasource | ✅ Completed |
| Grafana Cloud datasource | ✅ Completed |
| Custom metrics validation | ✅ Completed |
| Dashboard implementation | ⏳ Pending |
| Alert implementation | ⏳ Pending |
| PostgreSQL business dashboards | ⏳ Pending |

---

## Deployment Architecture

```
                Backend
                   │
           OpenTelemetry SDK
                   │
                   ▼
      Azure Application Insights
                   │
           Azure Monitor Logs
                   │
  ┌────────────────┴────────────────┐
  │                                 │
  ▼                                 ▼
Azure Managed Grafana          Grafana Cloud
  │                                 │
  └────────────Same Dashboards──────┘
```

Both Grafana instances read the exact same Azure Monitor data. Only one telemetry pipeline exists.

---

---

# Phase 1 — Telemetry Pipeline

> **Status: ✅ Completed**
>
> Scope: Instrument the FastAPI backend with OpenTelemetry, push metrics to Azure Application Insights, confirm they appear in Azure Monitor.

## Architecture

```
[ Vercel Frontend — React/Vite ]
         │  (user actions → API calls)
         ▼
[ Azure App Service — FastAPI ]
   ├── app/telemetry.py  ← OTel SDK, all 17 metric instruments
   ├── OTel Histogram, Counter, Observable Gauge instruments
   └── Celery Workers (retrain, sync, fetch, check)
         │
         │  (HTTPS push — no scraping, no agent)
         ▼
[ Azure Application Insights ]
   ├── customMetrics table    ← all 17 custom metrics land here
   ├── requests table         ← HTTP request traces (auto-instrumented)
   ├── exceptions table       ← unhandled errors (auto-instrumented)
   └── performanceCounters    ← CPU/memory (auto-instrumented on App Service)
         │
         ▼
[ Azure Monitor ]
   ├── Log Analytics workspace  ← KQL query engine
   ├── Metrics Explorer         ← point-in-time metric charts
   └── Alert Rules              ← threshold alerts on any KQL query
```

**Why this works without scraping:** `configure_azure_monitor()` installs an OTel periodic exporter. Every 60 seconds it flushes all metric instruments to the AppInsights endpoint. No pull model. No port exposure. Works behind Azure App Service NAT.

## 1.1 — telemetry.py Setup

`app/telemetry.py` is complete and correct. No changes needed for v2 architecture.

**Confirmed working:**
- `configure_azure_monitor(connection_string=...)` initialises OTel exporter
- All 17 metric instruments created in `_init_instruments()`
- Observable Gauges use callbacks with module-level state (`_graph_node_count` etc.)
- Called via `init_telemetry()` at app startup

**Environment variable required:**
```
APPLICATIONINSIGHTS_CONNECTION_STRING=InstrumentationKey=...;IngestionEndpoint=...
```
Set in Azure App Service → Configuration → Application Settings.

## 1.2 — All 17 Metrics — Audit Table

### OTel → AppInsights Type Mapping

| OTel Instrument | AppInsights `customMetrics` | KQL field |
|---|---|---|
| `create_histogram()` | Aggregated per export interval | `name`, `value` (mean), `valueMin`, `valueMax`, `valueCount`, `valueStdDev` |
| `create_counter()` | Cumulative sum per interval | `name`, `value` (sum over interval) |
| `create_observable_gauge()` | Last observed value | `name`, `value` (latest) |

**Note on histograms:** AppInsights does not store bucket arrays. It stores pre-aggregated statistics (min, max, mean, stddev, count) per 60s window. For P95/P99 approximation, use `percentile()` KQL function over multiple windows.

### Metric Audit

| ID | `telemetry.py` Name | OTel Type | AppInsights `name` | Keep / Change | Reason |
|---|---|---|---|---|---|
| A | `recommendation_latency` | Histogram | `movientum_rwr_seconds` | ✅ Keep as Histogram | P95 latency = most important ML metric |
| B | `xgb_inference_latency` | Histogram | `movientum_xgb_inference_seconds` | ✅ Keep as Histogram | Critical for ranking pipeline perf |
| C | `feature_matrix_latency` | Histogram | `movientum_feature_matrix_build_seconds` | ✅ Keep as Histogram | N×16 matrix build is expensive |
| D | `xgb_coldstart` | Counter | `movientum_xgb_coldstart_total` | ✅ Keep as Counter | Drops to 0 once ≥100 training rows |
| E | `ml_pipeline_calls` | Counter | `movientum_ml_pipeline_calls_total` | ✅ Keep as Counter | Labels: `ok` / `error` / `no_candidates` |
| F1 | Observable Gauge | Observable Gauge | `movientum_graph_node_count` | ✅ Keep as Observable Gauge | Steady growth = healthy ingestion |
| F2 | Observable Gauge | Observable Gauge | `movientum_graph_edge_count` | ✅ Keep as Observable Gauge | Edge/node ratio = graph density |
| G | `retrain_status` | Counter | `movientum_retrain_total` | ✅ Keep as Counter | Labels: `ok` / `skipped` / `error` |
| H | Observable Gauge | Observable Gauge | `movientum_retrain_rows_trained` | ✅ Keep as Observable Gauge | Training data size trend |
| I | Observable Gauge | Observable Gauge | `movientum_retrain_best_iteration` | ✅ Keep as Observable Gauge | Low = overfitting, high = underfitting |
| J | `retrain_duration` | Histogram | `movientum_retrain_duration_seconds` | ✅ Keep as Histogram | Alert if >30min = data problem |
| K | `cache_ops` | Counter | `movientum_cache_operations_total` | ✅ Keep as Counter | Labels: `op`, `key_type` |
| L | `feedback_signals` | Counter | `movientum_feedback_signals_total` | ✅ Keep as Counter | Labels: `signal_type` |
| M | `taste_profile_update` | Histogram | `movientum_taste_profile_update_seconds` | ✅ Keep as Histogram | Supabase write latency per signal |
| N | `interaction_log_inserts` | Counter | `movientum_interaction_log_inserts_total` | ✅ Keep as Counter | XGBRanker training data accumulation |
| O1 | `celery_task_duration` | Histogram | `movientum_celery_task_duration_seconds` | ✅ Keep as Histogram | Labels: `task_name` |
| O2 | `celery_task_status` | Counter | `movientum_celery_task_total` | ✅ Keep as Counter | Labels: `task_name`, `status` |

**All 17 metrics: no changes needed.** `telemetry.py` already correct.

### Additional ML Metrics (Recommended Additions)

| Metric Name | OTel Type | Why |
|---|---|---|
| `movientum_recommendation_candidate_count` | Histogram | How many candidates enter XGB ranking. Too few = sparse graph. |
| `movientum_recommendation_confidence` | Histogram | Mean PPR score of top-N result. Low confidence = cold graph. |
| `movientum_graph_rebuild_duration_seconds` | Histogram | `get_or_build_graph()` cold build time. |
| `movientum_graph_cache_hits_total` | Counter | Graph served from cache vs. rebuilt. |
| `movientum_model_version` | Observable Gauge | Integer version counter — increments each successful retrain. |
| `movientum_dataset_size_total` | Observable Gauge | Total rows in `interaction_log`. Distinct from rows_trained (last 30d). |

Add these to `telemetry.py` `_init_instruments()` when ready to instrument.

## 1.3 — Storage Strategy

**AppInsights is the permanent store.** Do not export to any external store.

| Data | Table | Default Retention | Extended Retention |
|---|---|---|---|
| Custom metrics | `customMetrics` | 90 days (free) | Up to 2 years ($0.12/GB/month) |
| HTTP traces | `requests` | 90 days (free) | Same |
| Errors | `exceptions` | 90 days (free) | Same |
| Infrastructure | `performanceCounters` | 90 days (free) | Same |

90-day free retention covers: all retrain history, latency trends, signal pipeline audit. Sufficient for production ML observability.

## 1.4 — Phase 1 Verification

**Step 1 — Confirm metrics reach AppInsights**

Azure Portal → Application Insights → Logs → Run:

```kql
customMetrics
| where timestamp > ago(1h)
| where name startswith "movientum_"
| summarize count() by name
```

Expected: all 17 metric names appear.

**Step 2 — Confirm HTTP traces**

```kql
requests
| where timestamp > ago(1h)
| summarize count() by name
```

Expected: FastAPI routes appear.

## 1.5 — Proof of Concept Validation

### OpenTelemetry
✅ Successfully exported custom metrics.

### Application Insights

Verified custom metrics:
- `movientum_rwr_seconds`
- `movientum_graph_node_count`
- `movientum_graph_edge_count`
- `movientum_retrain_rows_trained`
- `movientum_retrain_best_iteration`

Metrics successfully stored in: `customMetrics`

### Azure Monitor

Verified that custom metrics become available inside Azure Monitor Metrics.

Successfully visualized: `movientum_rwr_seconds`

---

---

# Phase 2 — Grafana Datasource Setup

> **Status: ✅ Completed**
>
> Scope: Create both Grafana instances and connect them to Azure Monitor and PostgreSQL (Supabase). No dashboards or alerts yet — just working datasource connections.

## Grafana Option Comparison

| Feature | Azure Dashboards | Azure Managed Grafana | Grafana Cloud (Free) |
|---|---|---|---|
| **Azure Monitor datasource** | Native | Native, pre-configured | Manual setup (App Registration needed) |
| **PostgreSQL datasource** | ❌ No | ✅ Yes (plugin) | ✅ Yes (plugin) |
| **KQL query editor** | Azure Metrics Explorer only | Full Grafana KQL | Full Grafana KQL |
| **Alert rules** | Azure Monitor Alerts only | Grafana alerting + Azure | Grafana alerting |
| **Dashboard persistence** | Azure portal only | Persistent, JSON export | Persistent, JSON export |
| **Free tier** | Included in Azure free | 1 instance free (Essential) | 10k series, 50GB logs |
| **Cost (paid)** | Included in Log Analytics | ~$65/month Standard | ~$29/month |
| **Self-serve setup time** | Low | Medium (ARM template) | Medium (App Registration) |
| **Recommended** | ❌ Limited | ✅ **Best for Azure** | ✅ Valid alternative |

### Deployment Strategy

#### Primary Deployment: Azure Managed Grafana

Purpose:
- Native Azure integration
- Azure Monitor + Application Insights
- Production monitoring
- Infrastructure monitoring
- Internal operational dashboards

Use Azure Managed Grafana as the production dashboard because it integrates directly with Azure services.

#### Secondary Deployment: Grafana Cloud

Purpose:
- Same Azure Monitor datasource
- Same Application Insights
- Same PostgreSQL datasource
- Same dashboards
- Same alert rules

Grafana Cloud is configured by connecting to Azure Monitor using:
- Microsoft Entra App Registration
- Client Secret
- Reader Role
- Monitoring Reader Role

This is the exact same configuration that has already been successfully validated. No separate telemetry pipeline exists.

#### Recommended: Use Both Simultaneously

**Azure Managed Grafana** → Azure-native monitoring, infrastructure, production operations

**Grafana Cloud** → Rich dashboard design, dashboard sharing, public demonstrations, experimentation, backup dashboard environment

Both dashboards read from the same Azure Monitor datasource:
- no duplicate telemetry
- no duplicate storage
- no additional instrumentation
- no additional backend load

The backend exports telemetry once. Azure stores it once. Both Grafana environments simply query Azure Monitor.

## 2.1 — Option A: Azure Managed Grafana Setup

### Step 1 — Create Azure Managed Grafana

```
Azure Portal → Create Resource → "Azure Managed Grafana"
  Pricing tier: Essential (Free)
  Region: same as App Service
  Enable Azure Monitor integration: Yes (checked by default)
```

**Why Essential tier:** Includes Azure Monitor data source, unlimited dashboards, alert rules. No metric series cap. Paid Standard tier adds SAML SSO, reporting — not needed.

### Step 2 — Add PostgreSQL data source (Supabase)

Grafana → **Connections → Data Sources → Add → PostgreSQL**

| Field | Value |
|---|---|
| Host | `db.<your-project-ref>.supabase.co:5432` |
| Database | `postgres` |
| User | `grafana_reader` |
| Password | (see Step 3) |
| SSL Mode | `require` |

### Step 3 — Create read-only Supabase role

Run in Supabase SQL Editor (Dashboard → SQL Editor → New Query):

```sql
CREATE ROLE grafana_reader WITH LOGIN PASSWORD 'REPLACE_WITH_YOUR_PASSWORD';
GRANT CONNECT ON DATABASE postgres TO grafana_reader;
GRANT USAGE ON SCHEMA public TO grafana_reader;
GRANT SELECT ON ALL TABLES IN SCHEMA public TO grafana_reader;
ALTER DEFAULT PRIVILEGES IN SCHEMA public
  GRANT SELECT ON TABLES TO grafana_reader;
```

**Why read-only:** Grafana only needs SELECT. Write-capable role = security risk if API key leaks.

## 2.2 — Option B: Grafana Cloud Setup

### Step 1 — Create Grafana Cloud account

grafana.com → Sign up → Free tier (10k series, 50GB logs)

### Step 2 — Add Azure Monitor datasource

Grafana Cloud → Connections → Data Sources → Add → Azure Monitor

| Field | Value |
|---|---|
| Authentication | App Registration |
| Directory (Tenant) ID | Azure AD → App registrations → your app → Overview |
| Application (Client) ID | same location |
| Client Secret | Azure AD → App registrations → Certificates & secrets |
| Default Subscription | your Azure subscription ID |

**Required Azure roles on the App Registration:**
- Reader
- Monitoring Reader

This configuration has already been successfully tested and validated.

### Step 3 — Add PostgreSQL datasource (Supabase)

Same as Option A Step 2–3. Same `grafana_reader` role.

## 2.3 — Phase 2 Verification

**Confirm Grafana → Azure Monitor connection**

Grafana → Explore → Data source: Azure Monitor → Log Analytics → run:

```kql
customMetrics
| where timestamp > ago(1h)
| where name startswith "movientum_"
| summarize count() by name
```

Expected: same results as Azure Portal.

**Confirm PostgreSQL connection**

Grafana → Explore → Data source: PostgreSQL → run:
```sql
SELECT COUNT(*) FROM interaction_log;
```
Expected: row count returned.

### Grafana Cloud — PoC Validation

Successfully connected using:
- Azure App Registration
- Client Secret
- Reader role
- Monitoring Reader role

Successfully queried Azure Monitor. Successfully visualized: `movientum_rwr_seconds`

---

---

# Phase 3 — Dashboard Implementation

> **Status: ⏳ Pending**
>
> Scope: Build all 7 dashboards (A–G) in Grafana using the KQL and SQL queries below. Implement in both Grafana instances using the same JSON definitions.

**Dashboard auto-load:** Grafana time picker on dashboards defaults to last 24h. Set global `$__timeFilter` to 90 days on retrain/graph dashboards. Metrics load automatically from AppInsights — no manual KQL reruns.

## Dashboard Overview

| Dashboard | Focus | Data Source |
|---|---|---|
| **A** | API Health | Azure Monitor (requests table) |
| **B** | Recommendation System | Azure Monitor (customMetrics) |
| **C** | Graph Analytics | Azure Monitor (customMetrics) |
| **D** | Retraining | Azure Monitor (customMetrics) |
| **E** | User Behaviour | Azure Monitor + PostgreSQL |
| **F** | Infrastructure | Azure Monitor (performanceCounters) |
| **G** | Business KPIs | PostgreSQL + Azure Monitor |

## Steps

Grafana → **Dashboards → New → New Dashboard → Add panel**

For each panel: select data source → paste KQL or SQL from sections below → set chart type → save.

Save dashboards as JSON (Export → Save to file) for version control.

---

## 3.1 — Dashboard A: API Health

AppInsights `customMetrics` schema:

```kql
customMetrics
| where name == "movientum_rwr_seconds"
| project timestamp, name, value, valueMin, valueMax, valueCount, valueStdDev
```

**Request count per endpoint (30m bins):**
```kql
requests
| where timestamp > ago(24h)
| summarize count() by bin(timestamp, 30m), name
| render timechart
```

**Request duration P95 (30m bins):**
```kql
requests
| where timestamp > ago(24h)
| summarize percentile(duration, 95) by bin(timestamp, 30m)
| render timechart
```

**HTTP error rate (5xx per minute):**
```kql
requests
| where timestamp > ago(24h)
| summarize
    total = count(),
    errors = countif(resultCode startswith "5")
  by bin(timestamp, 1m)
| extend error_rate = todouble(errors) / todouble(total)
| render timechart
```

**Status code breakdown:**
```kql
requests
| where timestamp > ago(24h)
| summarize count() by resultCode
| render piechart
```

**Throughput (req/min):**
```kql
requests
| where timestamp > ago(24h)
| summarize count() by bin(timestamp, 1m)
| render timechart
```

**Endpoint latency heatmap:**
```kql
requests
| where timestamp > ago(6h)
| summarize avg_duration = avg(duration) by name
| order by avg_duration desc
| render barchart
```

---

## 3.2 — Dashboard B: Recommendation System

**RWR latency (mean per 5m window):**
```kql
customMetrics
| where timestamp > ago(24h)
| where name == "movientum_rwr_seconds"
| summarize avg(value), max(value) by bin(timestamp, 5m)
| render timechart
```

**RWR latency P95 approximation (percentile over 5m samples):**
```kql
customMetrics
| where timestamp > ago(24h)
| where name == "movientum_rwr_seconds"
| summarize percentile(value, 95) by bin(timestamp, 30m)
| render timechart
```

**Feature matrix build latency:**
```kql
customMetrics
| where timestamp > ago(24h)
| where name == "movientum_feature_matrix_build_seconds"
| summarize avg(value), max(value) by bin(timestamp, 5m)
| render timechart
```

**XGB inference latency:**
```kql
customMetrics
| where timestamp > ago(24h)
| where name == "movientum_xgb_inference_seconds"
| summarize avg(value), max(value) by bin(timestamp, 5m)
| render timechart
```

**ML pipeline call outcomes (rate per hour):**
```kql
customMetrics
| where timestamp > ago(7d)
| where name == "movientum_ml_pipeline_calls_total"
| extend status = tostring(customDimensions["status"])
| summarize sum(value) by bin(timestamp, 1h), status
| render timechart
```

**Cold start count (cumulative daily):**
```kql
customMetrics
| where timestamp > ago(30d)
| where name == "movientum_xgb_coldstart_total"
| summarize sum(value) by bin(timestamp, 1d)
| render barchart
```

**Cache hit ratio by key type:**
```kql
let hits = customMetrics
| where timestamp > ago(24h)
| where name == "movientum_cache_operations_total"
| extend op = tostring(customDimensions["op"]), kt = tostring(customDimensions["key_type"])
| where op == "hit"
| summarize hits = sum(value) by bin(timestamp, 5m), kt;
let total = customMetrics
| where timestamp > ago(24h)
| where name == "movientum_cache_operations_total"
| extend op = tostring(customDimensions["op"]), kt = tostring(customDimensions["key_type"])
| where op in ("hit", "miss")
| summarize total = sum(value) by bin(timestamp, 5m), kt;
hits
| join kind=leftouter total on timestamp, kt
| extend ratio = hits / (total + 0.001)
| project timestamp, kt, ratio
| render timechart
```

**Cache miss spike (raw miss count per 5m):**
```kql
customMetrics
| where timestamp > ago(24h)
| where name == "movientum_cache_operations_total"
| extend op = tostring(customDimensions["op"])
| where op == "miss"
| summarize sum(value) by bin(timestamp, 5m)
| render timechart
```

---

## 3.3 — Dashboard C: Graph Analytics

**Graph node count (last 7d trend):**
```kql
customMetrics
| where timestamp > ago(7d)
| where name == "movientum_graph_node_count"
| summarize avg(value) by bin(timestamp, 1h)
| render timechart
```

**Graph edge count (last 7d trend):**
```kql
customMetrics
| where timestamp > ago(7d)
| where name == "movientum_graph_edge_count"
| summarize avg(value) by bin(timestamp, 1h)
| render timechart
```

**Graph edge/node density ratio:**
```kql
let nodes = customMetrics
| where timestamp > ago(7d)
| where name == "movientum_graph_node_count"
| summarize nodes = avg(value) by bin(timestamp, 1h);
let edges = customMetrics
| where timestamp > ago(7d)
| where name == "movientum_graph_edge_count"
| summarize edges = avg(value) by bin(timestamp, 1h);
nodes
| join kind=inner edges on timestamp
| extend density = edges / (nodes + 1.0)
| project timestamp, density
| render timechart
```

**Latest graph size (stat panel):**
```kql
customMetrics
| where name in ("movientum_graph_node_count", "movientum_graph_edge_count")
| summarize arg_max(timestamp, value) by name
| project name, value
```

---

## 3.4 — Dashboard D: Retraining

**Retrain outcomes (daily):**
```kql
customMetrics
| where timestamp > ago(90d)
| where name == "movientum_retrain_total"
| extend status = tostring(customDimensions["status"])
| summarize sum(value) by bin(timestamp, 1d), status
| render barchart
```

**Retrain rows trained (trend):**
```kql
customMetrics
| where timestamp > ago(90d)
| where name == "movientum_retrain_rows_trained"
| summarize avg(value) by bin(timestamp, 1d)
| render timechart
```

**Best iteration trend (XGBRanker early stopping):**
```kql
customMetrics
| where timestamp > ago(90d)
| where name == "movientum_retrain_best_iteration"
| summarize avg(value) by bin(timestamp, 1d)
| render timechart
```

**Retrain duration (mean per run):**
```kql
customMetrics
| where timestamp > ago(90d)
| where name == "movientum_retrain_duration_seconds"
| summarize avg(value), max(value) by bin(timestamp, 1d)
| render timechart
```

**Celery task outcomes:**
```kql
customMetrics
| where timestamp > ago(30d)
| where name == "movientum_celery_task_total"
| extend task = tostring(customDimensions["task_name"]), status = tostring(customDimensions["status"])
| summarize sum(value) by bin(timestamp, 1d), task, status
| render barchart
```

**Celery task duration P95:**
```kql
customMetrics
| where timestamp > ago(7d)
| where name == "movientum_celery_task_duration_seconds"
| extend task = tostring(customDimensions["task_name"])
| summarize percentile(value, 95) by bin(timestamp, 1h), task
| render timechart
```

---

## 3.5 — Dashboard E: User Behaviour

**Feedback signal rate (per hour by signal type):**
```kql
customMetrics
| where timestamp > ago(7d)
| where name == "movientum_feedback_signals_total"
| extend signal = tostring(customDimensions["signal_type"])
| summarize sum(value) by bin(timestamp, 1h), signal
| render timechart
```

**Taste profile update latency:**
```kql
customMetrics
| where timestamp > ago(24h)
| where name == "movientum_taste_profile_update_seconds"
| summarize avg(value), max(value) by bin(timestamp, 5m)
| render timechart
```

**interaction_log insert rate (hourly):**
```kql
customMetrics
| where timestamp > ago(30d)
| where name == "movientum_interaction_log_inserts_total"
| summarize sum(value) by bin(timestamp, 1h)
| render timechart
```

**Supabase SQL panels** (PostgreSQL data source):

Rating distribution:
```sql
SELECT
  CASE
    WHEN score <= 4  THEN 'Skip'
    WHEN score <= 6  THEN 'Timepass'
    WHEN score <= 8  THEN 'Go For It'
    ELSE                  'Perfection'
  END AS category,
  COUNT(*) AS count
FROM ratings
GROUP BY category
ORDER BY count DESC;
```

Interaction log volume + signal quality over time:
```sql
SELECT
  date_trunc('hour', timestamp) AS time,
  COUNT(*) AS total_events,
  SUM(CASE WHEN label >= 3 THEN 1 ELSE 0 END) AS positive_events
FROM interaction_log
WHERE $__timeFilter(timestamp)
GROUP BY time
ORDER BY time;
```

Cold start user count:
```sql
SELECT COUNT(*) AS cold_start_users
FROM users u
LEFT JOIN user_taste_profiles utp ON utp.user_id = u.id
WHERE utp.user_id IS NULL OR utp.total_interactions = 0;
```

Watchlist → watch conversion rate:
```sql
SELECT
  COUNT(DISTINCT wl.user_id)  AS users_with_watchlist,
  COUNT(DISTINCT wh.user_id)  AS users_who_watched,
  ROUND(
    100.0 * COUNT(DISTINCT wh.user_id)
    / NULLIF(COUNT(DISTINCT wl.user_id), 0), 2
  ) AS conversion_pct
FROM watchlists wl
LEFT JOIN watch_history wh
  ON  wh.user_id  = wl.user_id
  AND wh.movie_id IN (
    SELECT movie_id FROM watchlist_items WHERE watchlist_id = wl.id
  );
```

Top watched + top rated:
```sql
SELECT
  m.title,
  COUNT(wh.id)                    AS watch_count,
  ROUND(AVG(r.score)::numeric, 2) AS avg_rating
FROM movies m
LEFT JOIN watch_history wh ON wh.movie_id = m.id
LEFT JOIN ratings r        ON r.movie_id  = m.id
GROUP BY m.title
ORDER BY watch_count DESC
LIMIT 20;
```

---

## 3.6 — Dashboard F: Infrastructure

**CPU (Azure App Service — from `performanceCounters`):**
```kql
performanceCounters
| where timestamp > ago(24h)
| where name == "% Processor Time"
| summarize avg(value) by bin(timestamp, 5m)
| render timechart
```

**Memory (available MB):**
```kql
performanceCounters
| where timestamp > ago(24h)
| where name == "Available Bytes"
| summarize avg(value) / 1048576 by bin(timestamp, 5m)
| render timechart
```

**HTTP request volume:**
```kql
requests
| where timestamp > ago(24h)
| summarize count() by bin(timestamp, 5m)
| render timechart
```

**Availability (success rate %):**
```kql
requests
| where timestamp > ago(24h)
| summarize
    total = count(),
    success = countif(success == true)
  by bin(timestamp, 5m)
| extend availability = 100.0 * success / total
| render timechart
```

**Failed requests count:**
```kql
requests
| where timestamp > ago(24h)
| where success == false
| summarize count() by bin(timestamp, 5m)
| render timechart
```

**Exceptions rate:**
```kql
exceptions
| where timestamp > ago(24h)
| summarize count() by bin(timestamp, 5m)
| render timechart
```

---

## 3.7 — Dashboard G: Business KPIs

Technical dashboards (A–F) measure system health. Dashboard G measures recommendation quality and user engagement — the product-level outcomes that determine whether Movientum is delivering value.

#### Recommendations Served

Track the number of recommendations generated over time.

**Source:** custom metric if available; otherwise `requests` table filtered to recommendation endpoint.

```kql
requests
| where timestamp > ago(7d)
| where name contains "/recommendations"
| summarize count() by bin(timestamp, 1h)
| render timechart
```

**Visualization:** Time series

---

#### Daily Active Users

Display unique active users per day.

**Data source:** PostgreSQL (Supabase)

```sql
SELECT
  date_trunc('day', timestamp) AS day,
  COUNT(DISTINCT user_id) AS daily_active_users
FROM interaction_log
WHERE $__timeFilter(timestamp)
GROUP BY day
ORDER BY day;
```

**Visualization:** Time series

---

#### Watchlist Additions

Track number of movies added to watchlists.

**Data source:** PostgreSQL (Supabase)

```sql
SELECT
  date_trunc('day', created_at) AS day,
  COUNT(*) AS watchlist_additions
FROM watchlist_items
WHERE $__timeFilter(created_at)
GROUP BY day
ORDER BY day;
```

**Visualization:** Bar chart

---

#### Movies Watched

Track completed watches over time.

**Data source:** PostgreSQL (Supabase)

```sql
SELECT
  date_trunc('day', watched_at) AS day,
  COUNT(*) AS movies_watched
FROM watch_history
WHERE $__timeFilter(watched_at)
GROUP BY day
ORDER BY day;
```

**Visualization:** Time series

---

#### Average Recommendation Latency

Reuse `movientum_rwr_seconds` from Azure Monitor.

```kql
customMetrics
| where timestamp > ago(24h)
| where name == "movientum_rwr_seconds"
| summarize avg(value) by bin(timestamp, 1h)
| render timechart
```

**Visualization:** Stat + trend

---

#### Recommendation Confidence

If the metric `movientum_recommendation_confidence` exists in future versions, display it here.

> **Reserved for future implementation.**

---

#### Cache Hit Rate

Reuse the existing cache hit ratio KQL (see Dashboard B — Cache hit ratio by key type).

**Visualization:** Gauge

---

#### Recommendation Funnel

Display the end-to-end recommendation conversion funnel using PostgreSQL queries.

```sql
SELECT 'Recommendations Generated' AS stage, COUNT(*) AS count
FROM interaction_log WHERE signal_type = 'impression'
  AND $__timeFilter(timestamp)
UNION ALL
SELECT 'Recommendations Clicked', COUNT(*)
FROM interaction_log WHERE signal_type = 'click'
  AND $__timeFilter(timestamp)
UNION ALL
SELECT 'Watchlist Additions', COUNT(*)
FROM watchlist_items WHERE $__timeFilter(created_at)
UNION ALL
SELECT 'Movies Watched', COUNT(*)
FROM watch_history WHERE $__timeFilter(watched_at)
ORDER BY count DESC;
```

**Funnel stages:**
```
Recommendations generated
        ↓
Recommendations clicked
        ↓
Watchlist additions
        ↓
Movies watched
```

**Visualization:** Bar chart (funnel layout)

---

This dashboard demonstrates product adoption and recommendation effectiveness, complementing the technical observability dashboards (A–F). Together they provide a complete view: system health → ML pipeline health → user behaviour → business outcomes.

---

---

# Phase 4 — Alerts & Production Hardening

> **Status: ⏳ Pending**
>
> Scope: Configure all 11 alert rules, set up contact points (email, Slack, Discord), apply documentation maintenance rules.

## 4.1 — Alert Rules

Create in **Azure Monitor → Alerts → Create → Alert Rule**. Or in Grafana Alerting if using Managed Grafana.

| # | Alert Name | KQL Condition | Threshold | Evaluation | Severity |
|---|---|---|---|---|---|
| 1 | ML Pipeline Error Spike | `customMetrics \| where name == "movientum_ml_pipeline_calls_total" \| extend status = customDimensions["status"] \| where status == "error" \| summarize sum(value)` | > 5 per 5m | Every 5m | Critical |
| 2 | RWR Latency High | `customMetrics \| where name == "movientum_rwr_seconds" \| summarize max(value)` | > 2.0s | Every 5m | Warning |
| 3 | Cold Start Active | `customMetrics \| where name == "movientum_xgb_coldstart_total" \| summarize sum(value)` | > 0 in 15m | Every 15m | Warning |
| 4 | Retrain Skipped | `customMetrics \| where name == "movientum_retrain_total" \| extend s = customDimensions["status"] \| where s == "skipped" \| summarize sum(value)` | > 0 in 24h | Every 1h | Info |
| 5 | Retrain Failed | `customMetrics \| where name == "movientum_retrain_total" \| extend s = customDimensions["status"] \| where s == "error" \| summarize sum(value)` | > 0 in 24h | Every 1h | Critical |
| 6 | Cache Hit Rate Drop | Cache hit ratio query (see Dashboard B) | < 0.70 for 10m | Every 5m | Warning |
| 7 | Cache Miss Spike | `customMetrics \| where name == "movientum_cache_operations_total" \| extend op = customDimensions["op"] \| where op == "miss" \| summarize sum(value)` | > 50 per 5m | Every 5m | Warning |
| 8 | Thumbs-Down Spike | `customMetrics \| where name == "movientum_feedback_signals_total" \| extend s = customDimensions["signal_type"] \| where s == "thumbs_down" \| summarize sum(value)` | > 5 per 10m | Every 5m | Warning |
| 9 | API 5xx Rate | `requests \| where resultCode startswith "5" \| summarize count()` | > 10 per 5m | Every 5m | Critical |
| 10 | CPU High | `performanceCounters \| where name == "% Processor Time" \| summarize avg(value)` | > 80% for 10m | Every 5m | Warning |
| 11 | Memory Low | `performanceCounters \| where name == "Available Bytes" \| summarize avg(value) / 1048576` | < 200 MB | Every 5m | Warning |

## 4.2 — Contact Points

**Alert action group:** Azure Monitor → Alerts → Action Groups → New
- Add email action (free)
- Add webhook action for Slack/Discord

Grafana → **Alerting → Alert Rules → New Alert Rule**

Paste KQL from the Alert Rules table above. Set threshold, evaluation interval, contact point.

**Contact point (email — free):**
```
Grafana → Alerting → Contact Points → New → Type: Email
  Addresses: your@email.com
```

**Contact point (Slack):**
```
Grafana → Alerting → Contact Points → New → Type: Slack
  Webhook URL: https://hooks.slack.com/services/...
```

**Contact point (Discord):**
```
Discord channel → Edit Channel → Integrations → Webhooks → New Webhook → Copy URL
Append /slack to the URL
Grafana → Alerting → Contact Points → New → Type: Slack → paste <discord_webhook>/slack
```

## 4.3 — Documentation Maintenance

Future telemetry metrics must:
- be added to `telemetry.py`
- be documented in the metric reference table
- have corresponding dashboard panels
- have KQL queries where applicable

Deprecated metrics must be removed from:
- `telemetry.py`
- dashboard definitions
- metric reference table
- alert rules

Keep documentation synchronized with implementation.

---

---

# Reference

## All 17 Metrics in telemetry.py

| Python Variable | AppInsights `name` | OTel Type | Labels / Dimensions |
|---|---|---|---|
| `recommendation_latency` | `movientum_rwr_seconds` | Histogram | — |
| `xgb_inference_latency` | `movientum_xgb_inference_seconds` | Histogram | — |
| `feature_matrix_latency` | `movientum_feature_matrix_build_seconds` | Histogram | — |
| `xgb_coldstart` | `movientum_xgb_coldstart_total` | Counter | — |
| `ml_pipeline_calls` | `movientum_ml_pipeline_calls_total` | Counter | `status` |
| Observable Gauge | `movientum_graph_node_count` | Observable Gauge | — |
| Observable Gauge | `movientum_graph_edge_count` | Observable Gauge | — |
| `retrain_status` | `movientum_retrain_total` | Counter | `status` |
| Observable Gauge | `movientum_retrain_rows_trained` | Observable Gauge | — |
| Observable Gauge | `movientum_retrain_best_iteration` | Observable Gauge | — |
| `retrain_duration` | `movientum_retrain_duration_seconds` | Histogram | — |
| `cache_ops` | `movientum_cache_operations_total` | Counter | `op`, `key_type` |
| `feedback_signals` | `movientum_feedback_signals_total` | Counter | `signal_type` |
| `taste_profile_update` | `movientum_taste_profile_update_seconds` | Histogram | — |
| `interaction_log_inserts` | `movientum_interaction_log_inserts_total` | Counter | — |
| `celery_task_duration` | `movientum_celery_task_duration_seconds` | Histogram | `task_name` |
| `celery_task_status` | `movientum_celery_task_total` | Counter | `task_name`, `status` |

---

## XGBRanker 16-Feature Matrix

Monitored via Supabase SQL (feature_snapshot column in interaction_log).

| Index | Feature | What it measures |
|---|---|---|
| 0 | `ppr_score` | PersonalizedPageRank score from NetworkX |
| 1 | `ppr_rank_norm` | Rank position normalised 1.0→0.0 |
| 2 | `vote_average` | TMDB vote score |
| 3 | `vote_count_log` | log1p(vote_count) |
| 4 | `popularity_log` | log1p(popularity) |
| 5 | `recency_score` | 1 / (2026 - release_year + 1) |
| 6 | `user_genre_score` | Sum of `genre_weights` for item's genres |
| 7 | `user_cast_score` | Sum of `cast_weights` for item's cast |
| 8 | `user_crew_score` | Sum of `crew_weights` for directors |
| 9 | `user_keyword_score` | Sum of `keyword_weights` for item's keywords |
| 10 | `user_era_score` | `era_weights[release_era]` |
| 11 | `user_language_mult` | `language_weights[original_language]` |
| 12 | `genre_overlap_count` | Shared genres with origin item |
| 13 | `cast_overlap_count` | Shared cast with origin item |
| 14 | `same_language` | Binary: same original language |
| 15 | `same_era` | Binary: same release era |

---

## Interaction Log → Retrain → Recommendation Loop

```
User action (thumbs_up / watched / click / ignore)
    │
    ▼ feedback_service.py
    ├── feedback_signals{signal_type} +1           → Dashboard E
    ├── UserTasteProfile weights updated in Supabase
    │   Explicit (thumbs/watched) → no time decay λ=0
    │   Implicit (click/ignore)   → decay W(t)=e^(-0.01×Δdays), half-life 69d
    │   Weights clamped [-100, 100]
    ├── taste_profile_update histogram observed     → Dashboard E
    └── InteractionLog row inserted (feature_snapshot JSON)
        interaction_log_inserts_total +1            → Dashboard E
              │
              ▼ Celery beat — 3:30 AM IST daily
    retrain_ranker.py → run_nightly_retrain()
    ├── Pull last 30d from interaction_log
    ├── Apply W(t) = e^(-0.01 × Δt_days) as sample weights
    ├── 85/15 train/val split by user-group boundaries
    ├── XGBRanker.fit(rank:ndcg, n_estimators=300, eval ndcg@10, early_stopping=20)
    ├── retrain_best_iteration.set(best_iteration)  → Dashboard D
    ├── retrain_rows_trained.set(rows_trained)       → Dashboard D
    ├── retrain_total{status=ok} +1                  → Dashboard D
    ├── Save ranker.json → reload_ranker() hot-swap
    └── invalidate_graph() → graph rebuilds next request
              │
              ▼ Next user recommendation request
    get_new_model_recommendations()
    ├── RWR via nx.pagerank()      rwr_seconds histogram         → Dashboard B
    ├── build_feature_matrix()     feature_matrix_build_seconds  → Dashboard B
    ├── rank_candidates()          xgb_inference_seconds         → Dashboard B
    └── xgb_coldstart_total = 0 (model trained, no PPR fallback)
```

---

## Conclusion

The Movientum observability stack — built on OpenTelemetry → Azure Application Insights → Azure Monitor → Grafana — provides complete end-to-end visibility across seven dashboards (A–G):

- **Infrastructure monitoring** — CPU, memory, availability (Dashboard F)
- **API monitoring** — request rate, latency, error rate (Dashboard A)
- **ML pipeline monitoring** — RWR latency, XGB inference, cold-start detection (Dashboards B–C)
- **Recommendation quality monitoring** — graph health, retrain outcomes, model iteration (Dashboards C–D)
- **User behaviour analytics** — feedback signals, taste profile updates, interaction log growth (Dashboard E)
- **Business KPI monitoring** — daily active users, watchlist additions, movies watched, recommendation funnel (Dashboard G)

**Azure Managed Grafana and Grafana Cloud are two visualization layers sitting on top of the same Azure Monitor telemetry backend.** No duplicate instrumentation. No duplicate data collection. Backend exports once. Azure stores once. Both environments query Azure Monitor.
