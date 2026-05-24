"""
data_loader.py  v3
══════════════════
Handles all 5 datasets for the FedPCL paper centralized baseline.

KEY FIXES vs v2:
  FIX 4 — Amazon preprocessed JSON: handle BOTH key naming conventions
           csv_to_fedpcl_json.py  saves  "train" / "test"
           preprocess_amazon_final.py saves "train_data" / "test_data"
           Both are now detected and loaded correctly.
"""

import os, json, random, math
from collections import defaultdict
import numpy as np

SEED = 42
random.seed(SEED)
np.random.seed(SEED)

# ── Implicit feedback thresholds ──────────────────────────────────────────────
THRESHOLDS = {
    'ml100k':    0,
    'ml1m':      0,
    'filmtrust': 0,
    'amazon':    0,
    'steam':     None,
}

# ── K-core policy per dataset ─────────────────────────────────────────────────
KCORE = {
    'ml100k':    0,
    'ml1m':      0,
    'steam':     0,
    'filmtrust': 5,
    'amazon':    0,   # already filtered during preprocessing
}

# ── Timestamp availability ────────────────────────────────────────────────────
HAS_TIMESTAMP = {'ml100k'}


# ══════════════════════════════════════════════════════════════════════════════
#  DataBundle
# ══════════════════════════════════════════════════════════════════════════════
class DataBundle:
    """
    Unified data container for one dataset.

    Attributes:
        n_users, n_items   int
        train_dict  {uid: [iid, ...]}    training items per user
        test_dict   {uid: iid}           single held-out test item per user
        neg_dict    {uid: [iid, ...]}    100 negatives per user (evaluation)
        adj_user    {uid: [iid, ...]}    same as train_dict (GNN adjacency)
        adj_item    {iid: [uid, ...]}    item→users adjacency
        deg_user    np.array [n_users]   user interaction degree
        deg_item    np.array [n_items]   item interaction degree
        all_items   set                  complete item ID set {0..n_items-1}
        name        str                  dataset name
    """
    def __init__(self):
        self.n_users = self.n_items = 0
        self.train_dict = self.test_dict = self.neg_dict = {}
        self.adj_user = self.adj_item = {}
        self.deg_user = self.deg_item = None
        self.all_items = set()
        self.name = ''

    def __repr__(self):
        n_train = sum(len(v) for v in self.train_dict.values())
        density = n_train / max(self.n_users * self.n_items, 1) * 100
        return (f"DataBundle({self.name})  users={self.n_users}  "
                f"items={self.n_items}  train={n_train}  density={density:.3f}%")


# ══════════════════════════════════════════════════════════════════════════════
#  MAIN ENTRY POINT
# ══════════════════════════════════════════════════════════════════════════════
def load_dataset(dataset_name: str, data_path: str,
                 n_negatives: int = 100) -> DataBundle:
    name = dataset_name.lower().replace('-', '').replace('_', '')

    if name == 'steam':
        interactions = _load_steam(data_path)
        use_timestamp = False
    elif name == 'ml100k':
        interactions = _load_ml100k(data_path)
        use_timestamp = False
    elif name == 'ml1m':
        interactions = _load_ml1m(data_path)
        use_timestamp = False
    elif name == 'filmtrust':
        # FIX: if caller passes a preprocessed JSON, route through the
        # same generic loader used for Amazon (handles both key conventions).
        ext = os.path.splitext(data_path)[1].lower()
        if ext == '.json':
            bundle = _load_preprocessed_json(data_path, 'filmtrust', n_negatives)
            if bundle is not None:
                return bundle
        # fallback: raw space-separated ratings.txt
        interactions = _load_filmtrust(data_path)
        use_timestamp = False
    elif name in ('amazon', 'amazonelectronic', 'amazonelectronics'):
        ext = os.path.splitext(data_path)[1].lower()
        if ext == '.json':
            bundle = _load_preprocessed_json(data_path, 'amazon', n_negatives)
            if bundle is not None:
                return bundle
        # fallback: raw CSV / JSONL → go through normal pipeline
        interactions = _load_amazon_raw(data_path)
        use_timestamp = False
        name = 'amazon'
    else:
        raise ValueError(f"Unknown dataset: {dataset_name}")

    k = KCORE.get(name, 5)
    return _build_bundle(interactions, name, n_negatives,
                         use_timestamp=use_timestamp, kcore=k)


