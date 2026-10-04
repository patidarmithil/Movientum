# Nightly Ranker Retraining

> The file name is historical. MLflow is **not** used. Models are saved to disk and results are sent to Azure App Insights.

The XGBRanker learns from the last 30 days of user feedback. A new model is only used if it proves better than the formula it would replace.

## When it runs

- Celery beat at **03:30 IST** (`tasks/retrain_ranker.py`), after the 03:00 TMDB sync.
- Or on demand from the admin panel (`retrain_ranker` trigger, also part of `nightly_job`).

## Steps (`ml/training.py`)

1. **Load data** — `interaction_log` rows from the last 30 days that have a feature snapshot.
2. **Build training set**
   - `X` = the 16 saved features.
   - `y` = label derived from the signal type (watched 5 … thumbs down 1).
   - Rows grouped per user, so the model learns ordering within one person's choices.
   - Sample weight = time decay; dislikes ×1.5.
3. **Skip early** if fewer than 20 rows, or fewer than 5 users.
4. **Split** — last 15% of users held out for validation.
5. **Train** — `XGBRanker(objective="rank:ndcg", tree_method="hist")` with early stopping on NDCG@10.
6. **Approve or reject** — compare NDCG@10 on held-out users against the composite score. Approve only if:
   - at least 5 users, 200 rows, 2 validation users, **and**
   - the model (blended with the composite) beats the composite alone.
7. **If approved** — save `ranker.json`, write `ranker_meta.json` with `approved: true` and the scores, hot-reload with `reload_ranker()` (no restart).
8. **If not** — nothing changes; the live ranking stays as it was.

## How the model is used

`rank_candidates()` in `ml/ranker.py`:
- No approved model → rank by the composite (45% graph, 30% quality, 25% taste).
- Approved model → rank-level 50/50 blend of model and composite. The model is never used alone, because training rows do not record true graph position, so it cannot judge similarity by itself.

## Why the gate exists

An early model was trained on about 100 rows from 2 users and gave every guest candidate the same score. Sorting then returned the *least* similar titles. The approval step prevents a weak model from going live.

## Monitoring

Sent to App Insights: retrain outcome counter (`success`, `skipped_insufficient_data`, `skipped_not_approved`, errors), duration, rows trained, best iteration.

## Checking by hand

```bash
python debug/scratch_ranker_eval.py
python debug/scratch_ranker_labels.py
```
