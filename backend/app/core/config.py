from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    model_config = SettingsConfigDict(env_prefix="PLANNER_", env_file=".env", extra="ignore")

    database_url: str = "postgresql+psycopg://planner:dev@localhost:5433/planner"
    admin_username: str = "admin"
    admin_password: str = "changeme-admin"
    admin_display_name: str = "کاربر اصلی"
    default_timezone: str = "Asia/Tehran"
    session_cookie_name: str = "planner_session"
    session_ttl_days: int = 30
    cookie_secure: bool = True  # False only for local dev over plain HTTP

    # Backups: weekly ZIP (Saturday 02:00 in the admin user's timezone) + manual button.
    # Delivery channels are optional and activate when both their values are set.
    backup_dir: str = "backups"  # container uses /app/backups via compose
    env_file_path: str = "/app/.env"
    compose_file_path: str = "/app/compose.yml"
    docker_dir_path: str = "/app/docker"
    backup_keep_local: int = 10
    backup_telegram_bot_token: str = ""
    backup_telegram_chat_id: str = ""
    backup_github_repo: str = ""  # "owner/name" of a private repo
    backup_github_token: str = ""

    # Daily Telegram briefings (morning sprint overview + evening logged-time summary).
    # Empty notify_* values fall back to the backup bot credentials.
    notify_telegram_bot_token: str = ""
    notify_telegram_chat_id: str = ""
    notify_morning_hour: int = 6   # local (admin timezone) hour of the morning briefing
    notify_evening_hour: int = 23  # local hour of the evening summary


settings = Settings()
