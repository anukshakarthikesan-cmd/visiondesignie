"""Smoke tests — run from ``backend/``: ``python -m unittest discover -s tests -p 'test_*.py' -v``"""

import unittest

from starlette.testclient import TestClient

from app.main import app


class TestHealth(unittest.TestCase):
    def test_health_returns_expected_keys(self) -> None:
        client = TestClient(app)
        response = client.get("/health")
        self.assertEqual(response.status_code, 200)
        data = response.json()
        self.assertIn("status", data)
        self.assertIn(data["status"], ("ok", "degraded"))
        self.assertIn("groq_configured", data)
        self.assertIsInstance(data["groq_configured"], bool)
        self.assertIn("supabase_metrics_configured", data)
        self.assertIn("vector_store_ready", data)
