from __future__ import annotations

from functools import lru_cache

from pydantic import Field, model_validator
from pydantic_settings import BaseSettings, SettingsConfigDict

from .engine.models import JudgeConfig


class Settings(BaseSettings):
    model_config = SettingsConfigDict(env_file=".env", env_file_encoding="utf-8", extra="ignore")

    bot_token: str
    use_test_server: bool = False
    widgets_in_groups: bool = False
    ephemeral_commands: bool = True
    db_path: str = "duelbot.db"
    log_level: str = Field("INFO", pattern="^(DEBUG|INFO|WARNING|ERROR)$")

    challenge_ttl: int = Field(300, gt=0)
    stake_ttl: int = Field(180, gt=0)
    ready_ttl: int = Field(90, gt=0)
    # сколько секунд нельзя снова вызывать игрока, который отказался (защита от спама вызовами)
    challenge_cooldown: int = Field(60, ge=0)
    # сколько секунд /cfind ищет соперника
    search_ttl: int = Field(600, gt=0)
    delay_min: float = Field(2.0, ge=0)
    delay_max: float = Field(6.0, ge=0)
    response_timeout: float = Field(5.0, gt=0)
    ping_samples: int = Field(1, ge=0, le=3)
    default_rtt_ms: float = Field(150.0, ge=0)
    max_rtt_ms: float = Field(400.0, ge=0)
    min_human_ms: float = Field(80.0, ge=0)
    tie_ms: float = Field(20.0, ge=0)
    one_sided_policy: str = Field("cancel", pattern="^(cancel|win)$")
    elo_k: int = Field(32, ge=1, le=100)

    enable_stars_stakes: bool = False
    stars_min: int = Field(1, ge=1)
    stars_max: int = 500
    stars_winner_gift_id: str = ""

    enable_ton_stakes: bool = False
    ton_network: str = "-239"
    ton_api_base: str = "https://toncenter.com/api/v3"
    ton_api_key: str = ""
    ton_min: float = 0.1
    ton_max: float = 10.0
    ton_fee_reserve: float = 0.05
    ton_claim_ttl: int = Field(900, gt=0)
    # комиссия владельца бота с TON-ставок: доля проигрыша уходит на этот кошелёк
    ton_fee_percent: float = Field(0.0, ge=0, lt=50)
    ton_fee_wallet: str = ""

    @model_validator(mode="after")
    def _check_ranges(self) -> Settings:
        if self.delay_min > self.delay_max:
            raise ValueError("DELAY_MIN must be <= DELAY_MAX")
        if self.default_rtt_ms > self.max_rtt_ms:
            raise ValueError("DEFAULT_RTT_MS must be <= MAX_RTT_MS")
        if self.stars_min > self.stars_max:
            raise ValueError("STARS_MIN must be <= STARS_MAX")
        if not (0 < self.ton_min <= self.ton_max):
            raise ValueError("need 0 < TON_MIN <= TON_MAX")
        if self.ton_network not in ("-239", "-3"):
            raise ValueError("TON_NETWORK must be -239 (mainnet) or -3 (testnet)")
        if self.ton_fee_percent > 0:
            from .stakes.ton_utils import parse_address
            try:
                parse_address(self.ton_fee_wallet)
            except ValueError as e:
                raise ValueError("TON_FEE_PERCENT > 0 needs a valid TON_FEE_WALLET") from e
        return self

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
