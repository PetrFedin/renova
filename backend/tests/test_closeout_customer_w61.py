"""W61: closeout is customer-only."""
import pytest
from httpx import ASGITransport, AsyncClient

from app.main import app


@pytest.mark.asyncio
async def test_closeout_rejects_contractor():
    transport = ASGITransport(app=app)
    async with AsyncClient(transport=transport, base_url="http://test") as client:
        cust = (await client.post("/api/v1/auth/demo", json={"role": "customer"})).json()
        contr = (await client.post("/api/v1/auth/demo", json={"role": "contractor"})).json()
        h_c = {"X-User-Id": cust["id"]}
        h_k = {"X-User-Id": contr["id"]}
        projects = (await client.get("/api/v1/projects", headers=h_c)).json()
        if not projects:
            pytest.skip("no demo project")
        pid = projects[0]["id"]
        # link contractor if needed
        await client.post(
            f"/api/v1/projects/{pid}/contractor",
            headers=h_c,
            json={"contractor_id": contr["id"]},
        )
        r = await client.post(f"/api/v1/projects/{pid}/closeout", headers=h_k)
        assert r.status_code == 403, r.text
