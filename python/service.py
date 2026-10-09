"""API local para inferência; recebe somente landmarks, nunca vídeo."""

from __future__ import annotations

import json
import os
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path

import joblib

from libras_ml import FEATURE_VERSION, predict


ROOT = Path(__file__).resolve().parent
MODEL_PATH = Path(os.environ.get("LIBRAS_PYTHON_MODEL_PATH", ROOT / "models" / "libras-knn.joblib"))
HOST = os.environ.get("LIBRAS_PYTHON_HOST", "127.0.0.1")
PORT = int(os.environ.get("LIBRAS_PYTHON_PORT", "8788"))
CONFIDENCE_THRESHOLD = float(os.environ.get("LIBRAS_PYTHON_CONFIDENCE", "0.55"))
MODEL_BUNDLE = None
MODEL_ERROR = ""
MODEL_MTIME_NS = None


def load_model() -> None:
    global MODEL_BUNDLE, MODEL_ERROR, MODEL_MTIME_NS
    if not MODEL_PATH.is_file():
        MODEL_BUNDLE = None
        MODEL_MTIME_NS = None
        MODEL_ERROR = "Modelo Python ainda não treinado. Exporte um dataset e execute python/train.py."
        return
    model_mtime = MODEL_PATH.stat().st_mtime_ns
    if MODEL_BUNDLE is not None and MODEL_MTIME_NS == model_mtime:
        return
    try:
        bundle = joblib.load(MODEL_PATH)
        if bundle.get("feature_version") != FEATURE_VERSION:
            raise ValueError("A versão das features do modelo não corresponde ao aplicativo.")
        if not all(key in bundle for key in ("model", "class_counts", "sample_count", "metrics", "distance_threshold")):
            raise ValueError("O arquivo não contém todos os dados de um modelo treinado pelo projeto.")
        MODEL_BUNDLE = bundle
        MODEL_MTIME_NS = model_mtime
        MODEL_ERROR = ""
    except Exception as error:  # noqa: BLE001 - devolve motivo legível no health check.
        MODEL_BUNDLE = None
        MODEL_MTIME_NS = model_mtime
        MODEL_ERROR = f"Não foi possível carregar o modelo: {error}"


class Handler(BaseHTTPRequestHandler):
    server_version = "LibrasPython/1.0"

    def send_json(self, status: int, payload: dict) -> None:
        body = json.dumps(payload, ensure_ascii=False).encode("utf-8")
        self.send_response(status)
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Content-Length", str(len(body)))
        self.send_header("Cache-Control", "no-store")
        self.end_headers()
        self.wfile.write(body)

    def do_GET(self) -> None:  # noqa: N802 - nome exigido por BaseHTTPRequestHandler.
        if self.path != "/healthz":
            self.send_json(404, {"code": "NOT_FOUND"})
            return
        load_model()
        self.send_json(200, {
            "state": "ready" if MODEL_BUNDLE else "not-configured",
            "modelReady": MODEL_BUNDLE is not None,
            "classes": len(MODEL_BUNDLE["class_counts"]) if MODEL_BUNDLE else 0,
            "sampleCount": MODEL_BUNDLE["sample_count"] if MODEL_BUNDLE else 0,
            "metrics": MODEL_BUNDLE.get("metrics") if MODEL_BUNDLE else None,
            "message": "Modelo Python carregado." if MODEL_BUNDLE else MODEL_ERROR,
        })

    def do_POST(self) -> None:  # noqa: N802 - nome exigido por BaseHTTPRequestHandler.
        if self.path != "/predict":
            self.send_json(404, {"code": "NOT_FOUND"})
            return
        load_model()
        if not MODEL_BUNDLE:
            self.send_json(503, {"code": "MODEL_NOT_READY", "message": MODEL_ERROR})
            return
        try:
            content_length = int(self.headers.get("Content-Length", "0"))
            if content_length <= 0 or content_length > 2_000_000:
                raise ValueError("Corpo da requisição vazio ou maior que 2 MB.")
            payload = json.loads(self.rfile.read(content_length))
            if not isinstance(payload, dict):
                raise ValueError("A requisição precisa ser um objeto JSON com a sequência.")
            result = predict(MODEL_BUNDLE, payload.get("sequence"), CONFIDENCE_THRESHOLD)
            self.send_json(200, result)
        except (json.JSONDecodeError, TypeError, ValueError) as error:
            self.send_json(400, {"code": "INVALID_SEQUENCE", "message": str(error)})

    def log_message(self, _format: str, *_args) -> None:
        return


if __name__ == "__main__":
    load_model()
    print(f"[libras-python] http://{HOST}:{PORT} · {MODEL_ERROR or 'modelo carregado'}")
    ThreadingHTTPServer((HOST, PORT), Handler).serve_forever()
