"""Treinamento e inferência local a partir dos landmarks exportados pelo app."""

from __future__ import annotations

import math

import numpy as np
from sklearn.neighbors import KNeighborsClassifier, NearestNeighbors
from sklearn.pipeline import make_pipeline
from sklearn.preprocessing import StandardScaler


FEATURE_VERSION = "hands-normalized-v1"
VECTOR_SIZE = 126
FRAME_COUNT = 32


def encode_sequence(sequence: object) -> np.ndarray:
    if not isinstance(sequence, list) or len(sequence) < 8 or len(sequence) > 120:
        raise ValueError("A sequência precisa ter entre 8 e 120 frames.")

    vectors: list[list[float]] = []
    for frame in sequence:
        if not isinstance(frame, dict) or frame.get("version") != FEATURE_VERSION:
            raise ValueError(f"Formato de frame inválido; esperado {FEATURE_VERSION}.")
        vector = frame.get("vector")
        if not isinstance(vector, list) or len(vector) != VECTOR_SIZE:
            raise ValueError(f"Cada frame precisa ter {VECTOR_SIZE} valores de landmarks.")
        try:
            values = [float(value) for value in vector]
        except (TypeError, ValueError) as error:
            raise ValueError("Os landmarks precisam ser números.") from error
        if not all(math.isfinite(value) for value in values):
            raise ValueError("Os landmarks contêm valores inválidos.")
        vectors.append(values)

    source = np.asarray(vectors, dtype=np.float32)
    source_positions = np.linspace(0.0, 1.0, num=len(source))
    target_positions = np.linspace(0.0, 1.0, num=FRAME_COUNT)
    encoded = np.stack(
        [np.interp(target_positions, source_positions, source[:, index]) for index in range(VECTOR_SIZE)],
        axis=1,
    )
    return encoded.reshape(1, FRAME_COUNT * VECTOR_SIZE)


def build_classifier(sample_count: int, smallest_class: int):
    neighbors = min(5, sample_count, smallest_class)
    return make_pipeline(
        StandardScaler(),
        KNeighborsClassifier(n_neighbors=neighbors, weights="distance", metric="euclidean", n_jobs=1),
    )


def estimate_distance_threshold(model, features: np.ndarray, labels: np.ndarray) -> float:
    scaler = model[0]
    scaled = scaler.transform(features)
    within_class_distances = []
    for label in np.unique(labels):
        class_samples = scaled[labels == label]
        if len(class_samples) < 2:
            continue
        neighbors = NearestNeighbors(n_neighbors=2, metric="euclidean", n_jobs=1).fit(class_samples)
        distances, _ = neighbors.kneighbors(class_samples)
        within_class_distances.extend(distances[:, 1].tolist())
    if not within_class_distances:
        raise ValueError("Não há pares de exemplos da mesma classe para estimar a distância local.")
    return max(float(np.quantile(within_class_distances, 0.95)), 1e-3)


def predict(model_bundle: dict, sequence: object, threshold: float = 0.55) -> dict:
    features = encode_sequence(sequence)
    model = model_bundle["model"]
    probabilities = model.predict_proba(features)[0]
    ranked = np.argsort(probabilities)[::-1]
    best_index = int(ranked[0])
    second_score = float(probabilities[ranked[1]]) if len(ranked) > 1 else 0.0
    score = float(probabilities[best_index])
    label = str(model.classes_[best_index])
    scaled = model[0].transform(features)
    nearest_distance = float(model[1].kneighbors(scaled, n_neighbors=1, return_distance=True)[0][0][0])
    max_distance = float(model_bundle["distance_threshold"])
    in_training_range = nearest_distance <= max_distance * 1.5
    return {
        "label": label,
        "score": score,
        "margin": score - second_score,
        "accepted": score >= threshold and score - second_score >= 0.1 and in_training_range,
        "nearestDistance": nearest_distance,
        "threshold": threshold,
        "featureVersion": FEATURE_VERSION,
        "modelVersion": model_bundle.get("model_version", "python-knn-v1"),
    }