# ══════════════════════════════════════════════════════════════════════════════
#  GENERIC PREPROCESSED JSON LOADER  (amazon, filmtrust, steam, etc.)
# ══════════════════════════════════════════════════════════════════════════════
def _load_preprocessed_json(path: str, dataset_name: str,
                             n_negatives: int = 100):
    """
    Builds a DataBundle from any preprocessed dataset JSON.
    Handles BOTH key naming conventions:
        csv_to_fedpcl_json.py      → keys: "train",      "test"
        preprocess_amazon_final.py → keys: "train_data", "test_data"

    Returns DataBundle or None (if file is not a recognised preprocessed format).
    """
    with open(path) as f:
        d = json.load(f)

    # ── Detect key names ──────────────────────────────────────────────────────
    if 'train_data' in d and 'test_data' in d:
        raw_train = {int(k): v        for k, v in d['train_data'].items()}
        raw_test  = {int(k): int(v)   for k, v in d['test_data'].items()}
        raw_neg   = {int(k): v        for k, v in d.get('test_negatives', {}).items()}
        n_users   = d.get('n_users',  max(raw_train.keys()) + 1 if raw_train else 0)
        n_items   = d.get('n_items',  None)

    elif 'train' in d and 'test' in d:
        raw_train_raw = {int(k): v for k, v in d['train'].items()}
        raw_test_raw  = {int(k): v for k, v in d['test'].items()}

        raw_train = {}
        for uid, hist in raw_train_raw.items():
            if hist and isinstance(hist[0], list):
                raw_train[uid] = [entry[0] for entry in hist]
            else:
                raw_train[uid] = [int(x) for x in hist]

        raw_test = {}
        for uid, val in raw_test_raw.items():
            if isinstance(val, list):
                raw_test[uid] = int(val[0])
            else:
                raw_test[uid] = int(val)

        raw_neg = {int(k): v for k, v in d.get('negatives', {}).items()}
        meta    = d.get('metadata', {})
        n_users = meta.get('num_users', max(raw_train.keys()) + 1 if raw_train else 0)
        n_items = meta.get('num_items', None)

    else:
        print(f"  [{dataset_name}] JSON keys: {list(d.keys())} — not a preprocessed format")
        return None

    # ── Infer n_items if not stored ───────────────────────────────────────────
    if n_items is None:
        all_iids = set()
        for items in raw_train.values(): all_iids.update(items)
        all_iids.update(raw_test.values())
        n_items = max(all_iids) + 1 if all_iids else 0

    print(f"  [{dataset_name}] Loaded preprocessed JSON: "
          f"{len(raw_train)} train users, {len(raw_test)} test users, "
          f"n_items={n_items}")

    # ── Build adjacency + degree ──────────────────────────────────────────────
    adj_user = defaultdict(list)
    adj_item = defaultdict(list)
    for uid, items in raw_train.items():
        for iid in items:
            adj_user[uid].append(iid)
            adj_item[iid].append(uid)

    deg_user = np.array([len(adj_user.get(u, [])) for u in range(n_users)],
                        dtype=np.float32)
    deg_item = np.array([len(adj_item.get(i, [])) for i in range(n_items)],
                        dtype=np.float32)
    deg_user[deg_user == 0] = 1
    deg_item[deg_item == 0] = 1

    # ── Negative samples ──────────────────────────────────────────────────────
    all_items = set(range(n_items))
    neg_dict  = {}
    for uid in raw_test:
        if uid in raw_neg and len(raw_neg[uid]) > 0:
            neg_dict[uid] = raw_neg[uid]
        else:
            seen      = set(raw_train.get(uid, [])) | {raw_test[uid]}
            neg_pool  = list(all_items - seen)
            n_neg     = min(n_negatives, len(neg_pool))
            neg_dict[uid] = random.sample(neg_pool, n_neg)

    # ── Assemble DataBundle ───────────────────────────────────────────────────
    bundle            = DataBundle()
    bundle.name       = dataset_name
    bundle.n_users    = n_users
    bundle.n_items    = n_items
    bundle.train_dict = raw_train
    bundle.test_dict  = raw_test
    bundle.neg_dict   = neg_dict
    bundle.adj_user   = dict(adj_user)
    bundle.adj_item   = dict(adj_item)
    bundle.deg_user   = deg_user
    bundle.deg_item   = deg_item
    bundle.all_items  = all_items
    bundle._item2id   = {i: i for i in range(n_items)}

    n_train = sum(len(v) for v in raw_train.values())
    print(repr(bundle))
    print(f"  train={n_train}  test={len(raw_test)}  "
          f"neg_per_user={n_negatives}  kcore=off  split=precomputed")
    return bundle


# Backward-compat alias (used nowhere else now, but kept to avoid import errors)
def _load_amazon_preprocessed_json(path, n_negatives=100):
    return _load_preprocessed_json(path, 'amazon', n_negatives)


