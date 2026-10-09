"""Treina um classificador de vocabulário limitado a partir do JSON do app.

Uso: .venv/bin/python python/train.py arquivo-exportado.json
"""

from __future__ import annotations

import argparse
import json
from collections import Counter, defaultdict
from pathlib import Path

import joblib
import numpy as np
from sklearn.metrics import accuracy_score, f1_score
from sklearn.model_selection import GroupShuffleSplit, train_test_split

from libras_ml import FEATURE_VERSION, build_classifier, encode_sequence, estimate_distance_threshold


ROOT = Path(__file__).resolve().parent
DEFAULT_MODEL_PATH = ROOT / "models" / "libras-knn.joblib"


def read_examples(path: Path) -> tuple[list[dict], list[str], list[str | None]]:
    payload = json.loads(path.read_text(encoding="utf-8"))
    if not isinstance(payload, list):
        raise ValueError("O JSON exportado precisa conter uma lista de exemplos.")

    features = []
    labels = []
    groups = []
    rejected = Counter()
    for index, sample in enumerate(payload, start=1):
        if not isinstance(sample, dict) or not isinstance(sample.get("label"), str) or not sample["label"].strip():
            rejected["sem rótulo"] += 1
            continue
        if sample.get("featureVersion") != FEATURE_VERSION:
            rejected["versão de features incompatível"] += 1
            continue
        try:
            encoded = encode_sequence(sample.get("sequence"))
        except ValueError:
            rejected["sequência inválida"] += 1
            continue
        features.append(encoded[0])
        labels.append(sample["label"].strip())
        group = sample.get("expertArticulator") or sample.get("group")
        groups.append(str(group).strip() if group else None)

    if rejected:
        print("Exemplos ignorados:", ", ".join(f"{key}: {value}" for key, value in rejected.items()))
    return features, labels, groups


def validation_split(labels: list[str], groups: list[str | None]):
    label_counts = Counter(labels)
    if min(label_counts.values(), default=0) < 3:
        counts = ", ".join(f"{label}={count}" for label, count in sorted(label_counts.items()))
        raise ValueError(
            "Cada sinal precisa de pelo menos 3 exemplos válidos para treinar e validar. "
            f"Contagem atual: {counts or 'nenhum exemplo'}."
        )

    all_classes = set(labels)
    per_class_groups: dict[str, set[str]] = defaultdict(set)
    for label, group in zip(labels, groups):
        if group:
            per_class_groups[label].add(group)

    can_split_by_signer = all(group is not None for group in groups) and all(
        len(per_class_groups[label]) >= 2 for label in all_classes
    )
    if can_split_by_signer:
        splitter = GroupShuffleSplit(n_splits=30, test_size=0.25, random_state=42)
        for train_indexes, test_indexes in splitter.split(labels, labels, groups):
            if set(labels[index] for index in train_indexes) == all_classes and set(labels[index] for index in test_indexes) == all_classes:
                return train_indexes, test_indexes, "articuladores separados"

    indexes = np.arange(len(labels))
    test_fraction = max(0.2, len(all_classes) / len(labels))
    train_indexes, test_indexes = train_test_split(
        indexes,
        test_size=test_fraction,
        random_state=42,
        stratify=labels,
    )
    return train_indexes, test_indexes, "amostras separadas; articuladores podem se repetir"


def main() -> int:
    parser = argparse.ArgumentParser(description="Treina reconhecimento local de sinais isolados da Libras.")
    parser.add_argument("dataset", type=Path, help="JSON exportado em Preparação do dataset")
    parser.add_argument("--output", type=Path, default=DEFAULT_MODEL_PATH, help="Caminho do modelo joblib")
    args = parser.parse_args()

    try:
        features, labels, groups = read_examples(args.dataset)
        if len(set(labels)) < 2:
            raise ValueError("São necessários pelo menos dois sinais diferentes.")

        counts = Counter(labels)
        train_indexes, test_indexes, split_name = validation_split(labels, groups)
        x = np.asarray(features, dtype=np.float32)
        y = np.asarray(labels)

        validation_model = build_classifier(len(train_indexes), min(counts[label] for label in y[train_indexes]))
        validation_model.fit(x[train_indexes], y[train_indexes])
        predicted = validation_model.predict(x[test_indexes])
        metrics = {
            "accuracy": float(accuracy_score(y[test_indexes], predicted)),
            "macroF1": float(f1_score(y[test_indexes], predicted, average="macro", zero_division=0)),
            "validation": split_name,
            "validationExamples": int(len(test_indexes)),
        }

        model = build_classifier(len(y), min(counts.values()))
        model.fit(x, y)
        distance_threshold = estimate_distance_threshold(model, x, y)
        bundle = {
            "model": model,
            "model_version": "python-knn-v1",
            "feature_version": FEATURE_VERSION,
            "frame_count": 32,
            "sample_count": int(len(y)),
            "class_counts": dict(counts),
            "metrics": metrics,
            "distance_threshold": distance_threshold,
        }
        args.output.parent.mkdir(parents=True, exist_ok=True)
        joblib.dump(bundle, args.output)

        print(f"Modelo gravado em: {args.output}")
        print(f"Exemplos válidos: {len(y)} · sinais: {len(counts)} · validação: {split_name}")
        print(f"Acurácia de validação: {metrics['accuracy']:.1%} · F1 macro: {metrics['macroF1']:.3f}")
        print("Contagem por sinal:", ", ".join(f"{label}: {count}" for label, count in sorted(counts.items())))
        print("A acurácia é uma referência do conjunto coletado; revise os sinais com uma pessoa fluente em Libras.")
        return 0
    except (OSError, json.JSONDecodeError, ValueError) as error:
        parser.error(str(error))
    return 2


if __name__ == "__main__":
    raise SystemExit(main())
