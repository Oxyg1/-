from __future__ import annotations

from functools import lru_cache

from pydantic import Field
from pydantic_settings import BaseSettings, SettingsConfigDict

from .engine.models import JudgeConfig


class Settings(BaseSettings):
    model_config = SettingsConfigDict(env_file=".env", env_file_encoding="utf-8", extra="ignore")

    bot_token: str
    use_test_server: bool = False
    widgets_in_groups: bool = False
    ephemeral_commands: bool = True
    db_path: str = "duelbot.db"

    challenge_ttl: int = 300
    stake_ttl: int = 180
    ready_ttl: int = 90
    delay_min: float = 2.0
    delay_max: float = 6.0
    response_timeout: float = 5.0
    ping_samples: int = Field(1, ge=0, le=3)
    default_rtt_ms: float = 150.0
    max_rtt_ms: float = 400.0
    min_human_ms: float = 80.0
    tie_ms: float = 20.0
    one_sided_policy: str = Field("cancel", pattern="^(cancel|win)$")

    enable_stars_stakes: bool = False
    stars_min: int = 1
    stars_max: int = 500
    stars_winner_gift_id: str = ""

    enable_ton_stakes: bool = False
    ton_network: str = "-239"
    ton_api_base: str = "https://toncenter.com/api/v3"
    ton_api_key: str = ""
    ton_min: float = 0.1
    ton_max: float = 10.0
    ton_fee_reserve: float = 0.05
    ton_claim_ttl: int = 900

    def judge_config(self) -> JudgeConfig:
        return JudgeConfig(
            min_human_ms=self.min_human_ms,
            tie_ms=self.tie_ms,
            response_timeout_s=self.response_timeout,
            one_sided_policy=self.one_sided_policy,
        )

    @property
    def api_base(self) -> str:
        """Шаблон URL методов. Тестовый сервер — отдельный префикс /test/."""
        if self.use_test_server:
            return "https://api.telegram.org/bot{token}/test/{method}"
        return "https://api.telegram.org/bot{token}/{method}"


@lru_cache
def get_settings() -> Settings:
    return Settings()  # type: ignore[call-arg]