# ══════════════════════════════════════════════════════════════════════════════
#  ITEM NAME LOADER
# ══════════════════════════════════════════════════════════════════════════════
def load_item_names(dataset_name: str, names_path: str,
                    item2id: dict = None) -> dict:
    name = dataset_name.lower().replace('-', '').replace('_', '')
    id2name_raw = {}

    if not os.path.exists(names_path):
        print(f"  [Names] File not found: {names_path}")
        return {}

    try:
        if name == 'ml100k':
            with open(names_path, encoding='latin-1') as f:
                for line in f:
                    parts = line.strip().split('|')
                    if len(parts) >= 2:
                        try:
                            raw_id = int(parts[0])
                            title  = parts[1].strip()
                            id2name_raw[raw_id] = title
                        except: continue

        elif name == 'ml1m':
            with open(names_path, encoding='latin-1') as f:
                for line in f:
                    parts = line.strip().split('::')
                    if len(parts) >= 2:
                        try:
                            raw_id = int(parts[0])
                            title  = parts[1].strip()
                            id2name_raw[raw_id] = title
                        except: continue

        elif name == 'steam':
            with open(names_path) as f:
                d = json.load(f)
            return {int(v): k for k, v in d.get('item2id', {}).items()}

        print(f"  [Names] Loaded {len(id2name_raw)} item names from {names_path}")

    except Exception as e:
        print(f"  [Names] Error loading: {e}")
        return {}

    if item2id is None:
        return {k: v for k, v in id2name_raw.items()}

    int2name = {}
    for raw_id, name_str in id2name_raw.items():
        if raw_id in item2id:
            int2name[item2id[raw_id]] = name_str
    print(f"  [Names] Mapped {len(int2name)} names to model item IDs")
    return int2name


# ══════════════════════════════════════════════════════════════════════════════
#  DATASET-SPECIFIC LOADERS
# ══════════════════════════════════════════════════════════════════════════════

def _load_steam(path: str):
    with open(path) as f:
        d = json.load(f)
    train = {int(k): v   for k, v in d['train_data'].items()}
    test  = {int(k): int(v) for k, v in d['test_data'].items()}
    rows  = []
    for uid, items in train.items():
        for iid in items:
            rows.append((uid, iid, 0))
    for uid, iid in test.items():
        rows.append((uid, iid, 0))
    return rows


def _load_ml100k(path: str):
    rows = []
    with open(path) as f:
        for line in f:
            p = line.strip().split('\t')
            if len(p) < 4: continue
            uid, iid, rating, ts = int(p[0]), int(p[1]), float(p[2]), int(p[3])
            if rating >= THRESHOLDS['ml100k']:
                rows.append((uid, iid, ts))
    return rows


def _load_ml1m(path: str):
    rows = []
    with open(path, encoding='latin-1') as f:
        for line in f:
            p = line.strip().split('::')
            if len(p) < 4: continue
            uid, iid, rating, ts = int(p[0]), int(p[1]), float(p[2]), int(p[3])
            if rating >= THRESHOLDS['ml1m']:
                rows.append((uid, iid, ts))
    return rows


def _load_filmtrust(path: str):
    rows = []
    with open(path) as f:
        for line in f:
            p = line.strip().split()
            if len(p) < 3: continue
            uid, iid, rating = int(p[0]), int(p[1]), float(p[2])
            if rating > THRESHOLDS['filmtrust']:
                rows.append((uid, iid, 0))
    return rows


def _load_amazon_raw(path: str):
    """Raw CSV or JSONL Amazon Electronics file (fallback for non-preprocessed)."""
    rows = []
    ext  = os.path.splitext(path)[1].lower()

    if ext in ('.json', '.jsonl'):
        with open(path) as f:
            for line in f:
                try:
                    obj  = json.loads(line.strip())
                    uid  = obj.get('reviewerID', '')
                    iid  = obj.get('asin', '')
                    rate = float(obj.get('overall', 0))
                    ts   = int(obj.get('unixReviewTime', 0))
                    if rate >= THRESHOLDS['amazon']:
                        rows.append((uid, iid, ts))
                except: continue
        return rows

    import csv
    with open(path, newline='', encoding='utf-8') as f:
        reader = csv.DictReader(f)
        for row in reader:
            try:
                uid  = row.get('reviewerID', row.get('user_id', ''))
                iid  = row.get('asin',       row.get('item_id', ''))
                rate = float(row.get('overall', row.get('rating', 0)))
                ts   = int(row.get('unixReviewTime', row.get('timestamp', 0)))
                if rate >= THRESHOLDS['amazon']:
                    rows.append((uid, iid, ts))
            except: continue
    return rows


