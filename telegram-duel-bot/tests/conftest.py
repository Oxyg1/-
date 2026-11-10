import pytest_asyncio

from duelbot.storage.db import Database


@pytest_asyncio.fixture
async def db(tmp_path):
    d = await Database.connect(str(tmp_path / "t.db"))
    yield d
    await d.close()
