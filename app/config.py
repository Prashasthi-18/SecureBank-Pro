"""Application configuration. All secrets come from the environment."""
import os
import secrets
from datetime import timedelta


class Config:
    SECRET_KEY = os.environ.get("SECRET_KEY") or secrets.token_hex(32)
    DATABASE = os.environ.get("DATABASE_PATH", os.path.join(os.getcwd(), "instance", "securebank.db"))

    # Session hardening
    SESSION_COOKIE_NAME = "sb_session"
    SESSION_COOKIE_HTTPONLY = True
    SESSION_COOKIE_SAMESITE = "Strict"
    SESSION_COOKIE_SECURE = os.environ.get("COOKIE_SECURE", "false").lower() == "true"
    PERMANENT_SESSION_LIFETIME = timedelta(minutes=int(os.environ.get("SESSION_MINUTES", "15")))
    IDLE_TIMEOUT_SECONDS = int(os.environ.get("IDLE_TIMEOUT_SECONDS", "600"))

    # Brute-force protection
    MAX_FAILED_LOGINS = 5
    LOCKOUT_MINUTES = 15
    LOGIN_RATE_LIMIT = (10, 60)  # 10 attempts per 60 seconds per IP

    # Business limits (in cents)
    OPENING_BONUS_CENTS = 500_000          # 5,000.00 demo balance
    MAX_TRANSFER_CENTS = 1_000_000         # 10,000.00 per transfer
    DAILY_TRANSFER_LIMIT_CENTS = 2_500_000 # 25,000.00 per day

    MAX_CONTENT_LENGTH = 16 * 1024  # forms only; reject large bodies

    ADMIN_USERNAME = os.environ.get("ADMIN_USERNAME")
    ADMIN_PASSWORD = os.environ.get("ADMIN_PASSWORD")


class TestConfig(Config):
    TESTING = True
    SECRET_KEY = "test-secret-key"
    LOGIN_RATE_LIMIT = (100, 60)