# ══════════════════════════════════════════════════════════════════════════════
#  BUNDLE BUILDER
# ══════════════════════════════════════════════════════════════════════════════
def _build_bundle(interactions: list, name: str,
                  n_negatives: int,
                  use_timestamp: bool = False,
                  kcore: int = 5) -> DataBundle:
    # ── Dedup ─────────────────────────────────────────────────────────────────
    seen = {}
    for u, i, ts in interactions:
        key = (u, i)
        if key not in seen or ts > seen[key]:
            seen[key] = ts
    interactions = [(u, i, ts) for (u, i), ts in seen.items()]

    # ── K-core ────────────────────────────────────────────────────────────────
    if kcore >= 2:
        interactions = _k_core(interactions, k=kcore)

    # ── Re-index ──────────────────────────────────────────────────────────────
    raw_users = sorted(set(u for u, i, ts in interactions))
    raw_items = sorted(set(i for u, i, ts in interactions))
    user2id   = {u: idx for idx, u in enumerate(raw_users)}
    item2id   = {i: idx for idx, i in enumerate(raw_items)}
    indexed   = [(user2id[u], item2id[i], ts) for u, i, ts in interactions]

    n_users = len(user2id)
    n_items = len(item2id)

    # ── Group + sort/shuffle ──────────────────────────────────────────────────
    user_items = defaultdict(list)
    for u, i, ts in indexed:
        user_items[u].append((i, ts))

    if use_timestamp:
        for u in user_items:
            user_items[u].sort(key=lambda x: x[1])
    else:
        for u in user_items:
            random.shuffle(user_items[u])

    # ── Leave-one-out split ───────────────────────────────────────────────────
    train_dict = {}
    test_dict  = {}
    for u, item_ts_list in user_items.items():
        items_ordered = [iid for iid, ts in item_ts_list]
        test_dict[u]  = items_ordered[-1]
        train_dict[u] = items_ordered[:-1]

    # ── Adjacency + degree ────────────────────────────────────────────────────
    adj_user = defaultdict(list)
    adj_item = defaultdict(list)
    for u, items in train_dict.items():
        for i in items:
            adj_user[u].append(i)
            adj_item[i].append(u)

    deg_user = np.array([len(adj_user[u]) for u in range(n_users)], dtype=np.float32)
    deg_item = np.array([len(adj_item[i]) for i in range(n_items)], dtype=np.float32)
    deg_user[deg_user == 0] = 1
    deg_item[deg_item == 0] = 1

    # ── Negatives ─────────────────────────────────────────────────────────────
    all_items = set(range(n_items))
    neg_dict  = {}
    for u in user_items:
        seen_u   = set(iid for iid, _ in user_items[u])
        neg_pool = list(all_items - seen_u)
        n_neg    = min(n_negatives, len(neg_pool))
        neg_dict[u] = random.sample(neg_pool, n_neg)

    # ── Assemble ──────────────────────────────────────────────────────────────
    bundle            = DataBundle()
    bundle.name       = name
    bundle.n_users    = n_users
    bundle.n_items    = n_items
    bundle.train_dict = dict(train_dict)
    bundle.test_dict  = test_dict
    bundle.neg_dict   = neg_dict
    bundle.adj_user   = dict(adj_user)
    bundle.adj_item   = dict(adj_item)
    bundle.deg_user   = deg_user
    bundle.deg_item   = deg_item
    bundle.all_items  = all_items
    bundle._item2id   = item2id

    print(repr(bundle))
    n_train = sum(len(v) for v in train_dict.values())
    print(f"  train={n_train}  test={len(test_dict)}  "
          f"neg_per_user={n_negatives}  "
          f"kcore={'off' if kcore < 2 else kcore}  "
          f"split={'timestamp' if use_timestamp else 'random'}")
    return bundle


def _k_core(interactions, k=5):
    from collections import Counter
    while True:
        uc       = Counter(u for u, i, ts in interactions)
        ic       = Counter(i for u, i, ts in interactions)
        filtered = [(u, i, ts) for u, i, ts in interactions
                    if uc[u] >= k and ic[i] >= k]
        if len(filtered) == len(interactions):
            break
        interactions = filtered
    return interactions


# ══════════════════════════════════════════════════════════════════════════════
#  EDGE INDEX BUILDER
# ══════════════════════════════════════════════════════════════════════════════
def build_edge_index(bundle: DataBundle):
    import torch
    rows, cols, weights = [], [], []
    for u, items in bundle.adj_user.items():
        du = bundle.deg_user[u]
        for i in items:
            di = bundle.deg_item[i]
            w  = 1.0 / math.sqrt(float(du) * float(di))
            rows.append(u);                cols.append(bundle.n_users + i)
            rows.append(bundle.n_users + i); cols.append(u)
            weights.extend([w, w])
    return (torch.tensor([rows, cols], dtype=torch.long),
            torch.tensor(weights,      dtype=torch.float32))


# ══════════════════════════════════════════════════════════════════════════════
#  NEGATIVE SAMPLER  (per training batch)
# ══════════════════════════════════════════════════════════════════════════════
def sample_negatives_batch(users, train_dict, n_items):
    neg = []
    for u in users:
        seen = set(train_dict.get(u, []))
        while True:
            j = random.randint(0, n_items - 1)
            if j not in seen:
                neg.append(j)
                break
    return neg
