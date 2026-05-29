"""
Movientum — Password Utilities (Phase 3.1)

hash_password    → bcrypt hash with cost=12
verify_password  → constant-time comparison
"""
import bcrypt


def hash_password(plain: str) -> str:
    """Return bcrypt hash of plain-text password (cost=12)."""
    pwd_bytes = plain.encode("utf-8")
    salt = bcrypt.gensalt(rounds=12)
    hashed = bcrypt.hashpw(pwd_bytes, salt)
    return hashed.decode("utf-8")


def verify_password(plain: str, hashed: str) -> bool:
    """Constant-time comparison of plain vs stored hash. Returns bool."""
    try:
        pwd_bytes = plain.encode("utf-8")
        hashed_bytes = hashed.encode("utf-8")
        return bcrypt.checkpw(pwd_bytes, hashed_bytes)
    except Exception:
        return False
